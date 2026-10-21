from datetime import date, datetime, time
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from .access import AccessScope

# --- Me ---------------------------------------------------------------------------------------


class LessonRef(BaseModel):
    slot_id: int
    date: date
    class_id: int
    subject_id: int
    starts_at: time
    ends_at: time


class ScopeRead(BaseModel):
    mode: Literal["lesson", "free", "staff"]
    lesson: LessonRef | None
    day_ends_at: datetime | None

    @classmethod
    def from_scope(cls, scope: AccessScope) -> "ScopeRead":
        lesson = None
        if scope.lesson:
            lesson = LessonRef(
                slot_id=scope.lesson.slot_id,
                date=scope.lesson.date,
                class_id=scope.lesson.class_id,
                subject_id=scope.lesson.subject_id,
                starts_at=scope.lesson.starts_at,
                ends_at=scope.lesson.ends_at,
            )
        return cls(mode=scope.mode, lesson=lesson, day_ends_at=scope.day_ends_at)


class MeRead(BaseModel):
    id: int
    username: str
    display_name: str
    email: str | None
    is_student: bool
    is_professor: bool
    is_admin: bool
    class_names: list[str]
    server_time: datetime
    idle_minutes: int
    session_expires_at: datetime | None
    scope: ScopeRead


class LogoutResult(BaseModel):
    end_session_url: str | None


# --- Shared ------------------------------------------------------------------------------------


class SubjectInfo(BaseModel):
    id: int
    name: str
    description: str
    color: str
    icon: str


class ClassRef(BaseModel):
    id: int
    name: str
    year_level: int


# --- Student ----------------------------------------------------------------------------------


class SectionRef(BaseModel):
    id: int
    title: str
    book_id: int
    book_title: str
    page_count: int


class StudentSubject(SubjectInfo):
    professor_name: str
    sections: list[SectionRef]


class CurrentLesson(BaseModel):
    id: int
    date: date
    starts_at: time
    ends_at: time
    subject_id: int
    subject_name: str
    class_name: str
    title: str


class NowRead(BaseModel):
    mode: Literal["lesson", "free"]
    server_time: datetime
    day_ends_at: datetime | None
    lesson: CurrentLesson | None
    subjects: list[StudentSubject]


class ReaderSection(BaseModel):
    id: int
    title: str
    book_id: int
    book_title: str
    subject: SubjectInfo
    page_start: int
    page_end: int
    page_count: int
    prev_id: int | None
    next_id: int | None
    index: int
    total: int


class NoteSectionLink(BaseModel):
    id: int
    title: str
    # False if the section was unpublished or is outside the current lesson's subject.
    available: bool


class NoteRead(BaseModel):
    id: int | None
    lesson_id: int
    subject_id: int
    subject_name: str
    subject_color: str
    date: date
    starts_at: time
    title: str
    content: str
    updated_at: datetime | None
    sections: list[NoteSectionLink]
    editable: bool
    is_current: bool


class NoteWrite(BaseModel):
    content: str = Field(max_length=200_000)


class ExportRequest(BaseModel):
    kind: Literal["subject", "all"]
    subject_id: int | None = None


class ExportQuota(BaseModel):
    email: str | None
    subject_available: bool
    all_available: bool


class ExportAccepted(BaseModel):
    email: str


# --- Professor ---------------------------------------------------------------------------------


class ProfessorSubject(SubjectInfo):
    timetable_name: str
    classes: list[ClassRef]
    book_count: int
    section_count: int


class SubjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=300)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    icon: str | None = Field(default=None, max_length=40)


class FileRead(BaseModel):
    id: int
    status: Literal["processing", "ready", "failed"]
    error: str | None
    original_filename: str
    original_size: int
    pdf_size: int
    page_count: int
    created_at: datetime


class ProfessorSection(BaseModel):
    id: int
    position: int
    title: str
    page_start: int
    page_end: int
    published_class_ids: list[int]
    included_class_ids: list[int]


class BookRead(BaseModel):
    id: int
    subject_id: int
    title: str
    position: int
    exportable: bool
    created_at: datetime
    file: FileRead | None
    pending_file: FileRead | None
    sections: list[ProfessorSection]


class BookUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    exportable: bool | None = None
    position: int | None = Field(default=None, ge=0)


class TextUpload(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1)


