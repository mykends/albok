"""Student exports: a PDF of the notebook (and exportable material) sent to the student's school email."""

import logging
import tempfile
from pathlib import Path

from pypdf import PdfWriter
from sqlalchemy.engine import Engine
from sqlmodel import Session, col, select

from .access import AccessScope, current_school_year, student_class_ids, visible_sections
from .clock import Clock, format_lesson_date
from .config import settings
from .documents import append_pages
from .mailer import send_mail
from .models import Book, BookFile, ExportLog, Lesson, Note, NoteSection, Section, Subject, TeachingAssignment, User
from .note_html import note_text
from .pdfgen import NotebookLesson, NotebookSubject, notebook_pdf

log = logging.getLogger(__name__)


def export_subjects(session: Session, student: User, class_ids: list[int]) -> list[Subject]:
    """Subjects taught to the student's classes, plus any they have notes in."""
    ids = set(
        session.exec(select(TeachingAssignment.subject_id).where(col(TeachingAssignment.class_id).in_(class_ids))).all()
    ) if class_ids else set()
    ids |= set(
        session.exec(select(Lesson.subject_id).join(Note, Note.lesson_id == Lesson.id).where(Note.student_id == student.id)).all()
    )
    if not ids:
        return []
    return list(session.exec(select(Subject).where(col(Subject.id).in_(ids)).order_by(Subject.name)).all())


def _notebook(session: Session, student: User, subject: Subject) -> NotebookSubject:
    rows = session.exec(
        select(Note, Lesson)
        .join(Lesson, Lesson.id == Note.lesson_id)
        .where(Note.student_id == student.id, Lesson.subject_id == subject.id)
        .order_by(Lesson.date, Lesson.starts_at)
    ).all()
    lessons = []
    for note, lesson in rows:
        titles = list(
            session.exec(
                select(Section.title)
                .join(NoteSection, NoteSection.section_id == Section.id)
                .join(Book, Book.id == Section.book_id)
                .where(NoteSection.note_id == note.id)
                .order_by(Book.position, Section.position)
            ).all()
        )
        if note_text(note.content).strip() or titles:
            lessons.append(NotebookLesson(date=lesson.date, section_titles=titles, content=note.content))
    return NotebookSubject(name=subject.name, lessons=lessons)


def build_export(session: Session, student: User, subjects: list[Subject], clock: Clock, out: Path, with_material: bool) -> None:
    """Per subject: the notebook chapter, then the pages of every published section of books whose
    professor allowed export. Sections from other books appear only as titles in the notebook."""
    year = current_school_year(session, clock.today())
    scope = AccessScope(mode="free", user_id=student.id, class_ids=student_class_ids(session, student, year))
    published = visible_sections(session, scope)

    writer = PdfWriter()
    with tempfile.TemporaryDirectory(prefix="albok-export-") as work:
        if not subjects:
            cover = Path(work) / "cover.pdf"
            notebook_pdf(student.display_name or student.username, [], cover, clock.today())
            writer.append(str(cover), import_outline=False)
        for n, subject in enumerate(subjects):
            chapter = Path(work) / f"{n}.pdf"
            notebook_pdf(student.display_name or student.username, [_notebook(session, student, subject)], chapter, clock.today())
            start = len(writer.pages)
            # Every chapter PDF starts with a cover page; keep only the first one.
            writer.append(str(chapter), pages=None if n == 0 else (1, _page_count(chapter)), import_outline=False)
            parent = writer.add_outline_item(subject.name, start + 1 if n == 0 else start)
            if not with_material:
                continue
            material_start = len(writer.pages)
            for section, book in published:
                if book.subject_id != subject.id or not book.exportable:
                    continue
                book_file = session.exec(
                    select(BookFile).where(BookFile.book_id == book.id, BookFile.state == "current", BookFile.status == "ready")
                ).first()
                if book_file:
                    append_pages(writer, book_file, section.page_start, section.page_end)
            if len(writer.pages) > material_start:
                writer.add_outline_item("Gradivo", material_start, parent=parent)
        writer.add_metadata({"/Title": f"Albok – {student.display_name or student.username}", "/Creator": "Albok"})
        with out.open("wb") as handle:
            writer.write(handle)


def _page_count(path: Path) -> int:
    from pypdf import PdfReader

    return len(PdfReader(str(path)).pages)


def run_export(engine: Engine, clock: Clock, log_id: int) -> None:
    """Background task: build the PDF and email it. A failure frees the day's quota again."""
    with Session(engine) as session:
        entry = session.get(ExportLog, log_id)
        student = session.get(User, entry.student_id) if entry else None
        if entry is None or student is None or not student.email:
            return
        year = current_school_year(session, clock.today())
        if entry.kind == "subject":
            subjects = [session.get(Subject, entry.subject_id)] if entry.subject_id else []
        else:
            subjects = export_subjects(session, student, student_class_ids(session, student, year))
        label = subjects[0].name if entry.kind == "subject" and subjects else "svi predmeti"
        try:
            with tempfile.TemporaryDirectory(prefix="albok-export-") as work:
                out = Path(work) / "albok.pdf"
                build_export(session, student, subjects, clock, out, with_material=True)
                note = ""
                if out.stat().st_size > settings.max_attachment_mb * 1024 * 1024:
                    build_export(session, student, subjects, clock, out, with_material=False)
                    note = (
                        "\nGradivo je preveliko za e-poštu pa je izvoz poslan samo s bilješkama. "
                        "Gradivo možete pregledati u Alboku.\n"
                    )
                filename = f"Albok - {label} - {clock.today().isoformat()}.pdf"
                send_mail(
                    student.email,
                    f"Albok: izvoz ({label})",
                    f"Pozdrav {student.display_name or ''},\n\nu privitku je izvoz vaše bilježnice ({label}) "
                    f"od {format_lesson_date(clock.today())}\n{note}\nAlbok",
                    [(filename, out.read_bytes(), "application/pdf")],
                )
        except Exception:
            log.exception("Export %s failed", log_id)
            session.delete(entry)
        else:
            entry.status = "sent"
            session.add(entry)
        session.commit()
