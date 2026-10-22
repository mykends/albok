from datetime import datetime

from .conftest import publish, upload_text


def current_lesson(client):
    now = client.get("/api/student/now").json()
    assert now["mode"] == "lesson", now
    return now["lesson"]


def test_one_note_per_lesson_written_during_the_lesson(luka, school, clock):
    clock.set(datetime(2026, 10, 20, 8, 10))
    lesson = current_lesson(luka)
    note = luka.get(f"/api/lessons/{lesson['id']}/note").json()
    assert (note["id"], note["content"], note["editable"], note["is_current"]) == (None, "", True, True)

    saved = luka.put(f"/api/lessons/{lesson['id']}/note", json={"content": "Parni stroj"}).json()
    assert saved["title"] == "Povijest · uto 20. 10. 2026."
    again = luka.put(f"/api/lessons/{lesson['id']}/note", json={"content": "Parni stroj, 1769."}).json()
    assert again["id"] == saved["id"]
    assert [n["content"] for n in luka.get("/api/student/notes").json()] == ["Parni stroj, 1769."]


def test_notes_cannot_be_started_outside_lessons_but_can_be_edited(luka, login, school, clock):
    clock.set(datetime(2026, 10, 20, 8, 10))
    history = current_lesson(luka)
    clock.set(datetime(2026, 10, 20, 8, 50))
    math = current_lesson(luka)
    luka.put(f"/api/lessons/{history['id']}/note", json={"content": "x"})  # the lesson is over...

    clock.set(datetime(2026, 10, 20, 9, 50))  # free period
    # ...but writes made offline during a lesson earlier today still sync.
    assert luka.put(f"/api/lessons/{math['id']}/note", json={"content": "late sync"}).status_code == 200
    assert luka.put(f"/api/lessons/{history['id']}/note", json={"content": "edited later"}).status_code == 200

    clock.set(datetime(2026, 10, 21, 9, 0))  # the next day (yesterday's session ended with the school day)
    other = login("luka.babic@skole.hr").get("/api/student/notes").json()
    assert {n["content"] for n in other} == {"late sync", "edited later"}


def test_lesson_note_cannot_be_created_the_next_day(luka, login, school, clock):
    clock.set(datetime(2026, 10, 20, 8, 10))
    lesson = current_lesson(luka)
    clock.set(datetime(2026, 10, 21, 7, 0))
    luka = login("luka.babic@skole.hr")
    assert luka.put(f"/api/lessons/{lesson['id']}/note", json={"content": "x"}).status_code == 403


def test_during_a_lesson_other_subjects_notes_are_hidden_and_old_ones_read_only(luka, school, clock):
    clock.set(datetime(2026, 10, 20, 8, 10))
    history = current_lesson(luka)
    luka.put(f"/api/lessons/{history['id']}/note", json={"content": "povijest"})
    clock.set(datetime(2026, 10, 20, 8, 50))
    math = current_lesson(luka)
    luka.put(f"/api/lessons/{math['id']}/note", json={"content": "matematika"})

    clock.set(datetime(2026, 10, 20, 10, 45))  # second history lesson (B week)
    second = current_lesson(luka)
    notes = luka.get("/api/student/notes").json()
    assert [n["content"] for n in notes] == ["povijest"]
    assert notes[0]["editable"] is False
    assert luka.get(f"/api/lessons/{math['id']}/note").status_code == 403
    assert luka.put(f"/api/lessons/{history['id']}/note", json={"content": "x"}).status_code == 403
    assert luka.put(f"/api/lessons/{second['id']}/note", json={"content": "nova"}).status_code == 200


def test_another_classes_lesson_is_not_accessible(luka, login, school, clock):
    clock.set(datetime(2026, 10, 20, 8, 10))
    petra = login("petra.novak@skole.hr")
    lesson = current_lesson(petra)
    assert luka.get(f"/api/lessons/{lesson['id']}/note").status_code == 404


