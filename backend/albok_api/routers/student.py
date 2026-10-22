"""Student endpoints. Every decision about what is visible or editable comes from `access_at`."""

from datetime import timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlmodel import Session, col, select

from ..access import AccessScope, get_or_create_lesson, visible_sections
from ..auth import require_student, student_scope
from ..clock import Clock, format_lesson_date, get_clock
from ..db import get_session
from ..models import (
    Book,
    Lesson,
    Note,
    NoteSection,
    SchoolClass,
    Section,
    Subject,
    TeachingAssignment,
    User,
)
from ..note_html import clean_note
from ..schemas import (
    CurrentLesson,
    NoteRead,
    NoteSectionLink,
    NoteWrite,
    NowRead,
    SectionRef,
    StudentSubject,
)

router = APIRouter(prefix="/api", tags=["student"])


def lesson_title(subject_name: str, lesson: Lesson) -> str:
    return f"{subject_name} · {format_lesson_date(lesson.date)}"


def student_subjects(session: Session, subjects: list[Subject], rows: list[tuple[Section, Book]]) -> list[StudentSubject]:
    by_subject: dict[int, list[SectionRef]] = {}
    for section, book in rows:
        by_subject.setdefault(book.subject_id, []).append(
            SectionRef(
                id=section.id,
                title=section.title,
                book_id=book.id,
                book_title=book.title,
                page_count=section.page_end - section.page_start + 1,
            )
        )
    professors = {u.id: u for u in session.exec(select(User).where(col(User.id).in_([s.professor_id for s in subjects]))).all()}
    return [
        StudentSubject(
            id=subject.id,
            name=subject.name,
            description=subject.description,
            color=subject.color,
            icon=subject.icon,
            professor_name=(professors[subject.professor_id].display_name if subject.professor_id in professors else ""),
            sections=by_subject.get(subject.id, []),
        )
        for subject in subjects
    ]


def _scope_subjects(session: Session, scope: AccessScope, rows: list[tuple[Section, Book]]) -> list[Subject]:
    """During a lesson only its subject; otherwise every subject taught to the student's classes
    (even before anything is published) plus any subject with visible sections."""
    if scope.lesson:
        return [session.get(Subject, scope.lesson.subject_id)]
    ids = set(
        session.exec(
            select(TeachingAssignment.subject_id).where(col(TeachingAssignment.class_id).in_(scope.class_ids))
        ).all()
    ) if scope.class_ids else set()
    ids |= {book.subject_id for _, book in rows}
    if not ids:
        return []
    return list(session.exec(select(Subject).where(col(Subject.id).in_(ids)).order_by(Subject.name)).all())


@router.get("/student/now", response_model=NowRead)
def now(
    scope: AccessScope = Depends(student_scope),
    session: Session = Depends(get_session),
    clock: Clock = Depends(get_clock),
):
    rows = visible_sections(session, scope)
    current = None
    if scope.lesson:
        lesson = get_or_create_lesson(session, scope.lesson)
        session.commit()
        subject = session.get(Subject, lesson.subject_id)
        current = CurrentLesson(
            id=lesson.id,
            date=lesson.date,
            starts_at=lesson.starts_at,
            ends_at=lesson.ends_at,
            subject_id=subject.id,
            subject_name=subject.name,
            class_name=session.get(SchoolClass, lesson.class_id).name,
            title=lesson_title(subject.name, lesson),
        )
    return NowRead(
        mode=scope.mode,
        server_time=clock.now(),
        day_ends_at=scope.day_ends_at,
        lesson=current,
        subjects=student_subjects(session, _scope_subjects(session, scope, rows), rows),
    )


# --- Notes --------------------------------------------------------------------------------------


def _note_read(
    session: Session,
    scope: AccessScope,
    lesson: Lesson,
    note: Note | None,
    visible_ids: set[int],
) -> NoteRead:
    subject = session.get(Subject, lesson.subject_id)
    links: list[NoteSectionLink] = []
    if note and note.id:
        for section in session.exec(
            select(Section)
            .join(NoteSection, NoteSection.section_id == Section.id)
            .join(Book, Book.id == Section.book_id)
            .where(NoteSection.note_id == note.id)
            .order_by(Book.position, Section.position)
        ).all():
            links.append(NoteSectionLink(id=section.id, title=section.title, available=section.id in visible_ids))
    is_current = bool(scope.lesson and scope.lesson.slot_id == lesson.slot_id and scope.lesson.date == lesson.date)
    return NoteRead(
        id=note.id if note else None,
        lesson_id=lesson.id,
        subject_id=subject.id,
        subject_name=subject.name,
        subject_color=subject.color,
        date=lesson.date,
        starts_at=lesson.starts_at,
        title=lesson_title(subject.name, lesson),
        content=note.content if note else "",
        updated_at=note.updated_at if note else None,
        sections=links,
        editable=scope.can_edit_note(lesson) if note else is_current,
        is_current=is_current,
    )


