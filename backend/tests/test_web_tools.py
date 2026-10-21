from datetime import date, datetime, time

import pytest
from sqlmodel import select

from albok_api.access import get_or_create_lesson, lessons_on
from albok_api.models import Lesson, LessonOverride, LessonWebTool, Subject, TimetableSlot, WebTool
from albok_api.web_tools import InvalidLink, normalize_link

from .conftest import TUESDAY, user
from .test_access import slot_at

# --- Link rules -----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("https://dictionary.cambridge.org/  ", "https://dictionary.cambridge.org/"),
        ("  https://quizlet.com", "https://quizlet.com/"),
        ("https://Quizlet.COM/en/Sets?x=1#top", "https://quizlet.com/en/Sets?x=1#top"),
        ("HTTPS://www.geogebra.org/classic", "https://www.geogebra.org/classic"),
        ("https://quizlet.com:443/", "https://quizlet.com/"),
        ("https://rječnik.hr/", "https://xn--rjenik-k2a.hr/"),
        ("https://www.wordreference.com/definition/report", "https://www.wordreference.com/definition/report"),
    ],
)
def test_accepted_links_are_normalized(raw, expected):
    assert normalize_link(raw) == expected


@pytest.mark.parametrize(
    ("raw", "reason"),
    [
        ("", "Upišite"),
        ("quizlet.com", "https://"),
        ("http://quizlet.com", "https://"),
        ("ftp://quizlet.com/", "https://"),
        ("javascript:alert(1)", "https://"),
        ("data:text/html,hi", "https://"),
        ("https://", "ispravna"),
        ("https://192.168.1.20/moodle", "IP"),  # AE7
        ("https://[::1]/", "IP"),
        ("https://127.1/", "IP"),
        ("https://0177.0.0.1/", "IP"),
        ("https://0x7f.0.0.1/", "IP"),
        ("https://2130706433/", "IP"),
        ("https://intranet.local/", "školske mreže"),
        ("https://intranet.local./", "školske mreže"),
        ("https://moodle/", "školske mreže"),
        ("https://localhost/", "školske mreže"),
        ("https://router.home.arpa/", "školske mreže"),
        ("https://printer.lan/", "školske mreže"),
        ("https://example.com/worksheet.pdf", "datoteku"),  # AE7
        ("https://example.com/files/Setup.EXE", "datoteku"),
        ("https://example.com/archive.zip?download=1", "datoteku"),
        ("https://user:pw@quizlet.com/", "korisničko ime"),
        ("https://user@quizlet.com/", "korisničko ime"),
        ("https://quizlet.com:8443/", "port"),
        ("https://youtu.be/abc", "punu adresu"),
        ("https://forms.gle/xyz", "punu adresu"),
        ("https://www.bit.ly/x", "punu adresu"),
        ("https://quizlet.com\\.evil.example/", "ispravna"),
        ("https://%31%32%37.0.0.1/", "IP"),
        ("https://quiz%6cet.com/", "ispravna"),
        ("https://quiz let.com/", "ispravna"),
        ("https://quizlet.com:abc/", "ispravna"),
    ],
)
def test_rejected_links_give_a_reason(raw, reason):
    with pytest.raises(InvalidLink) as error:
        normalize_link(raw)
    assert reason in str(error.value)


# --- Data ---------------------------------------------------------------------------------------


def test_deleting_a_web_tool_closes_it_for_every_lesson(db, school):
    tool = WebTool(subject_id=school.history.id, name="Rječnik", url="https://dictionary.cambridge.org/")
    lesson = Lesson(class_id=school.b3.id, subject_id=school.history.id, date=date(2026, 10, 20), starts_at=time(8), ends_at=time(8, 45))
    db.add_all([tool, lesson])
    db.flush()
    db.add(LessonWebTool(lesson_id=lesson.id, web_tool_id=tool.id))
    db.commit()

    db.delete(tool)
    db.commit()
    assert db.exec(select(LessonWebTool)).first() is None
    assert db.get(Lesson, lesson.id) is not None


# --- Professor: the list ------------------------------------------------------------------------

QUIZLET = {"name": "Quizlet", "url": "https://quizlet.com/"}
DICTIONARY = {"name": "Cambridge Dictionary", "url": "https://dictionary.cambridge.org/"}


def add_tool(client, subject_id: int, tool: dict = QUIZLET) -> dict:
    response = client.post(f"/api/subjects/{subject_id}/web-tools", json=tool)
    assert response.status_code == 201, response.text
    return response.json()


def at(clock, hour: int, minute: int, day: int = 20) -> None:
    clock.set(datetime(2026, 10, day, hour, minute))


def teaching(client) -> list[dict]:
    response = client.get("/api/professor/now")
    assert response.status_code == 200, response.text
    return response.json()


def set_open(client, lesson_id: int, tool_id: int, open: bool = True):
    return client.put(f"/api/lessons/{lesson_id}/web-tools/{tool_id}", json={"open": open})


