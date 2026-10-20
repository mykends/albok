"""Sessions, the current user and role checks.

The session is an HTTP-only cookie holding a random token; the server keeps only its hash. Students are
signed out after `student_idle_minutes` without activity and at the end of the school day.
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request, Response
from sqlmodel import Session, select

from .access import AccessScope, access_at, current_school_year
from .clock import Clock, get_clock
from .config import settings
from .db import get_session
from .models import User, UserSession

SESSION_COOKIE = "albok_session"
# Requests with this header (e.g. background polling) don't count as user activity.
PASSIVE_HEADER = "x-albok-passive"
# Don't write last_activity_at on every request.
ACTIVITY_WRITE_INTERVAL = timedelta(seconds=30)
# The client signs out at exactly the idle limit after flushing notes; the server waits a little
# longer so that final flush is never rejected.
IDLE_GRACE = timedelta(minutes=1)

STAFF_AFFILIATION = "djelatnik"
STUDENT_AFFILIATION = "učenik"
TEACHING_STAFF = "nastavno osoblje"


class LoginRejected(Exception):
    """The message is shown to the user on the sign-in screen."""


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _utc(clock: Clock) -> datetime:
    return clock.now().astimezone(timezone.utc)


def is_staff(user: User) -> bool:
    return user.is_professor or user.is_admin


def create_session(session: Session, user: User, clock: Clock, id_token: str | None = None) -> str:
    now = clock.now()
    if is_staff(user):
        idle = settings.staff_idle_minutes
        expires_at = now + timedelta(hours=settings.staff_session_hours)
    else:
        idle = settings.student_idle_minutes
        year = current_school_year(session, now.date())
        day_end = datetime.combine(now.date(), year.day_end_time, tzinfo=now.tzinfo) if year else None
        # After the school day ends only the idle timeout applies.
        expires_at = day_end if day_end and now < day_end else None

    token = secrets.token_urlsafe(32)
    session.add(
        UserSession(
            id=_hash(token),
            user_id=user.id,
            created_at=now.astimezone(timezone.utc),
            last_activity_at=now.astimezone(timezone.utc),
            idle_minutes=idle,
            expires_at=expires_at.astimezone(timezone.utc) if expires_at else None,
            id_token=id_token,
        )
    )
    user.last_login_at = now.astimezone(timezone.utc)
    session.add(user)
    session.commit()
    return token


def set_session_cookie(response: Response, token: str) -> None:
    # No max_age: a browser-session cookie, so closing the kiosk window also drops it.
    response.set_cookie(
        SESSION_COOKIE, token, httponly=True, secure=settings.secure_cookies, samesite="lax", path="/"
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/", secure=settings.secure_cookies, httponly=True, samesite="lax")


def session_from_request(request: Request, session: Session) -> UserSession | None:
    token = request.cookies.get(SESSION_COOKIE)
    return session.get(UserSession, _hash(token)) if token else None


def session_is_expired(row: UserSession, now: datetime) -> bool:
    if row.expires_at and now >= row.expires_at:
        return True
    return now - row.last_activity_at > timedelta(minutes=row.idle_minutes) + IDLE_GRACE


def get_current_user(
    request: Request, session: Session = Depends(get_session), clock: Clock = Depends(get_clock)
) -> User:
    row = session_from_request(request, session)
    if row is None:
        raise HTTPException(status_code=401, detail="Niste prijavljeni.")
    now = _utc(clock)
    if session_is_expired(row, now):
        session.delete(row)
        session.commit()
        raise HTTPException(status_code=401, detail="Sesija je istekla. Prijavite se ponovno.")
    user = session.get(User, row.user_id)
    if user is None or not user.active:
        session.delete(row)
        session.commit()
        raise HTTPException(status_code=401, detail="Vaš račun nije aktivan.")
    if not request.headers.get(PASSIVE_HEADER) and now - row.last_activity_at >= ACTIVITY_WRITE_INTERVAL:
        row.last_activity_at = now
        session.add(row)
        session.commit()
    request.state.user_session = row
    return user


def require_student(user: User = Depends(get_current_user)) -> User:
    if not user.is_student or is_staff(user):
        raise HTTPException(status_code=403, detail="Ova stranica je samo za učenike.")
    return user


def require_professor(user: User = Depends(get_current_user)) -> User:
    if not user.is_professor:
        raise HTTPException(status_code=403, detail="Ova stranica je samo za nastavnike.")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Ova stranica je samo za administratore.")
    return user


def get_scope(
    user: User = Depends(get_current_user), session: Session = Depends(get_session), clock: Clock = Depends(get_clock)
) -> AccessScope:
    return access_at(session, user, clock.now())


def student_scope(
    user: User = Depends(require_student), session: Session = Depends(get_session), clock: Clock = Depends(get_clock)
) -> AccessScope:
    return access_at(session, user, clock.now())


# --- Login rules -------------------------------------------------------------------------------


def _claim_values(claims: dict, *names: str) -> list[str]:
    values: list[str] = []
    for name in names:
        value = claims.get(name)
        if isinstance(value, str):
            values.append(value)
        elif isinstance(value, list):
            values.extend(str(v) for v in value)
    return [v.strip().lower() for v in values if v and str(v).strip()]


def resolve_login(session: Session, claims: dict) -> User:
    """Match OIDC claims to an account. Only users of this school who are in the roster (or are
    bootstrap admins) may sign in."""
    sub = str(claims.get("sub") or "")
    username = str(claims.get("preferred_username") or claims.get("hrEduPersonUniqueID") or "").strip().lower()
    if not sub or not username:
        raise LoginRejected("AAI@EduHr nije poslao korisničko ime.")

    if settings.school_org:
        orgs = _claim_values(claims, "o", "hrEduPersonHomeOrg")
        if settings.school_org.lower() not in orgs:
            raise LoginRejected("Vaš AAI@EduHr račun ne pripada ovoj školi.")

    user = session.exec(select(User).where(User.sub == sub)).first()
    if user is None:
        user = session.exec(select(User).where(User.username == username)).first()
        if user is not None and user.sub and user.sub != sub:
            raise LoginRejected("Ovo korisničko ime već je povezano s drugim AAI@EduHr računom.")

    bootstrap_admin = username in settings.bootstrap_admins
    if user is None:
        if not bootstrap_admin:
            raise LoginRejected("Niste na popisu učenika i nastavnika ove škole. Obratite se administratoru.")
        user = User(username=username, is_admin=True)
    if bootstrap_admin:
        user.is_admin = True
    if not user.active:
        raise LoginRejected("Vaš račun je deaktiviran. Obratite se administratoru.")
    if not (user.is_student or user.is_professor or user.is_admin):
        raise LoginRejected("Vaš račun nema dodijeljenu ulogu. Obratite se administratoru.")

    # The roster decides roles; the AAI@EduHr affiliation must not contradict it.
    affiliation = _claim_values(claims, "hrEduPersonPrimaryAffiliation")
    if affiliation and not user.is_admin:
        if user.is_student and not user.is_professor and STUDENT_AFFILIATION not in affiliation:
            raise LoginRejected("Prema AAI@EduHr niste učenik, a na popisu ste kao učenik. Obratite se administratoru.")
        if user.is_professor and STAFF_AFFILIATION not in affiliation:
            raise LoginRejected("Prema AAI@EduHr niste djelatnik škole. Obratite se administratoru.")

    user.sub = sub
    user.username = username
    name = claims.get("name") or " ".join(filter(None, [claims.get("given_name"), claims.get("family_name")]))
    if name:
        user.display_name = str(name)
    email = claims.get("email") or claims.get("mail")
    if email:
        user.email = str(email[0] if isinstance(email, list) else email)
    session.add(user)
    session.flush()
    return user
