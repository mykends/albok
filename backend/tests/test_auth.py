from datetime import datetime
from urllib.parse import parse_qs, unquote, urlparse

from fastapi.testclient import TestClient

from albok_api.auth import SESSION_COOKIE

from .conftest import BASE_URL, user


def sign_in(client: TestClient, sub: str):
    """Walk the real OIDC flow against the mock provider; returns the final redirect response."""
    start = client.get("/auth/login?next=/notes", follow_redirects=False)
    assert start.status_code == 303
    authorize = urlparse(start.headers["location"])
    params = {k: v[0] for k, v in parse_qs(authorize.query).items()}
    assert params["prompt"] == "login" and params["max_age"] == "0"
    assert params["redirect_uri"] == f"{BASE_URL}/auth/callback"
    assert "hrEduPersonOIB" not in params["scope"]
    chosen = client.post(f"{BASE_URL}/mock-oidc/authorize", data={**params, "sub": sub}, follow_redirects=False)
    return client.get(chosen.headers["location"], follow_redirects=False)


def test_roster_student_signs_in_and_gets_school_email(client, school, db, short_idle):
    finished = sign_in(client, "mock-student-1")
    assert finished.status_code == 303
    assert finished.headers["location"] == "http://localhost:8081/notes"
    assert SESSION_COOKIE in client.cookies

    me = client.get("/api/me").json()
    assert me["username"] == "luka.babic@skole.hr"
    assert (me["is_student"], me["is_professor"], me["is_admin"]) == (True, False, False)
    assert me["email"] == "luka.babic@skole.hr"
    assert me["class_names"] == ["3.B"]
    assert me["idle_minutes"] == 10
    db.expire_all()
    assert user(db, "luka.babic@skole.hr").sub == "mock-student-1"


def test_user_not_in_roster_is_rejected(client, school):
    finished = sign_in(client, "mock-outsider")
    location = unquote(finished.headers["location"])
    assert location.startswith("http://localhost:8081/login?error=")
    assert "popisu" in location
    assert client.get("/api/me").status_code == 401


def test_deactivated_user_is_rejected(client, school, db):
    luka = user(db, "luka.babic@skole.hr")
    luka.active = False
    db.add(luka)
    db.commit()
    assert "deaktiviran" in unquote(sign_in(client, "mock-student-1").headers["location"])


def test_bootstrap_admin_can_sign_in_without_roster(client, db, monkeypatch):
    from albok_api.config import settings

    object.__setattr__(settings, "bootstrap_admins", ["ana.admin@skole.hr"])
    try:
        sign_in(client, "mock-admin")
    finally:
        object.__setattr__(settings, "bootstrap_admins", [])
    assert client.get("/api/me").json()["is_admin"] is True


def test_logout_ends_session_and_returns_provider_logout(client, school):
    sign_in(client, "mock-student-1")
    result = client.post("/auth/logout").json()
    assert result["end_session_url"].startswith(f"{BASE_URL}/mock-oidc/end-session?")
    assert "id_token_hint=" in result["end_session_url"]
    assert client.get("/api/me").status_code == 401


def test_tampered_login_state_is_rejected(client, school):
    start = client.get("/auth/login", follow_redirects=False)
    params = {k: v[0] for k, v in parse_qs(urlparse(start.headers["location"]).query).items()}
    chosen = client.post(f"{BASE_URL}/mock-oidc/authorize", data={**params, "sub": "mock-student-1", "state": "forged"}, follow_redirects=False)
    finished = client.get(chosen.headers["location"], follow_redirects=False)
    assert "/login?error=" in finished.headers["location"]


def test_student_session_expires_after_ten_idle_minutes(short_idle, luka, clock):
    assert luka.get("/api/me").status_code == 200
    clock.set(datetime(2026, 10, 20, 9, 9))
    assert luka.get("/api/me").status_code == 200  # activity resets the timer
    clock.set(datetime(2026, 10, 20, 9, 18, 30))
    assert luka.get("/api/me").status_code == 200
    clock.set(datetime(2026, 10, 20, 9, 30))
    assert luka.get("/api/me").status_code == 401  # 10 minutes plus the one-minute grace


def test_passive_requests_do_not_count_as_activity(short_idle, luka, clock):
    clock.set(datetime(2026, 10, 20, 9, 8))
    assert luka.get("/api/me", headers={"X-Albok-Passive": "1"}).status_code == 200
    clock.set(datetime(2026, 10, 20, 9, 11, 30))
    assert luka.get("/api/me").status_code == 401


def test_student_session_ends_with_the_school_day(login, school, clock):
    clock.set(datetime(2026, 10, 20, 14, 50))
    luka = login("luka.babic@skole.hr")
    clock.set(datetime(2026, 10, 20, 14, 59))
    assert luka.get("/api/me").status_code == 200
    clock.set(datetime(2026, 10, 20, 15, 0))
    assert luka.get("/api/me").status_code == 401


def test_professor_sessions_are_not_cut_by_the_school_day(login, school, clock):
    clock.set(datetime(2026, 10, 20, 14, 30))
    horvat = login("ivana.horvat@skole.hr")
    clock.set(datetime(2026, 10, 20, 15, 30))
    assert horvat.get("/api/me").status_code == 200


def test_roles_guard_endpoints(luka, horvat, admin):
    assert luka.get("/api/professor/subjects").status_code == 403
    assert luka.get("/api/admin/users").status_code == 403
    assert horvat.get("/api/admin/users").status_code == 403
    assert horvat.get("/api/student/now").status_code == 403
    assert admin.get("/api/admin/users").status_code == 200
