from datetime import datetime

from pydantic import BaseModel, Field


class SubjectRead(BaseModel):
    id: int
    name: str
    slug: str
    description: str
    color: str
    icon: str
    book_count: int = 0
    section_count: int = 0
    completed_section_count: int = 0
    note_count: int = 0


class SectionSummary(BaseModel):
    id: int
    position: int
    title: str
    word_count: int
    completed: bool
    last_opened_at: datetime | None


class BookRead(BaseModel):
    id: int
    subject_id: int
    title: str
    source_filename: str | None
    created_at: datetime
    sections: list[SectionSummary]


class SectionRead(SectionSummary):
    content: str
    book_id: int
    book_title: str
    subject_id: int
    prev_id: int | None
    next_id: int | None
    total_sections: int


class RecentSection(SectionSummary):
    book_id: int
    book_title: str
    subject_id: int


class SectionUpdate(BaseModel):
    completed: bool | None = None


class TextImport(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1)


class NoteCreate(BaseModel):
    title: str = Field(default="", max_length=200)
    content: str = ""
    section_id: int | None = None
    pinned: bool = False


class NoteUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    content: str | None = None
    section_id: int | None = None
    pinned: bool | None = None


class NoteRead(BaseModel):
    id: int
    subject_id: int
    section_id: int | None
    section_title: str | None
    title: str
    content: str
    pinned: bool
    created_at: datetime
    updated_at: datetime