def test_owner_manages_the_list(horvat, kovac, school):
    quizlet = add_tool(horvat, school.history.id)
    dictionary = add_tool(horvat, school.history.id, DICTIONARY)
    assert (quizlet["position"], dictionary["position"]) == (0, 1)
    moved = horvat.patch(f"/api/web-tools/{dictionary['id']}", json={"position": 0, "name": " Rječnik "}).json()
    assert (moved["position"], moved["name"]) == (0, "Rječnik")
    tools = horvat.get(f"/api/subjects/{school.history.id}/web-tools").json()
    assert [t["name"] for t in tools] == ["Rječnik", "Quizlet"]

    rejected = horvat.patch(f"/api/web-tools/{quizlet['id']}", json={"url": "https://youtu.be/x"})
    assert rejected.status_code == 422
    assert "punu adresu" in rejected.json()["detail"]

    assert horvat.delete(f"/api/web-tools/{quizlet['id']}").status_code == 204
    assert [t["name"] for t in horvat.get(f"/api/subjects/{school.history.id}/web-tools").json()] == ["Rječnik"]


def test_adding_an_invalid_link_says_why(horvat, school):
    response = horvat.post(f"/api/subjects/{school.history.id}/web-tools", json={"name": "Radni list", "url": "https://example.com/list.pdf"})
    assert response.status_code == 422
    assert "datoteku" in response.json()["detail"]


def test_lists_are_never_shared(horvat, kovac, school):
    """R4: another professor can't see or edit the list, even with a Subject of the same timetable name."""
    tool = add_tool(horvat, school.history.id)
    assert kovac.get(f"/api/subjects/{school.history.id}/web-tools").status_code == 403
    assert kovac.post(f"/api/subjects/{school.history.id}/web-tools", json=QUIZLET).status_code == 403
    assert kovac.patch(f"/api/web-tools/{tool['id']}", json={"name": "x"}).status_code == 403
    assert kovac.delete(f"/api/web-tools/{tool['id']}").status_code == 403


# --- Professor: opening tools for a lesson --------------------------------------------------------


def test_owner_opens_a_tool_during_her_lesson(horvat, school, clock):
    """AE1 (professor side)."""
    tool = add_tool(horvat, school.history.id)
    at(clock, 8, 10)
    [lesson] = teaching(horvat)
    assert (lesson["class_name"], lesson["subject_name"], lesson["substitute"], lesson["can_edit_tools"]) == ("3.B", "Povijest", False, True)
    assert [(t["name"], t["open"]) for t in lesson["tools"]] == [("Quizlet", False)]

    response = set_open(horvat, lesson["lesson_id"], tool["id"])
    assert response.status_code == 200, response.text
    assert response.json()["tools"][0]["open"] is True
    assert teaching(horvat)[0]["tools"][0]["open"] is True


def test_opening_and_closing_are_idempotent(horvat, db, school, clock):
    tool = add_tool(horvat, school.history.id)
    at(clock, 8, 10)
    lesson_id = teaching(horvat)[0]["lesson_id"]
    for _ in range(2):
        assert set_open(horvat, lesson_id, tool["id"]).status_code == 200
    assert len(db.exec(select(LessonWebTool)).all()) == 1
    for _ in range(2):
        assert set_open(horvat, lesson_id, tool["id"], open=False).json()["tools"][0]["open"] is False
    assert db.exec(select(LessonWebTool)).first() is None


def test_tools_open_only_while_the_lesson_runs(horvat, db, school, clock):
    """R8: not after the lesson, and not ahead of time for a later lesson today."""
    tool = add_tool(horvat, school.history.id)
    at(clock, 8, 10)
    lesson_id = teaching(horvat)[0]["lesson_id"]
    at(clock, 8, 50)
    response = set_open(horvat, lesson_id, tool["id"])
    assert response.status_code == 403
    assert "tijekom sata" in response.json()["detail"]

    at(clock, 8, 10)
    later = next(l for l in lessons_on(db, school.year, TUESDAY) if l.starts_at == time(10, 40))
    later_lesson = get_or_create_lesson(db, later)
    db.commit()
    assert set_open(horvat, later_lesson.id, tool["id"]).status_code == 403
    assert horvat.post(f"/api/lessons/{later_lesson.id}/web-tools", json=DICTIONARY).status_code == 403


def test_only_the_lessons_professor_opens_tools(horvat, kovac, db, school, clock):
    """R4/R5: Kovač's own "Povijest" Subject gives him nothing in Horvat's lesson."""
    tool = add_tool(horvat, school.history.id)
    own_history = Subject(professor_id=user(db, "marko.kovac@skole.hr").id, timetable_name="Povijest", name="Povijest")
    db.add(own_history)
    db.commit()
    own_tool = add_tool(kovac, own_history.id)
    at(clock, 8, 10)
    lesson_id = teaching(horvat)[0]["lesson_id"]
    assert [l["class_name"] for l in teaching(kovac)] == ["1.A"]
    assert set_open(kovac, lesson_id, tool["id"]).status_code == 403
    assert set_open(kovac, lesson_id, own_tool["id"]).status_code == 403


