from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from sqlmodel import Session, col, select

from ..config import settings
from ..db import get_session
from ..importers import BookImportError, ParsedBook, parse_book, parse_text
from ..models import Book, Section, utcnow
from ..schemas import BookRead, RecentSection, SectionRead, SectionSummary, SectionUpdate, TextImport
from .subjects import get_subject_or_404

router = APIRouter(prefix="/api", tags=["books"])


def _summary(section: Section) -> SectionSummary:
    return SectionSummary.model_validate(section, from_attributes=True)


def _save_book(
    session: Session, subject_id: int, parsed: ParsedBook, title: str | None, filename: str | None
) -> BookRead:
    book = Book(subject_id=subject_id, title=(title or "").strip() or parsed.title, source_filename=filename)
    session.add(book)
    session.flush()
    sections = [
        Section(book_id=book.id, position=n, title=s.title, content=s.content, word_count=s.word_count)
        for n, s in enumerate(parsed.sections)
    ]
    session.add_all(sections)
    session.commit()
    session.refresh(book)
    return BookRead(**book.model_dump(), sections=[_summary(s) for s in sections])


@router.get("/subjects/{subject_id}/books", response_model=list[BookRead])
def list_books(subject_id: int, session: Session = Depends(get_session)):
    get_subject_or_404(session, subject_id)
    books = session.exec(select(Book).where(Book.subject_id == subject_id).order_by(col(Book.created_at).desc())).all()
    sections = session.exec(
        select(Section).where(col(Section.book_id).in_([b.id for b in books])).order_by(Section.position)
    ).all()
    by_book: dict[int, list[SectionSummary]] = {}
    for section in sections:
        by_book.setdefault(section.book_id, []).append(_summary(section))
    return [BookRead(**book.model_dump(), sections=by_book.get(book.id, [])) for book in books]


@router.post("/subjects/{subject_id}/books/import", response_model=BookRead, status_code=201)
def import_book_file(
    subject_id: int,
    file: UploadFile = File(...),
    title: str | None = Form(None),
    session: Session = Depends(get_session),
):
    get_subject_or_404(session, subject_id)
    data = file.file.read(settings.max_upload_bytes + 1)
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="File is larger than 50 MB.")
    try:
        parsed = parse_book(file.filename or "upload.txt", data)
    except BookImportError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _save_book(session, subject_id, parsed, title, file.filename)


@router.post("/subjects/{subject_id}/books/text", response_model=BookRead, status_code=201)
def import_book_text(subject_id: int, body: TextImport, session: Session = Depends(get_session)):
    get_subject_or_404(session, subject_id)
    parsed = parse_text(body.text, body.title)
    if not parsed.sections:
        raise HTTPException(status_code=422, detail="The pasted text is empty.")
    return _save_book(session, subject_id, parsed, body.title, None)


@router.delete("/books/{book_id}", status_code=204)
def delete_book(book_id: int, session: Session = Depends(get_session)):
    book = session.get(Book, book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    session.delete(book)
    session.commit()
    return Response(status_code=204)


# Must be registered before /sections/{section_id} so "recent" isn't parsed as an id.
@router.get("/sections/recent", response_model=list[RecentSection])
def recent_sections(limit: int = Query(default=5, ge=1, le=50), session: Session = Depends(get_session)):
    rows = session.exec(
        select(Section, Book)
        .join(Book, Book.id == Section.book_id)
        .where(col(Section.last_opened_at).is_not(None))
        .order_by(col(Section.last_opened_at).desc())
        .limit(limit)
    ).all()
    return [
        RecentSection(**_summary(section).model_dump(), book_id=book.id, book_title=book.title, subject_id=book.subject_id)
        for section, book in rows
    ]


@router.get("/sections/{section_id}", response_model=SectionRead)
def read_section(section_id: int, session: Session = Depends(get_session)):
    """Opening a section in the reader also records it as recently opened."""
    section = session.get(Section, section_id)
    if section is None:
        raise HTTPException(status_code=404, detail="Section not found")
    book = session.get(Book, section.book_id)
    sibling_ids = list(session.exec(select(Section.id).where(Section.book_id == book.id).order_by(Section.position)).all())
    index = sibling_ids.index(section.id)

    section.last_opened_at = utcnow()
    session.add(section)
    session.commit()
    session.refresh(section)

    return SectionRead(
        **_summary(section).model_dump(),
        content=section.content,
        book_id=book.id,
        book_title=book.title,
        subject_id=book.subject_id,
        prev_id=sibling_ids[index - 1] if index > 0 else None,
        next_id=sibling_ids[index + 1] if index + 1 < len(sibling_ids) else None,
        total_sections=len(sibling_ids),
    )


@router.patch("/sections/{section_id}", response_model=SectionSummary)
def update_section(section_id: int, body: SectionUpdate, session: Session = Depends(get_session)):
    section = session.get(Section, section_id)
    if section is None:
        raise HTTPException(status_code=404, detail="Section not found")
    if body.completed is not None:
        section.completed = body.completed
    session.add(section)
    session.commit()
    session.refresh(section)
    return _summary(section)
