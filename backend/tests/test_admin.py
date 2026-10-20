from datetime import datetime

from sqlmodel import select

from albok_api.models import Enrollment, Note, SchoolClass, Subject, TimetableSlot, User

from .conftest import upload_text, user


def csv_upload(client, path: str, text: str, dry_run: bool):
    return client.post(
        path, params={"dry_run": dry_run}, files={"file": ("data.csv", text.encode("cp1250"), "text/csv")}
    )


def test_roster_dry_run_previews_without_applying(admin, school, db):
    roster = "Korisnik,Ime,Uloga,Razred\nnova.ucenica@skole.hr,Nova Učenica,učenik,2 c\n"
    preview = csv_upload(admin, "/api/admin/roster/import", roster, dry_run=True).json()
    assert preview["errors"] == []
    assert preview["created"] == {"users": 1, "classes": 1, "enrollments": 1}
    assert db.exec(select(User).where(User.username == "nova.ucenica@skole.hr")).first() is None

    applied = csv_upload(admin, "/api/admin/roster/import", roster, dry_run=False).json()
    assert applied["dry_run"] is False
    db.expire_all()
    student = user(db, "nova.ucenica@skole.hr")
    assert student.is_student and student.display_name == "Nova Učenica"
    assert db.exec(select(SchoolClass).where(SchoolClass.name == "2.C")).one().year_level == 2
    # Students missing from the new file lose their enrollment but keep their account.
    assert applied["removed"]["enrollments"] == 3
    assert user(db, "luka.babic@skole.hr").active


def test_roster_errors_block_the_import(admin, school, db):
    roster = "korisnik;uloga;razred\na@skole.hr;učenik;\nb@skole.hr;ravnatelj;\nc@skole.hr;učenik;1.A\nc@skole.hr;učenik;1.A\n"
    report = csv_upload(admin, "/api/admin/roster/import", roster, dry_run=False).json()
    assert [e["line"] for e in report["errors"]] == [2, 3, 5]
    assert db.exec(select(User).where(User.username == "c@skole.hr")).first() is None


def test_missing_columns_are_reported(admin, school):
    response = csv_upload(admin, "/api/admin/roster/import", "ime;razred\nX;1.A\n", dry_run=True)
    assert response.status_code == 422
    assert "korisnik" in response.json()["detail"]


def test_timetable_reimport_keeps_unchanged_slots_and_validates(admin, school, db):
    from .conftest import TIMETABLE

    before = {s.id for s in db.exec(select(TimetableSlot)).all()}
    changed = TIMETABLE.replace("sri;08:00;08:45;;3.B;Matematika", "čet;09:00;09:45;;3.B;Matematika")
    report = csv_upload(admin, "/api/admin/timetable/import", changed, dry_run=False).json()
    assert report["errors"] == []
    assert (report["created"].get("slots"), report["removed"].get("slots")) == (1, 1)
    db.expire_all()
    after = {s.id for s in db.exec(select(TimetableSlot)).all()}
    assert len(before & after) == len(before) - 1

    bad = "dan;početak;kraj;razred;predmet;nastavnik\npon;9:00;8:00;9.Z;Kemija;luka.babic@skole.hr\n"
    report = csv_upload(admin, "/api/admin/timetable/import", bad, dry_run=True).json()
    message = report["errors"][0]["message"]
    assert "kraj mora biti nakon početka" in message.lower() and "9.Z" in message and "profesor" in message


def test_new_timetable_subject_creates_one_subject_per_professor_name(admin, school, db):
    from .conftest import TIMETABLE

    extended = TIMETABLE + "pet;08:00;08:45;;1.A;Povijest;ivana.horvat@skole.hr\n"
    csv_upload(admin, "/api/admin/timetable/import", extended, dry_run=False)
    db.expire_all()
    subjects = db.exec(select(Subject).where(Subject.timetable_name == "Povijest")).all()
    assert len(subjects) == 1  # shared across the professor's classes


