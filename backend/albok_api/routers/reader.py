"""Section metadata and section PDFs, for students (published sections, subject to the time rule) and
professors (their own subjects, optionally previewing what one class sees)."""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlmodel import Session, select

from ..access import AccessScope, access_at, visible_sections
from ..auth import get_current_user
from ..clock import Clock, get_clock
from ..db import get_session
from ..documents import section_pdf
from ..models import Book, BookFile, Section, Subject, User
from ..permissions import check_can_publish, viewable_subject
from ..schemas import ReaderSection, SubjectInfo

router = APIRouter(prefix="/api", tags=["reader"])

NOT_AVAILABLE = "Ovo gradivo trenutačno nije dostupno."


def _ordered_ids(
    session: Session, user: User, section: Section, book: Book, preview_class_id: int | None, clock: Clock
) -> list[int]:
    """The sections the user can move between with ← / → (same subject), raising if this one isn't among them."""
    if user.is_professor:
        subject = viewable_subject(session, user, book.subject_id, clock)
        if preview_class_id is not None:
            check_can_publish(session, user, subject, preview_class_id, clock)
            scope = AccessScope(mode="free", user_id=user.id, class_ids=[preview_class_id])
            ids = [s.id for s, b in visible_sections(session, scope) if b.subject_id == subject.id]
        else:
            ids = list(
                session.exec(
                    select(Section.id)
                    .join(Book, Book.id == Section.book_id)
                    .where(Book.subject_id == subject.id)
                    .order_by(Book.position, Book.id, Section.position)
                ).all()
            )
    elif user.is_student:
        scope = access_at(session, user, clock.now())
        ids = [s.id for s, b in visible_sections(session, scope) if b.subject_id == book.subject_id]
    else:
        raise HTTPException(status_code=403, detail=NOT_AVAILABLE)
    if section.id not in ids:
        raise HTTPException(status_code=403, detail=NOT_AVAILABLE)
    return ids


def _load(session: Session, section_id: int) -> tuple[Section, Book, BookFile]:
    section = session.get(Section, section_id)
    if section is None:
        raise HTTPException(status_code=404, detail="Cjelina ne postoji.")
    book = session.get(Book, section.book_id)
    book_file = session.exec(
        select(BookFile).where(BookFile.book_id == book.id, BookFile.state == "current", BookFile.status == "ready")
    ).first()
    if book_file is None:
        raise HTTPException(status_code=404, detail="Datoteka se još obrađuje.")
    return section, book, book_file


@router.get("/sections/{section_id}", response_model=ReaderSection)
def read_section(
    section_id: int,
    preview_class_id: int | None = None,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
    clock: Clock = Depends(get_clock),
):
    section, book, _ = _load(session, section_id)
    ids = _ordered_ids(session, user, section, book, preview_class_id, clock)
    index = ids.index(section.id)
    subject = session.get(Subject, book.subject_id)
    return ReaderSection(
        id=section.id,
        title=section.title,
        book_id=book.id,
        book_title=book.title,
        subject=SubjectInfo.model_validate(subject, from_attributes=True),
        page_start=section.page_start,
        page_end=section.page_end,
        page_count=section.page_end - section.page_start + 1,
        prev_id=ids[index - 1] if index > 0 else None,
        next_id=ids[index + 1] if index + 1 < len(ids) else None,
        index=index,
        total=len(ids),
    )


@router.get("/sections/{section_id}/pdf")
def read_section_pdf(
    section_id: int,
    preview_class_id: int | None = None,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
    clock: Clock = Depends(get_clock),
):
    """Only the section's pages, never the whole file, so hidden chapters can't be pulled out."""
    section, book, book_file = _load(session, section_id)
    _ordered_ids(session, user, section, book, preview_class_id, clock)
    return FileResponse(
        section_pdf(book_file, section.page_start, section.page_end),
        media_type="application/pdf",
        headers={"Cache-Control": "private, no-store", "Content-Disposition": "inline"},
    )
