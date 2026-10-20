"""A stand-in for AAI@EduHr in development (ALBOK_MOCK_OIDC=1): pick a seeded user instead of a password.

It speaks real OIDC (discovery, PKCE, RS256 ID tokens, userinfo, end session), so the production login
code runs unchanged. Never enable it in production.
"""

import base64
import hashlib
import html
import secrets
import time
from dataclasses import dataclass
from urllib.parse import urlencode

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import APIRouter, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse

MOCK_CLIENT_ID = "albok-dev"
MOCK_CLIENT_SECRET = "dev-secret"
SCHOOL_ORG = "Gimnazija Albok"


@dataclass(frozen=True)
class MockUser:
    sub: str
    username: str
    name: str
    affiliation: str
    staff_category: str = ""
    note: str = ""

    def claims(self) -> dict:
        given, _, family = self.name.partition(" ")
        claims = {
            "sub": self.sub,
            "preferred_username": self.username,
            "hrEduPersonUniqueID": self.username,
            "name": self.name,
            "given_name": given,
            "family_name": family,
            "email": self.username,
            "hrEduPersonPrimaryAffiliation": self.affiliation,
            "hrEduPersonHomeOrg": "skole.hr",
            "o": SCHOOL_ORG,
        }
        if self.staff_category:
            claims["hrEduPersonStaffCategory"] = self.staff_category
        return claims


MOCK_USERS = [
    MockUser("mock-admin", "ana.admin@skole.hr", "Ana Admin", "djelatnik", "nenastavno osoblje", "administratorica"),
    MockUser("mock-prof-1", "ivana.horvat@skole.hr", "Ivana Horvat", "djelatnik", "nastavno osoblje", "Povijest, Geografija"),
    MockUser("mock-prof-2", "marko.kovac@skole.hr", "Marko Kovač", "djelatnik", "nastavno osoblje", "Matematika, Fizika"),
    MockUser("mock-student-1", "luka.babic@skole.hr", "Luka Babić", "učenik", note="3.B"),
    MockUser("mock-student-2", "ana.maric@skole.hr", "Ana Marić", "učenik", note="3.B"),
    MockUser("mock-student-3", "petra.novak@skole.hr", "Petra Novak", "učenik", note="1.A"),
    MockUser("mock-outsider", "netko.drugi@skole.hr", "Netko Drugi", "učenik", note="nije na popisu"),
]
_USERS = {user.sub: user for user in MOCK_USERS}

_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_KID = "mock-1"
_codes: dict[str, dict] = {}
_tokens: dict[str, str] = {}

router = APIRouter(prefix="/mock-oidc", tags=["mock-oidc"], include_in_schema=False)


def _issuer(request: Request) -> str:
    return str(request.base_url).rstrip("/") + "/mock-oidc"


@router.get("/.well-known/openid-configuration")
def discovery(request: Request):
    issuer = _issuer(request)
    return {
        "issuer": issuer,
        "authorization_endpoint": f"{issuer}/authorize",
        "token_endpoint": f"{issuer}/token",
        "userinfo_endpoint": f"{issuer}/userinfo",
        "jwks_uri": f"{issuer}/jwks",
        "end_session_endpoint": f"{issuer}/end-session",
        "response_types_supported": ["code"],
        "id_token_signing_alg_values_supported": ["RS256"],
        "code_challenge_methods_supported": ["S256"],
    }


@router.get("/jwks")
def jwks():
    public = jwt.algorithms.RSAAlgorithm.to_jwk(_key.public_key(), as_dict=True)
    return {"keys": [{**public, "kid": _KID, "use": "sig", "alg": "RS256"}]}


@router.get("/authorize", response_class=HTMLResponse)
def authorize(request: Request):
    params = dict(request.query_params)
    if params.get("client_id") != MOCK_CLIENT_ID:
        raise HTTPException(400, "Unknown client_id")
    buttons = "".join(
        f"""<form method="post" action="authorize"><input type="hidden" name="sub" value="{u.sub}">
        {"".join(f'<input type="hidden" name="{html.escape(k)}" value="{html.escape(v)}">' for k, v in params.items())}
        <button><b>{html.escape(u.name)}</b><span>{html.escape(u.username)} · {html.escape(u.note)}</span></button></form>"""
        for u in MOCK_USERS
    )
    return f"""<!doctype html><html lang="hr"><head><meta charset="utf-8"><title>Mock AAI@EduHr</title>
<style>body{{font-family:system-ui;max-width:460px;margin:48px auto;padding:0 16px;color:#111}}
button{{width:100%;text-align:left;padding:12px 14px;margin:6px 0;border:1px solid #ccc;border-radius:8px;background:#fff;cursor:pointer}}
button:hover{{background:#f3f4f6}} span{{display:block;color:#666;font-size:13px}}</style></head>
<body><h2>Mock AAI@EduHr</h2><p>Razvojna prijava. Odaberite korisnika:</p>{buttons}</body></html>"""


@router.post("/authorize")
def choose_user(
    sub: str = Form(...),
    redirect_uri: str = Form(...),
    state: str = Form(""),
    nonce: str = Form(""),
    code_challenge: str = Form(""),
):
    if sub not in _USERS:
        raise HTTPException(400, "Unknown user")
    code = secrets.token_urlsafe(16)
    _codes[code] = {"sub": sub, "nonce": nonce, "redirect_uri": redirect_uri, "challenge": code_challenge}
    return RedirectResponse(f"{redirect_uri}?{urlencode({'code': code, 'state': state})}", status_code=303)


@router.post("/token")
async def token(request: Request):
    form = await request.form()
    grant = _codes.pop(str(form.get("code", "")), None)
    if grant is None or form.get("redirect_uri") != grant["redirect_uri"]:
        raise HTTPException(400, "invalid_grant")
    verifier = str(form.get("code_verifier", ""))
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    if grant["challenge"] and challenge != grant["challenge"]:
        raise HTTPException(400, "invalid_grant (PKCE)")

    user = _USERS[grant["sub"]]
    now = int(time.time())
    id_token = jwt.encode(
        {"iss": _issuer(request), "aud": MOCK_CLIENT_ID, "iat": now, "exp": now + 300, "nonce": grant["nonce"], "sub": user.sub},
        _key,
        algorithm="RS256",
        headers={"kid": _KID},
    )
    access_token = secrets.token_urlsafe(16)
    _tokens[access_token] = user.sub
    return {"access_token": access_token, "token_type": "Bearer", "expires_in": 300, "id_token": id_token}


@router.get("/userinfo")
def userinfo(request: Request):
    token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    sub = _tokens.get(token)
    if sub is None:
        raise HTTPException(401, "invalid_token")
    return _USERS[sub].claims()


@router.get("/end-session")
def end_session(post_logout_redirect_uri: str = "/"):
    return RedirectResponse(post_logout_redirect_uri, status_code=303)
