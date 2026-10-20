from datetime import date, datetime

import pytest

from albok_api.access import access_at
from albok_api.models import CalendarDay, LessonOverride, Subject, TimetableSlot

from .conftest import user


def scope_at(db, username: str, when: datetime):
    from albok_api.config import settings

    return access_at(db, user(db, username), when.replace(tzinfo=settings.tz))


def slot_at(db, starts: str, class_id: int):
    from albok_api.models import TeachingAssignment
    from sqlmodel import select

    hour, minute = map(int, starts.split(":"))
    return db.exec(
        select(TimetableSlot)
        .join(TeachingAssignment, TeachingAssignment.id == TimetableSlot.assignment_id)
        .where(TimetableSlot.weekday == 2, TeachingAssignment.class_id == class_id)
        .where(TimetableSlot.starts_at == datetime(2026, 1, 1, hour, minute).time())
    ).one()


@pytest.mark.parametrize(
    ("time", "mode", "subject"),
    [
        ("07:54", "free", None),  # before the 5-minute lead
        ("07:55", "lesson", "Povijest"),
        ("08:44", "lesson", "Povijest"),
        ("08:45", "lesson", "Matematika"),  # back-to-back: the next lesson's window has opened
        ("09:34", "lesson", "Matematika"),
        ("09:35", "free", None),
        ("10:40", "lesson", "Povijest"),  # B week
    ],
)
def test_time_rule(db, school, time, mode, subject):
    hour, minute = map(int, time.split(":"))
    scope = scope_at(db, "luka.babic@skole.hr", datetime(2026, 10, 20, hour, minute))
    assert scope.mode == mode
    expected = {"Povijest": school.history.id, "Matematika": school.math.id}.get(subject)
    assert scope.content_subject_id == expected


def test_a_week_skips_b_only_slots(db, school):
    assert scope_at(db, "luka.babic@skole.hr", datetime(2026, 10, 27, 10, 45)).mode == "free"


def test_non_teaching_day_has_no_lessons(db, school):
    db.add(CalendarDay(school_year_id=school.year.id, date=date(2026, 10, 20), label="Dan škole"))
    db.commit()
    assert scope_at(db, "luka.babic@skole.hr", datetime(2026, 10, 20, 8, 10)).mode == "free"


def test_cancelled_lesson_is_free_time(db, school):
    slot = slot_at(db, "08:00", school.b3.id)
    db.add(LessonOverride(slot_id=slot.id, date=date(2026, 10, 20), cancelled=True))
    db.commit()
    assert scope_at(db, "luka.babic@skole.hr", datetime(2026, 10, 20, 8, 10)).mode == "free"
    # Only that date is affected.
    assert scope_at(db, "luka.babic@skole.hr", datetime(2026, 10, 27, 8, 10)).mode == "lesson"


def test_substitute_subject_changes_what_students_see(db, school):
    slot = slot_at(db, "08:00", school.b3.id)
    db.add(LessonOverride(slot_id=slot.id, date=date(2026, 10, 20), substitute_subject_id=school.math.id))
    db.commit()
    scope = scope_at(db, "luka.babic@skole.hr", datetime(2026, 10, 20, 8, 10))
    assert scope.content_subject_id == school.math.id


def test_professors_have_no_time_restrictions(db, school):
    assert scope_at(db, "ivana.horvat@skole.hr", datetime(2026, 10, 20, 8, 10)).mode == "staff"


def test_outside_school_year_is_free(db, school):
    assert scope_at(db, "luka.babic@skole.hr", datetime(2027, 7, 6, 8, 10)).mode == "free"


def test_substitute_professor_gets_access_only_during_the_slot(db, school, login, clock):
    slot = slot_at(db, "08:00", school.b3.id)
    db.add(LessonOverride(slot_id=slot.id, date=date(2026, 10, 20), substitute_professor_id=user(db, "marko.kovac@skole.hr").id))
    db.commit()
    kovac = login("marko.kovac@skole.hr")
    clock.set(datetime(2026, 10, 20, 8, 10))
    assert kovac.get(f"/api/subjects/{school.history.id}").status_code == 200
    clock.set(datetime(2026, 10, 20, 9, 0))
    assert kovac.get(f"/api/subjects/{school.history.id}").status_code == 403
    db.expire_all()
    assert db.get(Subject, school.history.id).professor_id != user(db, "marko.kovac@skole.hr").id