def test_a_tool_from_another_subject_cannot_be_opened(horvat, db, school, clock):
    geography = Subject(professor_id=school.history.professor_id, timetable_name="Geografija", name="Geografija")
    db.add(geography)
    db.commit()
    other = add_tool(horvat, geography.id)
    at(clock, 8, 10)
    lesson = teaching(horvat)[0]
    assert lesson["tools"] == []
    assert set_open(horvat, lesson["lesson_id"], other["id"]).status_code == 422


def test_substitute_opens_tools_but_cannot_edit_the_list(horvat, login, db, school, clock):
    """AE5."""
    tool = add_tool(horvat, school.history.id)
    slot = slot_at(db, "10:40", school.b3.id)
    db.add(LessonOverride(slot_id=slot.id, date=TUESDAY, substitute_professor_id=user(db, "marko.kovac@skole.hr").id))
    db.commit()
    kovac = login("marko.kovac@skole.hr")
    at(clock, 10, 45)
    [lesson] = teaching(kovac)
    assert (lesson["subject_name"], lesson["substitute"], lesson["can_edit_tools"]) == ("Povijest", True, False)
    assert set_open(kovac, lesson["lesson_id"], tool["id"]).json()["tools"][0]["open"] is True
    assert set_open(kovac, lesson["lesson_id"], tool["id"], open=False).json()["tools"][0]["open"] is False

    assert kovac.post(f"/api/subjects/{school.history.id}/web-tools", json=DICTIONARY).status_code == 403
    assert kovac.patch(f"/api/web-tools/{tool['id']}", json={"name": "x"}).status_code == 403
    assert kovac.delete(f"/api/web-tools/{tool['id']}").status_code == 403
    assert kovac.post(f"/api/lessons/{lesson['lesson_id']}/web-tools", json=DICTIONARY).status_code == 403
    assert len(horvat.get(f"/api/subjects/{school.history.id}/web-tools").json()) == 1
    # Horvat isn't teaching it today.
    assert teaching(horvat) == []


def test_substitute_with_his_own_subject_can_add_and_open(kovac, db, school, clock):
    slot = slot_at(db, "10:40", school.b3.id)
    db.add(LessonOverride(slot_id=slot.id, date=TUESDAY, substitute_subject_id=school.math.id))
    db.commit()
    at(clock, 10, 45)
    [lesson] = teaching(kovac)
    assert (lesson["subject_name"], lesson["substitute"], lesson["can_edit_tools"]) == ("Matematika", True, True)
    response = kovac.post(f"/api/lessons/{lesson['lesson_id']}/web-tools", json=QUIZLET)
    assert response.status_code == 201, response.text
    assert [(t["name"], t["open"]) for t in response.json()["tools"]] == [("Quizlet", True)]
    assert [t["name"] for t in kovac.get(f"/api/subjects/{school.math.id}/web-tools").json()] == ["Quizlet"]


def test_add_and_open_now(horvat, db, school, clock):
    """R6, and an invalid link creates nothing."""
    at(clock, 8, 10)
    lesson_id = teaching(horvat)[0]["lesson_id"]
    response = horvat.post(f"/api/lessons/{lesson_id}/web-tools", json={"name": "x", "url": "http://quizlet.com"})
    assert response.status_code == 422
    assert "https://" in response.json()["detail"]
    assert db.exec(select(WebTool)).first() is None

    response = horvat.post(f"/api/lessons/{lesson_id}/web-tools", json=DICTIONARY)
    assert response.status_code == 201
    assert [(t["name"], t["open"]) for t in response.json()["tools"]] == [("Cambridge Dictionary", True)]


def test_cancelled_lesson_cannot_have_tools_opened(horvat, db, school, clock):
    tool = add_tool(horvat, school.history.id)
    at(clock, 8, 10)
    lesson_id = teaching(horvat)[0]["lesson_id"]
    db.add(LessonOverride(slot_id=slot_at(db, "08:00", school.b3.id).id, date=TUESDAY, cancelled=True))
    db.commit()
    assert teaching(horvat) == []
    assert set_open(horvat, lesson_id, tool["id"]).status_code == 403


def test_a_lesson_whose_slot_is_gone_is_denied(horvat, db, school, clock):
    tool = add_tool(horvat, school.history.id)
    at(clock, 8, 10)
    lesson = db.get(Lesson, teaching(horvat)[0]["lesson_id"])
    lesson.slot_id = None
    db.add(lesson)
    db.commit()
    assert set_open(horvat, lesson.id, tool["id"]).status_code == 403


def test_teaching_now_is_empty_outside_lessons_and_lists_overlapping_lessons(kovac, db, school, clock):
    at(clock, 9, 50)
    assert teaching(kovac) == []
    # A 1.A lesson starting at 08:47 opens its window at 08:42, while the 08:00 lesson still runs.
    first = slot_at(db, "08:00", school.a1.id)
    db.add(TimetableSlot(assignment_id=first.assignment_id, weekday=2, starts_at=time(8, 47), ends_at=time(9, 30)))
    db.commit()
    at(clock, 8, 43)
    assert [l["starts_at"] for l in teaching(kovac)] == ["08:00:00", "08:47:00"]


def test_students_cannot_use_professor_endpoints(luka, school, clock):
    at(clock, 8, 10)
    assert luka.get("/api/professor/now").status_code == 403
