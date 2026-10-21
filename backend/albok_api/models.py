"""Database tables. See docs/specs/professor-student-roles.md ("Data model") for the design.

Rows marked "per school year" are deleted by the year-end job; subjects, books, sections, presets and web
tools persist. Lesson rows (and with them notes and the lesson's web tools) go with their classes.
"""

from datetime import date as Date, datetime, time, timezone
from typing import Any

from sqlalchemy import JSON, Column, DateTime, Text, TypeDecorator, UniqueConstraint
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UTCDateTime(TypeDecorator):
    """Stores naive UTC and returns aware UTC, so SQLite (tests, dev) and PostgreSQL behave the same."""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("Naive datetimes are not allowed; use aware UTC values")
        return value.astimezone(timezone.utc).replace(tzinfo=None)

    def process_result_value(self, value: datetime | None, dialect) -> datetime | None:
        return value.replace(tzinfo=timezone.utc) if value is not None else None


def Timestamp(**kwargs: Any) -> Any:
    nullable = kwargs.pop("nullable", False)
    return Field(sa_column=Column(UTCDateTime, nullable=nullable), **kwargs)


# --- People and sessions ------------------------------------------------------------


class User(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    # OIDC `sub` (= hrEduPersonPersistentID). Empty until the first login; roster rows are matched by username.
    sub: str | None = Field(default=None, unique=True, index=True)
    # AAI username (hrEduPersonUniqueID), lowercase, e.g. ime.prezime@skole.hr
    username: str = Field(unique=True, index=True)
    display_name: str = ""
    email: str | None = None
    is_student: bool = False
    is_professor: bool = False
    is_admin: bool = False
    active: bool = True
    created_at: datetime = Timestamp(default_factory=utcnow)
    last_login_at: datetime | None = Timestamp(default=None, nullable=True)


class UserSession(SQLModel, table=True):
    # SHA-256 of the cookie value, so a database dump can't be used to sign in.
    id: str = Field(primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True, ondelete="CASCADE")
    created_at: datetime = Timestamp(default_factory=utcnow)
    last_activity_at: datetime = Timestamp(default_factory=utcnow)
    idle_minutes: int
    # Absolute end: the end of the school day for students, a fixed length for staff.
    expires_at: datetime | None = Timestamp(default=None, nullable=True)
    # Sent back to the provider's end_session_endpoint at sign-out.
    id_token: str | None = Field(default=None, sa_column=Column(Text))


# --- School data (per school year) --------------------------------------------------------


class SchoolYear(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str  # "2026./2027."
    start: Date
    end: Date
    deletion_date: Date
    day_end_time: time = time(15, 0)
    # Monday of a week that counts as an "A" week; defaults to the week of `start`.
    week_a_monday: Date | None = None
    warning_30_sent_at: datetime | None = Timestamp(default=None, nullable=True)
    warning_7_sent_at: datetime | None = Timestamp(default=None, nullable=True)
    purged_at: datetime | None = Timestamp(default=None, nullable=True)


class CalendarDay(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("school_year_id", "date"),)
    id: int | None = Field(default=None, primary_key=True)
    school_year_id: int = Field(foreign_key="schoolyear.id", index=True, ondelete="CASCADE")
    date: Date
    kind: str = "non_teaching"
    label: str = ""


class SchoolClass(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("school_year_id", "name"),)
    id: int | None = Field(default=None, primary_key=True)
    school_year_id: int = Field(foreign_key="schoolyear.id", index=True, ondelete="CASCADE")
    name: str  # "3.B"
    year_level: int


class Enrollment(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("student_id", "class_id"),)
    id: int | None = Field(default=None, primary_key=True)
    student_id: int = Field(foreign_key="user.id", index=True, ondelete="CASCADE")
    class_id: int = Field(foreign_key="schoolclass.id", index=True, ondelete="CASCADE")


# --- Subjects and timetable ----------------------------------------------------------------


class Subject(SQLModel, table=True):
    """One per professor per timetable subject name, shared across their classes. Persists across years."""

    __table_args__ = (UniqueConstraint("professor_id", "timetable_name"),)
    id: int | None = Field(default=None, primary_key=True)
    professor_id: int = Field(foreign_key="user.id", index=True)
    # The name used in the timetable import; `name` is what the professor chooses to show.
    timetable_name: str
    name: str
    description: str = ""
    color: str = "#2563eb"
    icon: str = "book-open"
    created_at: datetime = Timestamp(default_factory=utcnow)


class TeachingAssignment(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("subject_id", "class_id"),)
    id: int | None = Field(default=None, primary_key=True)
    school_year_id: int = Field(foreign_key="schoolyear.id", index=True, ondelete="CASCADE")
    subject_id: int = Field(foreign_key="subject.id", index=True, ondelete="CASCADE")
    class_id: int = Field(foreign_key="schoolclass.id", index=True, ondelete="CASCADE")


class TimetableSlot(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    assignment_id: int = Field(foreign_key="teachingassignment.id", index=True, ondelete="CASCADE")
    weekday: int  # ISO: 1 = Monday
    starts_at: time
    ends_at: time
    week: str | None = None  # "A", "B" or None for every week


class LessonOverride(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("slot_id", "date"),)
    id: int | None = Field(default=None, primary_key=True)
    slot_id: int = Field(foreign_key="timetableslot.id", index=True, ondelete="CASCADE")
    date: Date
    cancelled: bool = False
    substitute_professor_id: int | None = Field(default=None, foreign_key="user.id", ondelete="SET NULL")
    substitute_subject_id: int | None = Field(default=None, foreign_key="subject.id", ondelete="SET NULL")


class Lesson(SQLModel, table=True):
    """A real class session. Class, subject and times are copied from the slot so re-importing the
    timetable (which can delete slots) never deletes students' notes."""

    __table_args__ = (UniqueConstraint("slot_id", "date"),)
    id: int | None = Field(default=None, primary_key=True)
    slot_id: int | None = Field(default=None, foreign_key="timetableslot.id", index=True, ondelete="SET NULL")
    class_id: int = Field(foreign_key="schoolclass.id", index=True, ondelete="CASCADE")
    subject_id: int = Field(foreign_key="subject.id", index=True, ondelete="CASCADE")
    date: Date
    starts_at: time
    ends_at: time


# --- Content -----------------------------------------------------------------------------


class Book(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    subject_id: int = Field(foreign_key="subject.id", index=True, ondelete="CASCADE")
    title: str
    # True while the title is just the filename; processing replaces it with the document's own title.
    title_from_file: bool = False
    position: int = 0
    exportable: bool = False
    created_at: datetime = Timestamp(default_factory=utcnow)


class BookFile(SQLModel, table=True):
    """An uploaded original and the PDF made from it. A book has one `current` file and, while a
    replacement is being reviewed, one `pending` file."""

    id: int | None = Field(default=None, primary_key=True)
    book_id: int = Field(foreign_key="book.id", index=True, ondelete="CASCADE")
    state: str = "current"  # current | pending
    status: str = "processing"  # processing | ready | failed
    error: str | None = None
    original_filename: str
    original_path: str  # relative to settings.files_dir
    original_size: int = 0
    pdf_path: str | None = None
    pdf_size: int = 0
    page_count: int = 0
    # Suggested sections: [{"title", "page_start", "page_end", "text"}]
    suggestions: list[dict] | None = Field(default=None, sa_column=Column(JSON))
    created_at: datetime = Timestamp(default_factory=utcnow)


class Section(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    book_id: int = Field(foreign_key="book.id", index=True, ondelete="CASCADE")
    position: int
    title: str
    page_start: int  # 1-based, inclusive
    page_end: int
    # For search and heading detection only; never shown to students.
    extracted_text: str = Field(default="", sa_column=Column(Text, nullable=False, default=""))


class Inclusion(SQLModel, table=True):
    """Which sections a class covers this year (from a preset or set by hand)."""

    __table_args__ = (UniqueConstraint("section_id", "class_id"),)
    id: int | None = Field(default=None, primary_key=True)
    section_id: int = Field(foreign_key="section.id", index=True, ondelete="CASCADE")
    class_id: int = Field(foreign_key="schoolclass.id", index=True, ondelete="CASCADE")


class Publication(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("section_id", "class_id"),)
    id: int | None = Field(default=None, primary_key=True)
    section_id: int = Field(foreign_key="section.id", index=True, ondelete="CASCADE")
    class_id: int = Field(foreign_key="schoolclass.id", index=True, ondelete="CASCADE")
    published_at: datetime = Timestamp(default_factory=utcnow)


class Preset(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("subject_id", "year_level"),)
    id: int | None = Field(default=None, primary_key=True)
    subject_id: int = Field(foreign_key="subject.id", index=True, ondelete="CASCADE")
    year_level: int


class PresetSection(SQLModel, table=True):
    preset_id: int = Field(foreign_key="preset.id", primary_key=True, ondelete="CASCADE")
    section_id: int = Field(foreign_key="section.id", primary_key=True, ondelete="CASCADE")


class WebTool(SQLModel, table=True):
    """An external site the professor names for the subject. Not per school year: it carries over like books."""

    id: int | None = Field(default=None, primary_key=True)
    subject_id: int = Field(foreign_key="subject.id", index=True, ondelete="CASCADE")
    name: str
    url: str = Field(sa_column=Column(Text, nullable=False))  # checked by web_tools.normalize_link
    position: int = 0
    created_at: datetime = Timestamp(default_factory=utcnow)


# --- Student work --------------------------------------------------------------------------


class Note(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("student_id", "lesson_id"),)
    id: int | None = Field(default=None, primary_key=True)
    student_id: int = Field(foreign_key="user.id", index=True, ondelete="CASCADE")
    lesson_id: int = Field(foreign_key="lesson.id", index=True, ondelete="CASCADE")
    content: str = Field(default="", sa_column=Column(Text, nullable=False, default=""))
    created_at: datetime = Timestamp(default_factory=utcnow)
    updated_at: datetime = Timestamp(default_factory=utcnow)


class NoteSection(SQLModel, table=True):
    """Sections the student had open during the lesson. Deleting a section removes only the link."""

    note_id: int = Field(foreign_key="note.id", primary_key=True, ondelete="CASCADE")
    section_id: int = Field(foreign_key="section.id", primary_key=True, ondelete="CASCADE")


class LessonWebTool(SQLModel, table=True):
    """A web tool the professor opened for one lesson. Deleting the tool or the lesson closes it.
    Albok keeps only this, never what students did in the tool."""

    lesson_id: int = Field(foreign_key="lesson.id", primary_key=True, ondelete="CASCADE")
    web_tool_id: int = Field(foreign_key="webtool.id", primary_key=True, index=True, ondelete="CASCADE")
    opened_at: datetime = Timestamp(default_factory=utcnow)


class ExportLog(SQLModel, table=True):
    # One export of each kind per student per day.
    __table_args__ = (UniqueConstraint("student_id", "date", "kind"),)
    id: int | None = Field(default=None, primary_key=True)
    student_id: int = Field(foreign_key="user.id", index=True, ondelete="CASCADE")
    date: Date
    kind: str  # subject | all
    subject_id: int | None = Field(default=None, foreign_key="subject.id", ondelete="SET NULL")
    status: str = "pending"  # pending | sent | failed
    created_at: datetime = Timestamp(default_factory=utcnow)
