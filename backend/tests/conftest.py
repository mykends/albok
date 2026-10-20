from dataclasses import dataclass
from datetime import date, datetime

import os

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine, select

from albok_api.auth import SESSION_COOKIE, create_session
from albok_api.clock import Clock
from albok_api.config import settings
from albok_api.main import create_app
from albok_api.models import SchoolClass, SchoolYear, Subject, User
from albok_api.school_csv import import_roster, import_timetable

BASE_URL = "http://localhost:8765"

# Tuesday 20 October 2026 is in a "B" week: the year starts in the week of 31 August (an "A" week).
TUESDAY = date(2026, 10, 20)

ROSTER = """korisnik;ime i prezime;uloga;razred
ivana.horvat@skole.hr;Ivana Horvat;profesor;
marko.kovac@skole.hr;Marko Kovač;profesor;
luka.babic@skole.hr;Luka Babić;učenik;3.B
ana.maric@skole.hr;Ana Marić;učenik;3.B
petra.novak@skole.hr;Petra Novak;učenik;1.A
"""
# Tuesdays for 3.B: 08:00 Povijest (Horvat), 08:50 Matematika (Kovač), 09:40 free, 10:40 Povijest (B weeks only)
TIMETABLE = """dan;početak;kraj;tjedan;razred;predmet;nastavnik
uto;08:00;08:45;;3.B;Povijest;ivana.horvat@skole.hr
uto;08:50;09:35;;3.B;Matematika;marko.kovac@skole.hr
uto;10:40;11:25;B;3.B;Povijest;ivana.horvat@skole.hr
uto;08:00;08:45;;1.A;Matematika;marko.kovac@skole.hr
sri;08:00;08:45;;3.B;Matematika;marko.kovac@skole.hr
"""


@pytest.fixture(autouse=True)
def data_dir(tmp_path):
    """Keep uploaded files and the email outbox inside the test's temp dir."""
    original = settings.data_dir
    object.__setattr__(settings, "data_dir", tmp_path / "data")
    yield tmp_path / "data"
    object.__setattr__(settings, "data_dir", original)


def _override_setting(name, value):
    original = getattr(settings, name)
    object.__setattr__(settings, name, value)
    return original


@pytest.fixture(autouse=True)
def long_idle_timeout():
    """Tests jump the clock around; only test_auth checks the real 10-minute timeout (see `short_idle`)."""
    original = _override_setting("student_idle_minutes", 24 * 60)
    yield
    _override_setting("student_idle_minutes", original)


@pytest.fixture
def short_idle():
    _override_setting("student_idle_minutes", 10)


@pytest.fixture
def clock():
    return Clock.fixed(settings.tz, datetime(2026, 10, 20, 9, 0))


@pytest.fixture
def database_url(tmp_path):
    """SQLite by default; set ALBOK_TEST_DATABASE_URL to run the suite against PostgreSQL."""
    url = os.environ.get("ALBOK_TEST_DATABASE_URL")
    if not url:
        return f"sqlite:///{tmp_path / 'test.db'}"
    engine = create_engine(url)
    SQLModel.metadata.drop_all(engine)
    engine.dispose()
    return url


@pytest.fixture
def app(database_url, clock):
    app = create_app(database_url, clock=clock, mock_oidc=True, run_jobs=False, seed=False)
    # The OIDC client reaches the built-in mock provider in-process.
    app.state.oidc.transport = httpx.ASGITransport(app=app)
    return app


@pytest.fixture
def client(app):
    with TestClient(app, base_url=BASE_URL) as test_client:
        yield test_client


@pytest.fixture
def db(client, app):
    with Session(app.state.engine) as session:
        yield session


@dataclass
class School:
    year: SchoolYear
    b3: SchoolClass
    a1: SchoolClass
    history: Subject
    math: Subject


@pytest.fixture
def school(db) -> School:
    year = SchoolYear(name="2026./2027.", start=date(2026, 9, 1), end=date(2027, 6, 18), deletion_date=date(2027, 8, 31))
    db.add(year)
    db.add(User(username="ana.admin@skole.hr", display_name="Ana Admin", is_admin=True))
    db.flush()
    for importer, data in ((import_roster, ROSTER), (import_timetable, TIMETABLE)):
        report = importer(db, year, data.encode(), dry_run=False)
        assert not report.errors, report.errors
    # Accounts get their email from AAI@EduHr at first sign-in; tests skip that step.
    for account in db.exec(select(User)).all():
        account.email = account.username
        db.add(account)
    db.commit()
    classes = {c.name: c for c in db.exec(select(SchoolClass)).all()}
    subjects = {s.timetable_name: s for s in db.exec(select(Subject)).all()}
    return School(year, classes["3.B"], classes["1.A"], subjects["Povijest"], subjects["Matematika"])


def user(db, username: str) -> User:
    return db.exec(select(User).where(User.username == username)).one()


class Clients:
    """Separate TestClients per signed-in user, sharing one app."""

    def __init__(self, app, db, clock):
        self.app, self.db, self.clock = app, db, clock
        self._open: list[TestClient] = []

    def __call__(self, username: str) -> TestClient:
        token = create_session(self.db, user(self.db, username), self.clock)
        client = TestClient(self.app, base_url=BASE_URL)
        client.cookies.set(SESSION_COOKIE, token)
        self._open.append(client)
        return client


@pytest.fixture
def login(app, db, clock, client):
    return Clients(app, db, clock)


@pytest.fixture
def horvat(login, school):
    return login("ivana.horvat@skole.hr")


@pytest.fixture
def kovac(login, school):
    return login("marko.kovac@skole.hr")


@pytest.fixture
def luka(login, school):
    return login("luka.babic@skole.hr")


@pytest.fixture
def admin(login, school):
    return login("ana.admin@skole.hr")


HISTORY_MD = """# Povijest 3

Uvodni tekst.

## Industrijska revolucija

Parni stroj mijenja proizvodnju.

## Revolucije 1848.

Ban Jelačić ukida kmetstvo.

## Ujedinjenje Italije

Italija se ujedinjuje 1861.
"""


def upload_text(client: TestClient, subject_id: int, title: str = "Povijest 3", text: str = HISTORY_MD) -> dict:
    response = client.post(f"/api/subjects/{subject_id}/books/text", json={"title": title, "text": text})
    assert response.status_code == 202, response.text
    # Background processing has finished by the time TestClient returns.
    book = client.get(f"/api/books/{response.json()['id']}").json()
    assert book["file"]["status"] == "ready", book
    return book


def publish(client: TestClient, section_id: int, class_id: int, published: bool = True) -> dict:
    response = client.put(f"/api/sections/{section_id}/publications/{class_id}", json={"published": published})
    assert response.status_code == 200, response.text
    return response.json()
