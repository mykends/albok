from datetime import datetime

from sqlmodel import select

from albok_api.jobs import run_daily
from albok_api.models import (
    Book, Enrollment, Lesson, LessonWebTool, Note, Preset, Publication, SchoolClass, SchoolYear, Section, Subject, User, WebTool,
)  # fmt: skip

from .conftest import publish, upload_text
from .test_exports import outbox


def test_year_end_deletes_student_data_and_keeps_professor_content(app, db, school, horvat, luka, login, clock, data_dir):
    book = upload_text(horvat, school.history.id)
    publish(horvat, book["sections"][1]["id"], school.b3.id)
    horvat.post(f"/api/subjects/{school.history.id}/presets", json={"year_level": 3, "section_ids": [book["sections"][1]["id"]]})
    tool = horvat.post(f"/api/subjects/{school.history.id}/web-tools", json={"name": "Quizlet", "url": "https://quizlet.com/"}).json()
    clock.set(datetime(2026, 10, 20, 8, 10))
    lesson = luka.get("/api/student/now").json()["lesson"]
    luka.put(f"/api/lessons/{lesson['id']}/note", json={"content": "x"})
    assert horvat.put(f"/api/lessons/{lesson['id']}/web-tools/{tool['id']}", json={"open": True}).status_code == 200

    clock.set(datetime(2027, 8, 1, 6, 0))  # 30 days before 31 August
    run_daily(app.state.engine, clock)
    warnings = outbox(data_dir)
    assert {m["To"] for m in warnings} == {"luka.babic@skole.hr", "ana.maric@skole.hr", "petra.novak@skole.hr"}
    assert "30 dana" in warnings[0]["Subject"]
    run_daily(app.state.engine, clock)
    assert len(outbox(data_dir)) == 3  # sent once

    clock.set(datetime(2027, 8, 24, 6, 0))
    run_daily(app.state.engine, clock)
    assert len(outbox(data_dir)) == 6

    clock.set(datetime(2027, 8, 31, 6, 0))
    run_daily(app.state.engine, clock)
    db.expire_all()
    for model in (Note, Lesson, LessonWebTool, Publication, Enrollment, SchoolClass):
        assert db.exec(select(model)).first() is None, model
    assert {u.username for u in db.exec(select(User)).all()} == {
        "ana.admin@skole.hr",
        "ivana.horvat@skole.hr",
        "marko.kovac@skole.hr",
    }
    assert db.exec(select(SchoolYear)).one().purged_at is not None
    assert db.exec(select(Subject)).first() is not None
    assert db.exec(select(Book)).first() is not None
    assert db.exec(select(Section)).first() is not None
    assert db.exec(select(Preset)).first() is not None
    assert db.exec(select(WebTool)).first() is not None
    # The professor's content is intact and usable next year.
    horvat = login("ivana.horvat@skole.hr")
    assert len(horvat.get(f"/api/subjects/{school.history.id}/books").json()[0]["sections"]) == 4
