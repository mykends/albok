"""Professor-side permission checks. Student checks live in access.py (`access_at`)."""

from fastapi import HTTPException
from sqlmodel import Session, select

from .access import current_school_year, substitute_can_access
from .clock import Clock
from .models import Book, SchoolClass, Section, Subject, TeachingAssignment, User


def subject_classes(session: Session, subject: Subject, clock: Clock) -> list[SchoolClass]:
    """Classes the subject is taught to this school year."""
    year = current_school_year(session, clock.today())
    if year is None:
        return []
    return list(
        session.exec(
            select(SchoolClass)
            .join(TeachingAssignment, TeachingAssignment.class_id == SchoolClass.id)
            .where(TeachingAssignment.subject_id == subject.id, SchoolClass.school_year_id == year.id)
            .order_by(SchoolClass.name)
        ).all()
    )


def _get_subject(session: Session, subject_id: int) -> Subject:
    subject = session.get(Subject, subject_id)
    if subject is None:
        raise HTTPException(status_code=404, detail="Predmet ne postoji.")
    return subject


def owned_subject(session: Session, user: User, subject_id: int) -> Subject:
    subject = _get_subject(session, subject_id)
    if subject.professor_id != user.id:
        raise HTTPException(status_code=403, detail="Ovo nije vaš predmet.")
    return subject


def viewable_subject(session: Session, user: User, subject_id: int, clock: Clock) -> Subject:
    """The owner, or a substitute professor during the slot they cover."""
    subject = _get_subject(session, subject_id)
    if subject.professor_id == user.id or substitute_can_access(session, user, subject.id, None, clock.now()):
        return subject
    raise HTTPException(status_code=403, detail="Ovo nije vaš predmet.")


def owned_book(session: Session, user: User, book_id: int) -> tuple[Book, Subject]:
    book = session.get(Book, book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Knjiga ne postoji.")
    return book, owned_subject(session, user, book.subject_id)


def viewable_book(session: Session, user: User, book_id: int, clock: Clock) -> tuple[Book, Subject]:
    book = session.get(Book, book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Knjiga ne postoji.")
    return book, viewable_subject(session, user, book.subject_id, clock)


def owned_section(session: Session, user: User, section_id: int) -> tuple[Section, Book, Subject]:
    section = session.get(Section, section_id)
    if section is None:
        raise HTTPException(status_code=404, detail="Cjelina ne postoji.")
    book, subject = owned_book(session, user, section.book_id)
    return section, book, subject


def check_can_publish(session: Session, user: User, subject: Subject, class_id: int, clock: Clock) -> None:
    """Owners publish to the classes they teach this subject to; substitutes to the covered class."""
    if subject.professor_id == user.id and class_id in {c.id for c in subject_classes(session, subject, clock)}:
        return
    if substitute_can_access(session, user, subject.id, class_id, clock.now()):
        return
    raise HTTPException(status_code=403, detail="Ovom razredu ne predajete ovaj predmet.")