def _visible_ids(session: Session, scope: AccessScope) -> set[int]:
    return {section.id for section, _ in visible_sections(session, scope)}


def _student_lesson(session: Session, scope: AccessScope, lesson_id: int) -> Lesson:
    lesson = session.get(Lesson, lesson_id)
    if lesson is None or lesson.class_id not in scope.class_ids:
        raise HTTPException(status_code=404, detail="Sat ne postoji.")
    return lesson


@router.get("/student/notes", response_model=list[NoteRead])
def list_notes(
    subject_id: int | None = None,
    user: User = Depends(require_student),
    scope: AccessScope = Depends(student_scope),
    session: Session = Depends(get_session),
):
    """The student's notes, newest first. During a lesson, only that subject's notes."""
    query = (
        select(Note, Lesson)
        .join(Lesson, Lesson.id == Note.lesson_id)
        .where(Note.student_id == user.id)
        .order_by(col(Lesson.date).desc(), col(Lesson.starts_at).desc())
    )
    if subject_id is not None:
        query = query.where(Lesson.subject_id == subject_id)
    visible_ids = _visible_ids(session, scope)
    return [
        _note_read(session, scope, lesson, note, visible_ids)
        for note, lesson in session.exec(query).all()
        if scope.can_read_note(lesson)
    ]


@router.get("/lessons/{lesson_id}/note", response_model=NoteRead)
def read_note(
    lesson_id: int,
    user: User = Depends(require_student),
    scope: AccessScope = Depends(student_scope),
    session: Session = Depends(get_session),
):
    lesson = _student_lesson(session, scope, lesson_id)
    if not scope.can_read_note(lesson):
        raise HTTPException(status_code=403, detail="Tijekom sata vidljive su samo bilješke ovog predmeta.")
    note = session.exec(select(Note).where(Note.student_id == user.id, Note.lesson_id == lesson.id)).first()
    return _note_read(session, scope, lesson, note, _visible_ids(session, scope))


@router.put("/lessons/{lesson_id}/note", response_model=NoteRead)
def write_note(
    lesson_id: int,
    body: NoteWrite,
    user: User = Depends(require_student),
    scope: AccessScope = Depends(student_scope),
    session: Session = Depends(get_session),
    clock: Clock = Depends(get_clock),
):
    """Called by the client's background sync with the full note text (last write wins)."""
    lesson = _student_lesson(session, scope, lesson_id)
    now = clock.now()
    note = session.exec(select(Note).where(Note.student_id == user.id, Note.lesson_id == lesson.id)).first()
    if note is None:
        if not scope.can_create_note(lesson, now):
            raise HTTPException(status_code=403, detail="Bilješku možete započeti samo tijekom sata.")
        note = Note(student_id=user.id, lesson_id=lesson.id)
    elif not scope.can_edit_note(lesson):
        raise HTTPException(status_code=403, detail="Tijekom sata možete uređivati samo bilješku ovog sata.")
    note.content = clean_note(body.content)
    note.updated_at = now.astimezone(timezone.utc)
    session.add(note)
    session.commit()
    session.refresh(note)
    return _note_read(session, scope, lesson, note, _visible_ids(session, scope))


@router.post("/lessons/current/sections/{section_id}/opened", status_code=204)
def section_opened(
    section_id: int,
    user: User = Depends(require_student),
    scope: AccessScope = Depends(student_scope),
    session: Session = Depends(get_session),
    clock: Clock = Depends(get_clock),
):
    """Links a section opened during a lesson to that lesson's note (creating an empty note if needed)."""
    if scope.lesson is None:
        return Response(status_code=204)
    if section_id not in _visible_ids(session, scope):
        raise HTTPException(status_code=403, detail="Ovo gradivo trenutačno nije dostupno.")
    lesson = get_or_create_lesson(session, scope.lesson)
    note = session.exec(select(Note).where(Note.student_id == user.id, Note.lesson_id == lesson.id)).first()
    if note is None:
        now = clock.now().astimezone(timezone.utc)
        note = Note(student_id=user.id, lesson_id=lesson.id, created_at=now, updated_at=now)
        session.add(note)
        session.flush()
    if session.get(NoteSection, (note.id, section_id)) is None:
        session.add(NoteSection(note_id=note.id, section_id=section_id))
    session.commit()
    return Response(status_code=204)
