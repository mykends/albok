import logging
from dataclasses import asdict
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from itsdangerous import BadSignature, URLSafeTimedSerializer
from sqlmodel import Session

from ..access import access_at
from ..auth import (
    LoginRejected,
    clear_session_cookie,
    create_session,
    get_current_user,
    resolve_login,
    session_from_request,
    set_session_cookie,
)
from ..clock import Clock, get_clock
from ..config import settings
from ..db import get_session
from ..models import SchoolClass, User
from ..oidc import LoginRequest, OIDCClient, OIDCError
from ..schemas import LogoutResult, MeRead, ScopeRead

log = logging.getLogger(__name__)
router = APIRouter(tags=["auth"])

LOGIN_COOKIE = "albok_login"
LOGIN_COOKIE_MAX_AGE = 600


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.session_secret, salt="albok-oidc-login")


def _oidc(request: Request) -> OIDCClient:
    client = request.app.state.oidc
    if client is None:
        raise HTTPException(status_code=503, detail="Prijava nije podešena na poslužitelju.")
    return client


def _safe_next(next_path: str | None) -> str:
    if not next_path or not next_path.startswith("/") or next_path.startswith("//"):
        return "/"
    return next_path


def _login_error(message: str) -> RedirectResponse:
    response = RedirectResponse(f"{settings.web_url}/login?error={quote(message)}", status_code=303)
    response.delete_cookie(LOGIN_COOKIE, path="/auth")
    return response


@router.get("/auth/login", include_in_schema=False)
async def login(request: Request, next: str | None = None):
    oidc = _oidc(request)
    attempt = LoginRequest.new()
    try:
        url = await oidc.authorization_url(attempt, prompt=settings.oidc_prompt)
    except (OIDCError, OSError) as exc:
        log.exception("OIDC discovery failed")
        return _login_error(f"AAI@EduHr trenutačno nije dostupan. ({exc.__class__.__name__})")
    response = RedirectResponse(url, status_code=303)
    cookie = _serializer().dumps({**asdict(attempt), "next": _safe_next(next)})
    response.set_cookie(
        LOGIN_COOKIE,
        cookie,
        max_age=LOGIN_COOKIE_MAX_AGE,
        httponly=True,
        secure=settings.secure_cookies,
        samesite="lax",
        path="/auth",
    )
    return response


@router.get("/auth/callback", include_in_schema=False)
async def callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    session: Session = Depends(get_session),
    clock: Clock = Depends(get_clock),
):
    if error:
        return _login_error("Prijava je prekinuta.")
    try:
        saved = _serializer().loads(request.cookies.get(LOGIN_COOKIE, ""), max_age=LOGIN_COOKIE_MAX_AGE)
    except BadSignature:
        return _login_error("Prijava je istekla. Pokušajte ponovno.")
    if not code or state != saved.get("state"):
        return _login_error("Prijava nije uspjela. Pokušajte ponovno.")

    oidc = _oidc(request)
    attempt = LoginRequest(saved["state"], saved["nonce"], saved["code_verifier"])
    try:
        tokens = await oidc.exchange_code(code, attempt)
        claims = await oidc.validate_id_token(tokens["id_token"], attempt.nonce)
        userinfo = await oidc.userinfo(tokens.get("access_token", ""))
    except (OIDCError, KeyError, OSError) as exc:
        log.warning("OIDC callback failed: %s", exc)
        return _login_error("Prijava preko AAI@EduHr nije uspjela. Pokušajte ponovno.")
    if userinfo.get("sub") not in (None, claims["sub"]):
        return _login_error("Prijava preko AAI@EduHr nije uspjela. Pokušajte ponovno.")

    try:
        user = resolve_login(session, {**userinfo, **claims})
    except LoginRejected as exc:
        session.rollback()
        return _login_error(str(exc))

    token = create_session(session, user, clock, id_token=tokens.get("id_token"))
    response = RedirectResponse(f"{settings.web_url}{saved.get('next', '/')}", status_code=303)
    response.delete_cookie(LOGIN_COOKIE, path="/auth")
    set_session_cookie(response, token)
    return response


@router.post("/auth/logout", response_model=LogoutResult)
async def logout(request: Request, session: Session = Depends(get_session)):
    """Ends the Albok session and returns the provider's end-session URL, which the client must open
    so the next person on a shared PC can't reuse the AAI@EduHr session."""
    row = session_from_request(request, session)
    id_token = row.id_token if row else None
    if row:
        session.delete(row)
        session.commit()

    end_session_url = None
    if request.app.state.oidc is not None and row is not None:
        try:
            end_session_url = await request.app.state.oidc.end_session_url(id_token, f"{settings.web_url}/login")
        except (OIDCError, OSError):
            log.warning("Could not build the end-session URL")
    response = JSONResponse(LogoutResult(end_session_url=end_session_url).model_dump())
    clear_session_cookie(response)
    return response


@router.get("/api/me", response_model=MeRead, tags=["me"])
def me(
    request: Request,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
    clock: Clock = Depends(get_clock),
):
    now = clock.now()
    scope = access_at(session, user, now)
    class_names = [session.get(SchoolClass, class_id).name for class_id in scope.class_ids]
    user_session = request.state.user_session
    return MeRead(
        id=user.id,
        username=user.username,
        display_name=user.display_name or user.username,
        email=user.email,
        is_student=user.is_student,
        is_professor=user.is_professor,
        is_admin=user.is_admin,
        class_names=class_names,
        server_time=now,
        idle_minutes=user_session.idle_minutes,
        session_expires_at=user_session.expires_at,
        scope=ScopeRead.from_scope(scope),
    )