def test_opened_sections_are_linked_and_survive_restructuring(horvat, luka, school, clock):
    book = upload_text(horvat, school.history.id)
    intro, industry, revolutions, italy = (s["id"] for s in book["sections"])
    for section_id in (industry, revolutions, italy):
        publish(horvat, section_id, school.b3.id)

    clock.set(datetime(2026, 10, 20, 8, 10))
    lesson = current_lesson(luka)
    for section_id in (industry, revolutions):
        assert luka.post(f"/api/lessons/current/sections/{section_id}/opened").status_code == 204
    assert luka.post(f"/api/lessons/current/sections/{intro}/opened").status_code == 403  # unpublished

    links = lambda: [(s["id"], s["available"]) for s in luka.get(f"/api/lessons/{lesson['id']}/note").json()["sections"]]
    assert links() == [(industry, True), (revolutions, True)]

    # merge: links move to the merged section
    horvat.post(f"/api/books/{book['id']}/sections/merge", json={"section_ids": [revolutions, italy]})
    assert links() == [(industry, True), (revolutions, True)]
    horvat.post(f"/api/books/{book['id']}/sections/merge", json={"section_ids": [industry, revolutions]})
    assert links() == [(industry, True)]
    # split: links stay with the first part
    horvat.post(f"/api/sections/{industry}/split", json={"at_page": 3})
    assert links() == [(industry, True)]
    # unpublish: the link stays but can't be opened
    publish(horvat, industry, school.b3.id, published=False)
    assert links() == [(industry, False)]
    # delete: the link goes, the note stays
    luka.put(f"/api/lessons/{lesson['id']}/note", json={"content": "ostaje"})
    horvat.delete(f"/api/sections/{industry}")
    note = luka.get(f"/api/lessons/{lesson['id']}/note").json()
    assert (note["content"], note["sections"]) == ("ostaje", [])
    # deleting the whole book keeps the note too
    horvat.delete(f"/api/books/{book['id']}")
    assert luka.get(f"/api/lessons/{lesson['id']}/note").json()["content"] == "ostaje"


def test_opened_outside_lessons_is_ignored(luka, school, clock):
    clock.set(datetime(2026, 10, 20, 9, 50))
    assert luka.post("/api/lessons/current/sections/1/opened").status_code == 204
    assert luka.get("/api/student/notes").json() == []


def test_professors_have_no_access_to_student_notes(horvat, luka, school, clock):
    clock.set(datetime(2026, 10, 20, 8, 10))
    lesson = current_lesson(luka)
    luka.put(f"/api/lessons/{lesson['id']}/note", json={"content": "privatno"})
    assert horvat.get(f"/api/lessons/{lesson['id']}/note").status_code == 403
    assert horvat.get("/api/student/notes").status_code == 403


def test_formatted_notes_keep_only_the_editors_formatting(luka, school, clock):
    clock.set(datetime(2026, 10, 20, 8, 10))
    lesson = current_lesson(luka)
    written = (
        '<h1 style="text-align: center;">Parni stroj</h1>'
        '<p>James <strong>Watt</strong>, <em>1769.</em> <u>važno</u></p>'
        '<ul><li><p>tvornice</p></li></ul><p style="text-align: right;">kraj</p>'
    )
    assert luka.put(f"/api/lessons/{lesson['id']}/note", json={"content": written}).json()["content"] == written

    sneaky = (
        '<p style="font-family: Comic Sans; color: red" onclick="steal()">tekst<script>alert(1)</script>'
        '<img src="file:///etc/passwd"><span style="font-size: 40px">veliko</span></p>'
        '<h3>naslov</h3><p style="text-align: justify">poravnato</p>'
    )
    saved = luka.put(f"/api/lessons/{lesson['id']}/note", json={"content": sneaky}).json()
    assert saved["content"] == "<p>tekstveliko</p>naslov<p>poravnato</p>"


def test_plain_text_notes_are_stored_as_written(luka, school, clock):
    clock.set(datetime(2026, 10, 20, 8, 10))
    lesson = current_lesson(luka)
    text = "a < b, <b>nije oblikovano</b>\n<p>"
    assert luka.put(f"/api/lessons/{lesson['id']}/note", json={"content": text}).json()["content"] == text
