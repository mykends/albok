import email
from datetime import datetime
from io import BytesIO

from pypdf import PdfReader

from .conftest import publish, upload_text


def outbox(data_dir):
    folder = data_dir / "outbox"
    return [email.message_from_bytes(path.read_bytes()) for path in sorted(folder.glob("*.eml"))] if folder.exists() else []


def attachment_text(message) -> tuple[str, int]:
    part = next(p for p in message.walk() if p.get_content_type() == "application/pdf")
    reader = PdfReader(BytesIO(part.get_payload(decode=True)))
    return "\n".join(page.extract_text() for page in reader.pages), len(reader.pages)


def write_history_note(luka, horvat, school, clock):
    book = upload_text(horvat, school.history.id)
    for section in book["sections"][1:3]:
        publish(horvat, section["id"], school.b3.id)
    clock.set(datetime(2026, 10, 20, 8, 10))
    lesson = luka.get("/api/student/now").json()["lesson"]
    luka.post(f"/api/lessons/current/sections/{book['sections'][1]['id']}/opened")
    luka.put(f"/api/lessons/{lesson['id']}/note", json={"content": "Watt je usavršio parni stroj."})
    clock.set(datetime(2026, 10, 20, 9, 50))
    return book


def test_subject_export_is_emailed_with_notebook_only_when_export_is_off(luka, horvat, school, clock, data_dir):
    write_history_note(luka, horvat, school, clock)
    response = luka.post("/api/exports", json={"kind": "subject", "subject_id": school.history.id})
    assert response.status_code == 202
    assert response.json()["email"] == "luka.babic@skole.hr"

    [message] = outbox(data_dir)
    assert message["To"] == "luka.babic@skole.hr"
    text, pages = attachment_text(message)
    assert "Povijest · uto 20. 10. 2026." in text
    assert "Gradivo: Industrijska revolucija" in text
    assert "Watt je usavršio parni stroj." in text
    assert "Parni stroj mijenja proizvodnju" not in text  # material is not exportable
    assert pages == 2  # cover + one subject chapter


def test_exportable_books_include_published_pages(luka, horvat, school, clock, data_dir):
    book = write_history_note(luka, horvat, school, clock)
    horvat.patch(f"/api/books/{book['id']}", json={"exportable": True})
    luka.post("/api/exports", json={"kind": "all"})
    text, pages = attachment_text(outbox(data_dir)[0])
    assert "Parni stroj mijenja proizvodnju" in text and "Jelačić" in text
    assert "Italija" not in text  # not published
    assert "Matematika" in text  # all subjects, one chapter each
    assert pages == 1 + 1 + 2 + 1


def test_one_export_of_each_kind_per_day(luka, school, clock):
    clock.set(datetime(2026, 10, 20, 9, 50))
    assert luka.post("/api/exports", json={"kind": "all"}).status_code == 202
    assert luka.post("/api/exports", json={"kind": "all"}).status_code == 429
    assert luka.post("/api/exports", json={"kind": "subject", "subject_id": school.math.id}).status_code == 202
    assert luka.post("/api/exports", json={"kind": "subject", "subject_id": school.history.id}).status_code == 429
    assert luka.get("/api/exports/quota").json() == {
        "email": "luka.babic@skole.hr",
        "subject_available": False,
        "all_available": False,
    }


def test_exports_are_not_available_during_lessons_or_for_other_subjects(luka, school, clock, db):
    clock.set(datetime(2026, 10, 20, 8, 10))
    assert luka.post("/api/exports", json={"kind": "all"}).status_code == 409
    clock.set(datetime(2026, 10, 20, 9, 50))
    from albok_api.models import Subject

    other = Subject(professor_id=school.math.professor_id, timetable_name="Kemija", name="Kemija")
    db.add(other)
    db.commit()
    assert luka.post("/api/exports", json={"kind": "subject", "subject_id": other.id}).status_code == 422


def test_formatted_notes_are_exported_as_text_with_their_formatting(luka, login, horvat, school, clock, data_dir):
    write_history_note(luka, horvat, school, clock)
    clock.set(datetime(2026, 10, 27, 8, 10))
    luka = login("luka.babic@skole.hr")  # a new school day
    lesson = luka.get("/api/student/now").json()["lesson"]
    luka.put(
        f"/api/lessons/{lesson['id']}/note",
        json={"content": '<h1 style="text-align: center;">Ključni pojmovi</h1><ul><li><p>Parni stroj</p></li></ul><p></p><p>ugljen → para ⇒ rad, η ≤ 1, Δ ≠ 0, ≈ ±x²</p>'},
    )
    clock.set(datetime(2026, 10, 27, 9, 50))
    luka.post("/api/exports", json={"kind": "subject", "subject_id": school.history.id})

    [message] = outbox(data_dir)
    text, _ = attachment_text(message)
    assert "Watt je usavršio parni stroj." in text  # the older, plain-text note
    assert "Ključni pojmovi" in text and "Parni stroj" in text
    assert "ugljen → para ⇒ rad, η ≤ 1, Δ ≠ 0, ≈ ±x²" in text  # symbols come from the fallback font
    assert "<" not in text


def test_notes_with_only_empty_formatting_are_left_out(luka, login, horvat, school, clock, data_dir):
    write_history_note(luka, horvat, school, clock)
    clock.set(datetime(2026, 10, 27, 8, 10))
    luka = login("luka.babic@skole.hr")  # a new school day
    lesson = luka.get("/api/student/now").json()["lesson"]
    luka.put(f"/api/lessons/{lesson['id']}/note", json={"content": "<p></p><h1></h1>"})
    clock.set(datetime(2026, 10, 27, 9, 50))
    luka.post("/api/exports", json={"kind": "subject", "subject_id": school.history.id})

    [message] = outbox(data_dir)
    text, _ = attachment_text(message)
    assert "Povijest · uto 20. 10. 2026." in text
    assert "Povijest · uto 27. 10. 2026." not in text
