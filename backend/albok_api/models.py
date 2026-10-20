from datetime import datetime, timezone

from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Subject(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(unique=True)
    slug: str = Field(unique=True, index=True)
    description: str = ""
    color: str  # hex color used for accents in the UI
    icon: str  # lucide icon key, mapped to a component in the frontend
    position: int = 0
    created_at: datetime = Field(default_factory=utcnow)


class Book(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    subject_id: int = Field(foreign_key="subject.id", index=True, ondelete="CASCADE")
    title: str
    source_filename: str | None = None
    created_at: datetime = Field(default_factory=utcnow)


class Section(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    book_id: int = Field(foreign_key="book.id", index=True, ondelete="CASCADE")
    position: int
    title: str
    content: str
    word_count: int = 0
    completed: bool = False
    last_opened_at: datetime | None = None


class Note(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    subject_id: int = Field(foreign_key="subject.id", index=True, ondelete="CASCADE")
    # Notes outlive the book they were taken on: deleting a book only unlinks them.
    section_id: int | None = Field(default=None, foreign_key="section.id", index=True, ondelete="SET NULL")
    title: str = ""
    content: str = ""
    pinned: bool = False
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
