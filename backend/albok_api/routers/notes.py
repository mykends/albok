from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlmodel import Session, col, or_, select

from ..db import get_session
from ..models import Book, Note, Section, utcnow
from ..schemas import NoteCreate, NoteRead, NoteUpdate
from .subjects import get_subject_or_404

router = APIRouter(prefix="/api", tags=["notes"])


def _note_read(note: Note, section_title: str | None) -> NoteRead:
    return NoteRead(**note.model_dump(), section_title=section_title)


def _section_title(session: Session, note: Note) -> str | None:
    section = session.get(Section, note.section_id) if note.section_id else None
    return section.title if section else None


def _check_section_in_subject(session: Session, section_id: int | None, subject_id: int) -> None:
    if section_id is None:
        return
    row = session.exec(select(Book.subject_id).join(Section, Section.book_id == Book.id).where(Section.id == section_id)).first()
    if row != subject_id:
        raise HTTPException(status_code=422, detail="Section does not belong to this subject")


def _base_query():
    return select(Note, Section.title).join(Section, col(Section.id) == Note.section_id, isouter=True)


@router.get("/subjects/{subject_id}/notes", response_model=list[NoteRead])
def list_notes(
    subject_id: int,
    q: str | None = Query(default=None, max_length=200),
    section_id: int | None = None,
    session: Session = Depends(get_session),
):
    get_subject_or_404(session, subject_id)
    query = _base_query().where(Note.subject_id == subject_id)
    if section_id is not None:
        query = query.where(Note.section_id == section_id)
    if q and q.strip():
        term = q.strip()
        query = query.where(
            or_(col(Note.title).icontains(term, autoescape=True), col(Note.content).icontains(term, autoescape=True))
        )
    rows = session.exec(query.order_by(col(Note.pinned).desc(), col(Note.updated_at).desc())).all()
    return [_note_read(note, title) for note, title in rows]


@router.get("/notes/recent", response_model=list[NoteRead])
def recent_notes(limit: int = Query(default=5, ge=1, le=50), session: Session = Depends(get_session)):
    rows = session.exec(_base_query().order_by(col(Note.updated_at).desc()).limit(limit)).all()
    return [_note_read(note, title) for note, title in rows]


@router.post("/subjects/{subject_id}/notes", response_model=NoteRead, status_code=201)
def create_note(subject_id: int, body: NoteCreate, session: Session = Depends(get_session)):
    get_subject_or_404(session, subject_id)
    _check_section_in_subject(session, body.section_id, subject_id)
    note = Note(subject_id=subject_id, **body.model_dump())
    session.add(note)
    session.commit()
    session.refresh(note)
    return _note_read(note, _section_title(session, note))


@router.patch("/notes/{note_id}", response_model=NoteRead)
def update_note(note_id: int, body: NoteUpdate, session: Session = Depends(get_session)):
    note = session.get(Note, note_id)
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    # exclude_unset lets clients send section_id: null to unlink a note from its section
    changes = body.model_dump(exclude_unset=True)
    if changes.get("section_id") is not None:
        _check_section_in_subject(session, changes["section_id"], note.subject_id)
    for key, value in changes.items():
        if value is not None or key == "section_id":
            setattr(note, key, value)
    note.updated_at = utcnow()
    session.add(note)
    session.commit()
    session.refresh(note)
    return _note_read(note, _section_title(session, note))


@router.delete("/notes/{note_id}", status_code=204)
def delete_note(note_id: int, session: Session = Depends(get_session)):
    note = session.get(Note, note_id)
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    session.delete(note)
    session.commit()
    return Response(status_code=204)
