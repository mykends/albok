"""Daily school-year jobs: export reminders 30 and 7 days before the deletion date, then the deletion.

Deleted on the deletion date: student notes, per-class publish state, classes, rosters, enrollments,
the timetable and student accounts. Kept: professors' subjects, books, sections and presets.
"""

import asyncio
import logging
from datetime import timezone

from sqlalchemy.engine import Engine
from sqlmodel import Session, col, delete, select

from .clock import Clock, format_lesson_date
from .mailer import send_mail
from .models import CalendarDay, Enrollment, SchoolClass, SchoolYear, User

log = logging.getLogger(__name__)
CHECK_INTERVAL_SECONDS = 3600
WARNING_DAYS = (30, 7)


def year_students(session: Session, year: SchoolYear) -> list[User]:
    return list(
        session.exec(
            select(User)
            .join(Enrollment, Enrollment.student_id == User.id)
            .join(SchoolClass, SchoolClass.id == Enrollment.class_id)
            .where(SchoolClass.school_year_id == year.id, User.active)
            .distinct()
        ).all()
    )


def send_warnings(session: Session, year: SchoolYear, days: int) -> int:
    sent = 0
    for student in year_students(session, year):
        if not student.email:
            continue
        try:
            send_mail(
                student.email,
                f"Albok: bilješke se brišu za {days} dana",
                f"Pozdrav {student.display_name},\n\n"
                f"{format_lesson_date(year.deletion_date)} brišu se sve bilješke iz školske godine {year.name}, "
                "zajedno s vašim Albok računom.\n\n"
                "Ako ih želite sačuvati, prijavite se u Albok i pošaljite si izvoz (Bilježnica → Izvezi e-poštom).\n\n"
                "Albok",
            )
            sent += 1
        except Exception:
            log.exception("Warning email to %s failed", student.username)
    return sent


def purge_year(session: Session, year: SchoolYear, clock: Clock) -> dict[str, int]:
    """Deleting the year's classes cascades to enrollments, assignments, slots, overrides, lessons,
    notes, note links, inclusions and publications."""
    students = year_students(session, year)
    class_ids = list(session.exec(select(SchoolClass.id).where(SchoolClass.school_year_id == year.id)).all())
    if class_ids:
        session.exec(delete(SchoolClass).where(col(SchoolClass.id).in_(class_ids)))
    session.exec(delete(CalendarDay).where(CalendarDay.school_year_id == year.id))

    removed_accounts = 0
    other_years = [y.id for y in session.exec(select(SchoolYear).where(SchoolYear.id != year.id, col(SchoolYear.purged_at).is_(None))).all()]
    for student in students:
        if student.is_professor or student.is_admin:
            continue
        # A student already enrolled for the next year keeps the account.
        still_enrolled = session.exec(
            select(Enrollment.id)
            .join(SchoolClass, SchoolClass.id == Enrollment.class_id)
            .where(Enrollment.student_id == student.id, col(SchoolClass.school_year_id).in_(other_years))
        ).first() if other_years else None
        if still_enrolled is None:
            session.delete(student)
            removed_accounts += 1
    year.purged_at = clock.now().astimezone(timezone.utc)
    session.add(year)
    session.commit()
    log.info("Purged school year %s: %s classes, %s student accounts", year.name, len(class_ids), removed_accounts)
    return {"classes": len(class_ids), "students": removed_accounts}


def run_daily(engine: Engine, clock: Clock) -> None:
    today = clock.today()
    with Session(engine) as session:
        for year in session.exec(select(SchoolYear).where(col(SchoolYear.purged_at).is_(None))).all():
            days_left = (year.deletion_date - today).days
            if days_left <= 0:
                purge_year(session, year, clock)
                continue
            for days, field in zip(WARNING_DAYS, ("warning_30_sent_at", "warning_7_sent_at")):
                # Only the most urgent pending warning goes out, so a late setup doesn't send both at once.
                if days_left <= days and getattr(year, field) is None:
                    if days == 30 and days_left <= 7:
                        setattr(year, field, clock.now().astimezone(timezone.utc))
                        continue
                    send_warnings(session, year, days_left)
                    setattr(year, field, clock.now().astimezone(timezone.utc))
            session.add(year)
            session.commit()


async def job_loop(engine: Engine, clock: Clock) -> None:
    while True:
        try:
            await asyncio.to_thread(run_daily, engine, clock)
        except Exception:
            log.exception("Daily job failed")
        await asyncio.sleep(CHECK_INTERVAL_SECONDS)
