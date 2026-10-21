"""What a user may see and do at a given moment.

`access_at` is the ONLY place that decides this for students. It applies the school calendar, the
timetable (A/B weeks), per-date overrides and the lesson window. A future exam or quiet mode plugs in here.
"""

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from typing import Literal

from sqlmodel import Session, col, select

from .models import (
    Book,
    BookFile,
    CalendarDay,
    Enrollment,
    Lesson,
    LessonOverride,
    Publication,
    SchoolClass,
    SchoolYear,
    Section,
    Subject,
    TeachingAssignment,
    TimetableSlot,
    User,
)

# Content for a lesson opens this long before the bell.
LESSON_LEAD = timedelta(minutes=5)


# --- Calendar -------------------------------------------------------------------------------


def current_school_year(session: Session, today: date) -> SchoolYear | None:
    """The latest year that has started and hasn't been purged; before any has started, the next one."""
    years = session.exec(select(SchoolYear).where(col(SchoolYear.purged_at).is_(None)).order_by(SchoolYear.start)).all()
    started = [year for year in years if year.start <= today]
    if started:
        return started[-1]
    return years[0] if years else None


def week_letter(year: SchoolYear, day: date) -> str:
    reference = year.week_a_monday or year.start
    reference_monday = reference - timedelta(days=reference.weekday())
    day_monday = day - timedelta(days=day.weekday())
    return "A" if ((day_monday - reference_monday).days // 7) % 2 == 0 else "B"


def is_teaching_day(session: Session, year: SchoolYear, day: date) -> bool:
    if not (year.start <= day <= year.end):
        return False
    closed = session.exec(
        select(CalendarDay.id).where(CalendarDay.school_year_id == year.id, CalendarDay.date == day)
    ).first()
    return closed is None


# --- Effective lessons ------------------------------------------------------------------------


@dataclass(frozen=True)
class EffectiveLesson:
    """A timetable slot on a date, after overrides."""

    slot_id: int
    date: date
    class_id: int
    subject_id: int
    professor_id: int
    starts_at: time
    ends_at: time
    substitute: bool = False

    def window(self, tz) -> tuple[datetime, datetime]:
        start = datetime.combine(self.date, self.starts_at, tzinfo=tz) - LESSON_LEAD
        return start, datetime.combine(self.date, self.ends_at, tzinfo=tz)

    def is_open(self, now: datetime) -> bool:
        start, end = self.window(now.tzinfo)
        return start <= now < end


def lessons_on(
    session: Session,
    year: SchoolYear,
    day: date,
    class_ids: list[int] | None = None,
) -> list[EffectiveLesson]:
    """All lessons held on `day` (optionally only for some classes), sorted by start time."""
    if not is_teaching_day(session, year, day):
        return []
    query = (
        select(TimetableSlot, TeachingAssignment, Subject)
        .join(TeachingAssignment, TeachingAssignment.id == TimetableSlot.assignment_id)
        .join(Subject, Subject.id == TeachingAssignment.subject_id)
        .where(
            TeachingAssignment.school_year_id == year.id,
            TimetableSlot.weekday == day.isoweekday(),
            col(TimetableSlot.week).is_(None) | (TimetableSlot.week == week_letter(year, day)),
        )
    )
    if class_ids is not None:
        if not class_ids:
            return []
        query = query.where(col(TeachingAssignment.class_id).in_(class_ids))
    rows = session.exec(query).all()
    overrides = {
        o.slot_id: o
        for o in session.exec(
            select(LessonOverride).where(
                LessonOverride.date == day, col(LessonOverride.slot_id).in_([slot.id for slot, _, _ in rows])
            )
        ).all()
    }

    lessons = []
    for slot, assignment, subject in rows:
        override = overrides.get(slot.id)
        if override and override.cancelled:
            continue
        subject_id, professor_id, substitute = subject.id, subject.professor_id, False
        if override and override.substitute_subject_id:
            substitute_subject = session.get(Subject, override.substitute_subject_id)
            if substitute_subject:
                subject_id, professor_id, substitute = substitute_subject.id, substitute_subject.professor_id, True
        if override and override.substitute_professor_id:
            professor_id, substitute = override.substitute_professor_id, True
        lessons.append(
            EffectiveLesson(
                slot_id=slot.id,
                date=day,
                class_id=assignment.class_id,
                subject_id=subject_id,
                professor_id=professor_id,
                starts_at=slot.starts_at,
                ends_at=slot.ends_at,
                substitute=substitute,
            )
        )
    return sorted(lessons, key=lambda lesson: (lesson.starts_at, lesson.slot_id))


def open_lesson(lessons: list[EffectiveLesson], now: datetime) -> EffectiveLesson | None:
    """The lesson whose window contains `now`; back-to-back lessons hand over to the later one."""
    candidates = [lesson for lesson in lessons if lesson.is_open(now)]
    return candidates[-1] if candidates else None


def get_or_create_lesson(session: Session, effective: EffectiveLesson) -> Lesson:
    lesson = session.exec(
        select(Lesson).where(Lesson.slot_id == effective.slot_id, Lesson.date == effective.date)
    ).first()
    if lesson is None:
        lesson = Lesson(
            slot_id=effective.slot_id,
            class_id=effective.class_id,
            subject_id=effective.subject_id,
            date=effective.date,
            starts_at=effective.starts_at,
            ends_at=effective.ends_at,
        )
        session.add(lesson)
        session.flush()
    return lesson


# --- Access scope ----------------------------------------------------------------------------


@dataclass
class AccessScope:
    mode: Literal["lesson", "free", "staff"]
    user_id: int
    year: SchoolYear | None = None
    # The student's classes this school year.
    class_ids: list[int] = field(default_factory=list)
    lesson: EffectiveLesson | None = None
    # When the school day ends (students are signed out then).
    day_ends_at: datetime | None = None

    @property
    def is_student(self) -> bool:
        return self.mode != "staff"

    @property
    def content_class_ids(self) -> list[int]:
        if self.lesson:
            return [self.lesson.class_id]
        return self.class_ids

    @property
    def content_subject_id(self) -> int | None:
        """During a lesson only that subject is visible; None means no subject restriction."""
        return self.lesson.subject_id if self.lesson else None

    def can_read_note(self, lesson: Lesson) -> bool:
        return self.content_subject_id is None or lesson.subject_id == self.content_subject_id

    def can_edit_note(self, lesson: Lesson) -> bool:
        """During a lesson only this lesson's note is editable; outside lessons every note is."""
        if self.lesson:
            return lesson.slot_id == self.lesson.slot_id and lesson.date == self.lesson.date
        return True

    def can_create_note(self, lesson: Lesson, now: datetime) -> bool:
        """Notes are only created for today's lessons that have started, so writes made offline
        during a lesson can still sync after the bell."""
        if lesson.class_id not in self.class_ids or lesson.date != now.date():
            return False
        if self.lesson:
            return lesson.slot_id == self.lesson.slot_id and lesson.date == self.lesson.date
        start = datetime.combine(lesson.date, lesson.starts_at, tzinfo=now.tzinfo) - LESSON_LEAD
        return now >= start


def student_class_ids(session: Session, user: User, year: SchoolYear | None) -> list[int]:
    if year is None:
        return []
    return list(
        session.exec(
            select(Enrollment.class_id)
            .join(SchoolClass, SchoolClass.id == Enrollment.class_id)
            .where(Enrollment.student_id == user.id, SchoolClass.school_year_id == year.id)
        ).all()
    )


def access_at(session: Session, user: User, now: datetime) -> AccessScope:
    year = current_school_year(session, now.date())
    if user.is_professor or user.is_admin:
        return AccessScope(mode="staff", user_id=user.id, year=year)

    class_ids = student_class_ids(session, user, year)
    lesson = open_lesson(lessons_on(session, year, now.date(), class_ids), now) if year else None
    day_ends_at = datetime.combine(now.date(), year.day_end_time, tzinfo=now.tzinfo) if year else None
    return AccessScope(
        mode="lesson" if lesson else "free",
        user_id=user.id,
        year=year,
        class_ids=class_ids,
        lesson=lesson,
        day_ends_at=day_ends_at,
    )


# --- Visible content -------------------------------------------------------------------------


def visible_sections(session: Session, scope: AccessScope) -> list[tuple[Section, Book]]:
    """Published sections a student may open right now, in subject → book → section order."""
    if not scope.content_class_ids:
        return []
    query = (
        select(Section, Book)
        .join(Book, Book.id == Section.book_id)
        .join(Publication, Publication.section_id == Section.id)
        .join(BookFile, (BookFile.book_id == Book.id) & (BookFile.state == "current") & (BookFile.status == "ready"))
        .where(col(Publication.class_id).in_(scope.content_class_ids))
        .distinct()
        .order_by(Book.subject_id, Book.position, Book.id, Section.position)
    )
    if scope.content_subject_id is not None:
        query = query.where(Book.subject_id == scope.content_subject_id)
    return list(session.exec(query).all())


def student_can_open_section(session: Session, scope: AccessScope, section_id: int) -> bool:
    return any(section.id == section_id for section, _ in visible_sections(session, scope))


def teaching_now(session: Session, user: User, now: datetime) -> list[EffectiveLesson]:
    """Lessons the user teaches whose window is open now, as owner or substitute (after overrides).
    Only these lessons can have web tools opened."""
    year = current_school_year(session, now.date())
    if year is None:
        return []
    return [lesson for lesson in lessons_on(session, year, now.date()) if lesson.professor_id == user.id and lesson.is_open(now)]


def substitute_can_access(session: Session, user: User, subject_id: int, class_id: int | None, now: datetime) -> bool:
    """A substitute professor gets access to a subject (for one class) only during the covered slot."""
    year = current_school_year(session, now.date())
    if year is None:
        return False
    for lesson in lessons_on(session, year, now.date()):
        if (
            lesson.substitute
            and lesson.professor_id == user.id
            and lesson.subject_id == subject_id
            and (class_id is None or lesson.class_id == class_id)
            and lesson.is_open(now)
        ):
            return True
    return False
