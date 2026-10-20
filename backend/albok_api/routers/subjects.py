from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import case, func
from sqlmodel import Session, select

from ..db import get_session
from ..models import Book, Note, Section, Subject
from ..schemas import SubjectRead

router = APIRouter(prefix="/api/subjects", tags=["subjects"])


def get_subject_or_404(session: Session, subject_id: int) -> Subject:
    subject = session.get(Subject, subject_id)
    if subject is None:
        raise HTTPException(status_code=404, detail="Subject not found")
    return subject


def _with_counts(session: Session, subjects: list[Subject]) -> list[SubjectRead]:
    books = dict(session.exec(select(Book.subject_id, func.count(Book.id)).group_by(Book.subject_id)).all())
    notes = dict(session.exec(select(Note.subject_id, func.count(Note.id)).group_by(Note.subject_id)).all())
    sections = {
        subject_id: (total, done or 0)
        for subject_id, total, done in session.exec(
            select(Book.subject_id, func.count(Section.id), func.sum(case((Section.completed, 1), else_=0)))
            .join(Section, Section.book_id == Book.id)
            .group_by(Book.subject_id)
        ).all()
    }
    return [
        SubjectRead(
            **subject.model_dump(),
            book_count=books.get(subject.id, 0),
            note_count=notes.get(subject.id, 0),
            section_count=sections.get(subject.id, (0, 0))[0],
            completed_section_count=sections.get(subject.id, (0, 0))[1],
        )
        for subject in subjects
    ]


@router.get("", response_model=list[SubjectRead])
def list_subjects(session: Session = Depends(get_session)):
    subjects = session.exec(select(Subject).order_by(Subject.position, Subject.id)).all()
    return _with_counts(session, list(subjects))


@router.get("/{subject_id}", response_model=SubjectRead)
def read_subject(subject_id: int, session: Session = Depends(get_session)):
    return _with_counts(session, [get_subject_or_404(session, subject_id)])[0]