def test_slots_and_overrides(admin, school, login, clock):
    slots = admin.get("/api/admin/slots").json()
    first = next(s for s in slots if s["class_name"] == "3.B" and s["starts_at"] == "08:00:00")
    assert first["professor_name"] == "Ivana Horvat"

    kovac_id = next(u["id"] for u in admin.get("/api/admin/users", params={"role": "professor"}).json() if u["username"].startswith("marko"))
    wrong_day = admin.put("/api/admin/overrides", json={"slot_id": first["id"], "date": "2026-10-21", "cancelled": True})
    assert wrong_day.status_code == 422
    override = admin.put("/api/admin/overrides", json={"slot_id": first["id"], "date": "2026-10-20", "cancelled": True}).json()
    assert override["cancelled"] is True and override["slot"]["subject_name"] == "Povijest"
    clock.set(datetime(2026, 10, 20, 8, 10))
    assert login("luka.babic@skole.hr").get("/api/student/now").json()["mode"] == "free"

    updated = admin.put(
        "/api/admin/overrides",
        json={"slot_id": first["id"], "date": "2026-10-20", "substitute_professor_id": kovac_id},
    ).json()
    assert updated["id"] == override["id"] and updated["cancelled"] is False
    assert updated["substitute_professor_name"] == "Marko Kovač"
    assert len(admin.get("/api/admin/overrides").json()) == 1
    assert admin.delete(f"/api/admin/overrides/{override['id']}").status_code == 204

    created = admin.post(
        "/api/admin/slots",
        json={"weekday": 5, "starts_at": "12:00", "ends_at": "12:45", "class_id": school.a1.id, "subject_name": "Fizika", "professor_id": kovac_id},
    )
    assert created.status_code == 201 and created.json()["subject_name"] == "Fizika"


def test_calendar_and_years(admin, school):
    years = admin.get("/api/admin/years").json()
    assert years[0]["is_current"] is True
    days = admin.post(
        f"/api/admin/years/{school.year.id}/days", json={"start": "2026-12-24", "end": "2026-12-27", "label": "Božić"}
    ).json()
    assert [d["date"] for d in days] == ["2026-12-24", "2026-12-25", "2026-12-26", "2026-12-27"]
    bad = admin.post(
        "/api/admin/years",
        json={"name": "x", "start": "2027-09-01", "end": "2028-06-20", "deletion_date": "2028-06-01"},
    )
    assert bad.status_code == 422


def test_roles_and_deactivation(admin, luka, school, db):
    users = admin.get("/api/admin/users", params={"q": "luka"}).json()
    assert [(u["username"], u["class_names"]) for u in users] == [("luka.babic@skole.hr", ["3.B"])]
    luka_id = users[0]["id"]
    assert admin.patch(f"/api/admin/users/{luka_id}", json={"active": False}).json()["active"] is False
    assert luka.get("/api/me").status_code == 401

    me = admin.get("/api/me").json()
    assert admin.patch(f"/api/admin/users/{me['id']}", json={"is_admin": False}).status_code == 409

    horvat_id = user(db, "ivana.horvat@skole.hr").id
    assert admin.patch(f"/api/admin/users/{horvat_id}", json={"is_admin": True}).json()["is_admin"] is True


def test_storage_reports_disk_use_per_professor(admin, horvat, school):
    upload_text(horvat, school.history.id)
    storage = admin.get("/api/admin/storage").json()
    assert storage["total_bytes"] > 0 and storage["pdf_bytes"] > 0
    assert [(row["professor_name"], row["book_count"]) for row in storage["by_professor"]] == [("Ivana Horvat", 1)]


def test_class_with_notes_cannot_be_deleted(admin, luka, school, clock, db):
    clock.set(datetime(2026, 10, 20, 8, 10))
    lesson = luka.get("/api/student/now").json()["lesson"]
    luka.put(f"/api/lessons/{lesson['id']}/note", json={"content": "x"})
    assert admin.delete(f"/api/admin/classes/{school.b3.id}").status_code == 409
    a1_id = school.a1.id
    assert admin.delete(f"/api/admin/classes/{a1_id}").status_code == 204
    db.expire_all()
    assert db.exec(select(Enrollment).where(Enrollment.class_id == a1_id)).first() is None
    assert db.exec(select(Note)).first() is not None