class SectionDraft(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    page_start: int = Field(ge=1)
    page_end: int = Field(ge=1)

    @field_validator("page_end")
    @classmethod
    def _end_after_start(cls, value: int, info) -> int:
        start = info.data.get("page_start")
        if start is not None and value < start:
            raise ValueError("Zadnja stranica ne može biti prije prve.")
        return value


class SectionUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    page_start: int | None = Field(default=None, ge=1)
    page_end: int | None = Field(default=None, ge=1)


class SplitRequest(BaseModel):
    at_page: int = Field(ge=2, description="First page of the new, second part")
    title: str | None = Field(default=None, max_length=200)


class SectionIds(BaseModel):
    section_ids: list[int] = Field(min_length=1)


class PublishState(BaseModel):
    published: bool


class IncludeState(BaseModel):
    included: bool


class Suggestion(BaseModel):
    title: str
    page_start: int
    page_end: int


class ReplaceProposal(BaseModel):
    file: FileRead
    suggestions: list[Suggestion]
    # old section id -> index in `suggestions`, or None if it has no counterpart
    mapping: dict[int, int | None]


class ReplaceConfirm(BaseModel):
    sections: list[SectionDraft] = Field(min_length=1)
    mapping: dict[int, int | None]


class PresetRead(BaseModel):
    id: int
    subject_id: int
    year_level: int
    section_ids: list[int]


class PresetWrite(BaseModel):
    year_level: int = Field(ge=1, le=8)
    section_ids: list[int] = []


class PresetUpdate(BaseModel):
    section_ids: list[int]


class WebToolRead(BaseModel):
    id: int
    subject_id: int
    name: str
    url: str
    position: int


class WebToolWrite(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    # Checked by web_tools.normalize_link, which gives the professor a reason.
    url: str = Field(max_length=2000)


class WebToolUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    url: str | None = Field(default=None, max_length=2000)
    position: int | None = Field(default=None, ge=0)


class WebToolOpenState(BaseModel):
    open: bool


class LessonToolState(WebToolRead):
    open: bool


class TeachingLesson(BaseModel):
    """A lesson the professor is teaching right now, with the subject's web tools."""

    lesson_id: int
    date: date
    starts_at: time
    ends_at: time
    class_name: str
    subject_id: int
    subject_name: str
    substitute: bool
    # False for a substitute covering another professor's Subject: he may open its tools, not change the list.
    can_edit_tools: bool
    tools: list[LessonToolState]


# --- Admin ------------------------------------------------------------------------------------


class YearWrite(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    start: date
    end: date
    deletion_date: date
    day_end_time: time = time(15, 0)
    week_a_monday: date | None = None


class YearRead(YearWrite):
    id: int
    is_current: bool
    purged_at: datetime | None


class CalendarDayRead(BaseModel):
    id: int
    date: date
    label: str


class CalendarDaysWrite(BaseModel):
    start: date
    end: date | None = None
    label: str = Field(default="", max_length=100)


class ClassRead(ClassRef):
    student_count: int


class ClassWrite(BaseModel):
    name: str = Field(min_length=1, max_length=20)
    year_level: int = Field(ge=1, le=8)


class ImportIssue(BaseModel):
    line: int
    message: str


class ImportReport(BaseModel):
    dry_run: bool
    rows: int
    created: dict[str, int]
    updated: dict[str, int]
    removed: dict[str, int]
    errors: list[ImportIssue]
    warnings: list[ImportIssue]


class SlotRead(BaseModel):
    id: int
    weekday: int
    starts_at: time
    ends_at: time
    week: str | None
    class_id: int
    class_name: str
    subject_id: int
    subject_name: str
    professor_id: int
    professor_name: str


class SlotWrite(BaseModel):
    weekday: int = Field(ge=1, le=7)
    starts_at: time
    ends_at: time
    week: Literal["A", "B"] | None = None
    class_id: int
    subject_name: str = Field(min_length=1, max_length=100)
    professor_id: int


class OverrideRead(BaseModel):
    id: int
    slot_id: int
    date: date
    cancelled: bool
    substitute_professor_id: int | None
    substitute_professor_name: str | None
    substitute_subject_id: int | None
    substitute_subject_name: str | None
    slot: SlotRead | None


class OverrideWrite(BaseModel):
    slot_id: int
    date: date
    cancelled: bool = False
    substitute_professor_id: int | None = None
    substitute_subject_id: int | None = None


class UserAdminRead(BaseModel):
    id: int
    username: str
    display_name: str
    email: str | None
    is_student: bool
    is_professor: bool
    is_admin: bool
    active: bool
    signed_in: bool
    last_login_at: datetime | None
    class_names: list[str]


class UserAdminUpdate(BaseModel):
    is_professor: bool | None = None
    is_admin: bool | None = None
    active: bool | None = None


class StorageByProfessor(BaseModel):
    professor_id: int
    professor_name: str
    book_count: int
    bytes: int


class StorageRead(BaseModel):
    total_bytes: int
    originals_bytes: int
    pdf_bytes: int
    cache_bytes: int
    free_bytes: int | None
    by_professor: list[StorageByProfessor]


class SubjectOption(BaseModel):
    id: int
    name: str
    professor_id: int
    professor_name: str
