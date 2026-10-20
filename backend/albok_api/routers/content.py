"""Professor endpoints: subjects, books, section ranges, publishing, presets and student preview."""

import re

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func
from sqlmodel import Session, col, delete, select

from ..access import AccessScope, visible_sections
from ..auth import require_professor
from ..clock import Clock, get_clock
from ..db import get_session
from ..documents import (
    UploadTooLarge,
    abs_path,
    check_extension,
    delete_book_tree,
    delete_file_tree,
    new_file_paths,
    page_texts,
    process_file,
    store_bytes,
    store_upload,
)
from ..importers import BookImportError, fallback_title
from ..models import (
    Book,
    BookFile,
    Inclusion,
    NoteSection,
    Preset,
    PresetSection,
    Publication,
    SchoolClass,
    Section,
    Subject,
    User,
)
from ..permissions import (
    check_can_publish,
    owned_book,
    owned_section,
    owned_subject,
    subject_classes,
    viewable_book,
    viewable_subject,
)
from ..schemas import (
    BookRead,
    BookUpdate,
    ClassRef,
    FileRead,
    IncludeState,
    PresetRead,
    PresetUpdate,
    PresetWrite,
    ProfessorSection,
    ProfessorSubject,
    PublishState,
    ReplaceConfirm,
    ReplaceProposal,
    SectionDraft,
    SectionIds,
    SectionUpdate,
    SplitRequest,
    StudentSubject,
    SubjectUpdate,
    Suggestion,
    TextUpload,
)
from .student import student_subjects

router = APIRouter(prefix="/api", tags=["professor"])


# --- Helpers ----------------------------------------------------------------------------------


def _files(session: Session, book_id: int) -> tuple[BookFile | None, BookFile | None]:
    files = session.exec(select(BookFile).where(BookFile.book_id == book_id)).all()
    current = next((f for f in files if f.state == "current"), None)
    pending = next((f for f in files if f.state == "pending"), None)
    return current, pending


def _file_read(book_file: BookFile | None) -> FileRead | None:
    return FileRead.model_validate(book_file, from_attributes=True) if book_file else None


def book_read(session: Session, book: Book) -> BookRead:
    sections = session.exec(select(Section).where(Section.book_id == book.id).order_by(Section.position)).all()
    ids = [s.id for s in sections]
    published: dict[int, list[int]] = {}
    included: dict[int, list[int]] = {}
    if ids:
        for section_id, class_id in session.exec(
            select(Publication.section_id, Publication.class_id).where(col(Publication.section_id).in_(ids))
        ).all():
            published.setdefault(section_id, []).append(class_id)
        for section_id, class_id in session.exec(
            select(Inclusion.section_id, Inclusion.class_id).where(col(Inclusion.section_id).in_(ids))
        ).all():
            included.setdefault(section_id, []).append(class_id)
    current, pending = _files(session, book.id)
    return BookRead(
        **book.model_dump(),
        file=_file_read(current),
        pending_file=_file_read(pending),
        sections=[
            ProfessorSection(
                id=s.id,
                position=s.position,
                title=s.title,
                page_start=s.page_start,
                page_end=s.page_end,
                published_class_ids=sorted(published.get(s.id, [])),
                included_class_ids=sorted(included.get(s.id, [])),
            )
            for s in sections
        ],
    )


def _subject_read(session: Session, subject: Subject, clock: Clock) -> ProfessorSubject:
    book_ids = session.exec(select(Book.id).where(Book.subject_id == subject.id)).all()
    section_count = (
        session.exec(select(func.count(Section.id)).where(col(Section.book_id).in_(book_ids))).one() if book_ids else 0
    )
    return ProfessorSubject(
        **subject.model_dump(include={"id", "name", "description", "color", "icon", "timetable_name"}),
        classes=[ClassRef(id=c.id, name=c.name, year_level=c.year_level) for c in subject_classes(session, subject, clock)],
        book_count=len(book_ids),
        section_count=section_count,
    )


def _ready_file(session: Session, book: Book) -> BookFile:
    current, _ = _files(session, book.id)
    if current is None or current.status != "ready":
        raise HTTPException(status_code=409, detail="Datoteka se još obrađuje.")
    return current


def _check_range(book_file: BookFile, page_start: int, page_end: int) -> None:
    if page_end < page_start:
        raise HTTPException(status_code=422, detail="Zadnja stranica ne može biti prije prve.")
    if page_end > book_file.page_count:
        raise HTTPException(status_code=422, detail=f"Knjiga ima samo {book_file.page_count} stranica.")


def _renumber(session: Session, book_id: int) -> None:
    sections = session.exec(select(Section).where(Section.book_id == book_id).order_by(Section.position, Section.id)).all()
    for position, section in enumerate(sections):
        if section.position != position:
            section.position = position
            session.add(section)


def _merge_into(session: Session, target: Section, others: list[Section]) -> None:
    """Move note links, publications, inclusions and preset membership to `target`, then delete `others`."""
    other_ids = [s.id for s in others]
    if not other_ids:
        return
    for model, key in ((NoteSection, "note_id"), (Publication, "class_id"), (Inclusion, "class_id"), (PresetSection, "preset_id")):
        existing = set(session.exec(select(getattr(model, key)).where(model.section_id == target.id)).all())
        moving = session.exec(select(model).where(col(model.section_id).in_(other_ids))).all()
        for row in moving:
            value = getattr(row, key)
            if value not in existing:
                existing.add(value)
                data = {k: v for k, v in row.model_dump().items() if k != "id"}
                data["section_id"] = target.id
                session.add(model(**data))
        session.exec(delete(model).where(col(model.section_id).in_(other_ids)))
    for other in others:
        session.delete(other)
    session.flush()


def _section_text(book_file: BookFile, page_start: int, page_end: int) -> str:
    try:
        return page_texts(book_file, page_start, page_end)
    except BookImportError:
        return ""


def _next_book_position(session: Session, subject_id: int) -> int:
    last = session.exec(select(func.max(Book.position)).where(Book.subject_id == subject_id)).one()
    return (last if last is not None else -1) + 1


def _start_upload(
    request: Request, session: Session, book: Book, upload: UploadFile, state: str, background: BackgroundTasks
) -> BookFile:
    filename = (upload.filename or "datoteka").strip()
    book_file = BookFile(book_id=book.id, state=state, original_filename=filename, original_path="")
    session.add(book_file)
    session.flush()
    relative, destination = new_file_paths(book.id, book_file.id, filename)
    try:
        book_file.original_size = store_upload(upload, destination)
    except UploadTooLarge:
        session.rollback()
        raise HTTPException(status_code=413, detail="Datoteka je veća od dopuštenih 300 MB.")
    book_file.original_path = relative
    session.add(book_file)
    session.commit()
    background.add_task(process_file, request.app.state.engine, book_file.id)
    return book_file


# --- Subjects -----------------------------------------------------------------------------------


@router.get("/professor/subjects", response_model=list[ProfessorSubject])
def my_subjects(
    user: User = Depends(require_professor), session: Session = Depends(get_session), clock: Clock = Depends(get_clock)
):
    subjects = session.exec(select(Subject).where(Subject.professor_id == user.id).order_by(Subject.name)).all()
    return [_subject_read(session, s, clock) for s in subjects]


@router.get("/subjects/{subject_id}", response_model=ProfessorSubject)
def read_subject(
    subject_id: int,
    user: User = Depends(require_professor),
    session: Session = Depends(get_session),
    clock: Clock = Depends(get_clock),
):
    return _subject_read(session, viewable_subject(session, user, subject_id, clock), clock)


@router.patch("/subjects/{subject_id}", response_model=ProfessorSubject)
def update_subject(
    subject_id: int,
    body: SubjectUpdate,
    user: User = Depends(require_professor),
    session: Session = Depends(get_session),
    clock: Clock = Depends(get_clock),
):
    subject = owned_subject(session, user, subject_id)
    for key, value in body.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(subject, key, value.strip() if isinstance(value, str) else value)
    session.add(subject)
    session.commit()
    return _subject_read(session, subject, clock)


# --- Books --------------------------------------------------------------------------------------


@router.get("/subjects/{subject_id}/books", response_model=list[BookRead])
def list_books(
    subject_id: int,
    user: User = Depends(require_professor),
    session: Session = Depends(get_session),
    clock: Clock = Depends(get_clock),
):
    viewable_subject(session, user, subject_id, clock)
    books = session.exec(select(Book).where(Book.subject_id == subject_id).order_by(Book.position, Book.id)).all()
    return [book_read(session, book) for book in books]


@router.post("/subjects/{subject_id}/books", response_model=BookRead, status_code=202)
def upload_book(
    subject_id: int,
    request: Request,
    background: BackgroundTasks,
    file: UploadFile = File(...),
    title: str | None = Form(None),
    user: User = Depends(require_professor),
    session: Session = Depends(get_session),
):
    """Starts processing in the background; poll GET /api/books/{id} until `file.status` is ready."""
    owned_subject(session, user, subject_id)
    try:
        check_extension(file.filename or "")
    except BookImportError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    given_title = (title or "").strip()
    book = Book(
        subject_id=subject_id,
        title=given_title or fallback_title(file.filename or ""),
        title_from_file=not given_title,
        position=_next_book_position(session, subject_id),
    )
    session.add(book)
    session.flush()
    _start_upload(request, session, book, file, "current", background)
    session.refresh(book)
    return book_read(session, book)


@router.post("/subjects/{subject_id}/books/text", response_model=BookRead, status_code=202)
def paste_book(
    subject_id: int,
    body: TextUpload,
    request: Request,
    background: BackgroundTasks,
    user: User = Depends(require_professor),
    session: Session = Depends(get_session),
):
    owned_subject(session, user, subject_id)
    book = Book(subject_id=subject_id, title=body.title.strip(), position=_next_book_position(session, subject_id))
    session.add(book)
    session.flush()
    filename = re.sub(r"[^\w.-]+", "-", body.title.strip())[:60] + ".md"
    book_file = BookFile(book_id=book.id, original_filename=filename, original_path="")
    session.add(book_file)
    session.flush()
    relative, destination = new_file_paths(book.id, book_file.id, filename)
    book_file.original_size = store_bytes(body.text.encode("utf-8"), destination)
    book_file.original_path = relative
    session.add(book_file)
    session.commit()
    background.add_task(process_file, request.app.state.engine, book_file.id)
    return book_read(session, book)


@router.get("/books/{book_id}", response_model=BookRead)
def read_book(
    book_id: int,
    user: User = Depends(require_professor),
    session: Session = Depends(get_session),
    clock: Clock = Depends(get_clock),
):
    book, _ = viewable_book(session, user, book_id, clock)
    return book_read(session, book)


@router.patch("/books/{book_id}", response_model=BookRead)
def update_book(
    book_id: int, body: BookUpdate, user: User = Depends(require_professor), session: Session = Depends(get_session)
):
    book, _ = owned_book(session, user, book_id)
    changes = body.model_dump(exclude_unset=True)
    if changes.get("title"):
        book.title, book.title_from_file = changes["title"].strip(), False
    if changes.get("exportable") is not None:
        book.exportable = changes["exportable"]
    if changes.get("position") is not None:
        siblings = [
            b
            for b in session.exec(select(Book).where(Book.subject_id == book.subject_id).order_by(Book.position, Book.id)).all()
            if b.id != book.id
        ]
        siblings.insert(min(changes["position"], len(siblings)), book)
        for position, sibling in enumerate(siblings):
            sibling.position = position
            session.add(sibling)
    session.add(book)
    session.commit()
    session.refresh(book)
    return book_read(session, book)


@router.delete("/books/{book_id}", status_code=204)
def delete_book(book_id: int, user: User = Depends(require_professor), session: Session = Depends(get_session)):
    """Students' notes stay; they only lose their links to this book's sections."""
    book, _ = owned_book(session, user, book_id)
    file_ids = list(session.exec(select(BookFile.id).where(BookFile.book_id == book.id)).all())
    session.delete(book)
    session.commit()
    delete_book_tree(book_id, file_ids)
    return Response(status_code=204)


@router.get("/books/{book_id}/pdf")
def book_pdf(
    book_id: int,
    pending: bool = False,
    user: User = Depends(require_professor),
    session: Session = Depends(get_session),
    clock: Clock = Depends(get_clock),
):
    """The whole converted PDF, for professors choosing page ranges."""
    book, _ = viewable_book(session, user, book_id, clock)
    current, pending_file = _files(session, book.id)
    book_file = pending_file if pending else current
    if book_file is None or book_file.status != "ready" or not book_file.pdf_path:
        raise HTTPException(status_code=404, detail="PDF još nije spreman.")
    return FileResponse(abs_path(book_file.pdf_path), media_type="application/pdf", headers={"Cache-Control": "private, no-store"})


@router.get("/books/{book_id}/original")
def book_original(book_id: int, user: User = Depends(require_professor), session: Session = Depends(get_session)):
    book, _ = owned_book(session, user, book_id)
    current, _ = _files(session, book.id)
    if current is None:
        raise HTTPException(status_code=404, detail="Datoteka ne postoji.")
    return FileResponse(abs_path(current.original_path), filename=current.original_filename)


# --- Replacing a file ---------------------------------------------------------------------------


@router.post("/books/{book_id}/replace", response_model=BookRead, status_code=202)
def replace_file(
    book_id: int,
    request: Request,
    background: BackgroundTasks,
    file: UploadFile = File(...),
    user: User = Depends(require_professor),
    session: Session = Depends(get_session),
):
    book, _ = owned_book(session, user, book_id)
    try:
        check_extension(file.filename or "")
    except BookImportError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    _, pending = _files(session, book.id)
    if pending:
        session.delete(pending)
        session.flush()
        delete_file_tree(pending)
    _start_upload(request, session, book, file, "pending", background)
    return book_read(session, book)


def _squash(title: str) -> str:
    return re.sub(r"\W+", " ", title).strip().lower()


@router.get("/books/{book_id}/replace", response_model=ReplaceProposal)
def replace_proposal(book_id: int, user: User = Depends(require_professor), session: Session = Depends(get_session)):
    book, _ = owned_book(session, user, book_id)
    _, pending = _files(session, book.id)
    if pending is None:
        raise HTTPException(status_code=404, detail="Nema nove datoteke koja čeka potvrdu.")
    suggestions = [Suggestion(**{k: s[k] for k in ("title", "page_start", "page_end")}) for s in (pending.suggestions or [])]
    old = session.exec(select(Section).where(Section.book_id == book.id).order_by(Section.position)).all()
    by_title: dict[str, int] = {}
    for index, suggestion in enumerate(suggestions):
        by_title.setdefault(_squash(suggestion.title), index)
    mapping: dict[int, int | None] = {}
    taken: set[int] = set()
    for section in old:
        index = by_title.get(_squash(section.title))
        if index is not None and index not in taken:
            mapping[section.id] = index
            taken.add(index)
        else:
            mapping[section.id] = None
    # Same number of sections and nothing matched by title: assume the order is unchanged.
    if not taken and len(old) == len(suggestions):
        mapping = {section.id: index for index, section in enumerate(old)}
    return ReplaceProposal(file=_file_read(pending), suggestions=suggestions, mapping=mapping)


@router.post("/books/{book_id}/replace/confirm", response_model=BookRead)
def confirm_replace(
    book_id: int, body: ReplaceConfirm, user: User = Depends(require_professor), session: Session = Depends(get_session)
):
    """Map old sections onto the new file. Mapped sections keep their id, so publications and students'
    note links survive; several old sections mapped to one new section are merged; unmapped ones are deleted."""
    book, _ = owned_book(session, user, book_id)
    current, pending = _files(session, book.id)
    if pending is None or pending.status != "ready":
        raise HTTPException(status_code=409, detail="Nova datoteka još nije spremna.")
    for draft in body.sections:
        _check_range(pending, draft.page_start, draft.page_end)
    old = {s.id: s for s in session.exec(select(Section).where(Section.book_id == book.id)).all()}
    if any(key not in old for key in body.mapping) or any(
        v is not None and not 0 <= v < len(body.sections) for v in body.mapping.values()
    ):
        raise HTTPException(status_code=422, detail="Neispravno povezivanje cjelina.")

    targets: dict[int, list[Section]] = {}
    for section_id, section in sorted(old.items(), key=lambda item: item[1].position):
        index = body.mapping.get(section_id)
        if index is None:
            session.delete(section)
        else:
            targets.setdefault(index, []).append(section)
    session.flush()

    for index, draft in enumerate(body.sections):
        mapped = targets.get(index, [])
        text = _section_text(pending, draft.page_start, draft.page_end)
        if mapped:
            target, others = mapped[0], mapped[1:]
            _merge_into(session, target, others)
            target.title, target.page_start, target.page_end = draft.title.strip(), draft.page_start, draft.page_end
            target.position, target.extracted_text = index, text
            session.add(target)
        else:
            session.add(
                Section(
                    book_id=book.id,
                    position=index,
                    title=draft.title.strip(),
                    page_start=draft.page_start,
                    page_end=draft.page_end,
                    extracted_text=text,
                )
            )
    if current:
        session.delete(current)
    pending.state = "current"
    session.add(pending)
    session.commit()
    if current:
        delete_file_tree(current)
    session.refresh(book)
    return book_read(session, book)


@router.delete("/books/{book_id}/replace", response_model=BookRead)
def cancel_replace(book_id: int, user: User = Depends(require_professor), session: Session = Depends(get_session)):
    book, _ = owned_book(session, user, book_id)
    _, pending = _files(session, book.id)
    if pending:
        session.delete(pending)
        session.commit()
        delete_file_tree(pending)
    return book_read(session, book)


# --- Sections ------------------------------------------------------------------------------------


@router.post("/books/{book_id}/sections", response_model=BookRead, status_code=201)
def create_section(
    book_id: int, body: SectionDraft, user: User = Depends(require_professor), session: Session = Depends(get_session)
):
    book, _ = owned_book(session, user, book_id)
    book_file = _ready_file(session, book)
    _check_range(book_file, body.page_start, body.page_end)
    after = session.exec(
        select(Section).where(Section.book_id == book.id, Section.page_start > body.page_start).order_by(Section.position)
    ).first()
    position = after.position if after else len(session.exec(select(Section.id).where(Section.book_id == book.id)).all())
    for section in session.exec(select(Section).where(Section.book_id == book.id, Section.position >= position)).all():
        section.position += 1
        session.add(section)
    session.add(
        Section(
            book_id=book.id,
            position=position,
            title=body.title.strip(),
            page_start=body.page_start,
            page_end=body.page_end,
            extracted_text=_section_text(book_file, body.page_start, body.page_end),
        )
    )
    session.commit()
    return book_read(session, book)


@router.patch("/sections/{section_id}", response_model=BookRead)
def update_section(
    section_id: int, body: SectionUpdate, user: User = Depends(require_professor), session: Session = Depends(get_session)
):
    section, book, _ = owned_section(session, user, section_id)
    changes = body.model_dump(exclude_unset=True)
    if changes.get("title"):
        section.title = changes["title"].strip()
    if changes.get("page_start") or changes.get("page_end"):
        book_file = _ready_file(session, book)
        start = changes.get("page_start") or section.page_start
        end = changes.get("page_end") or section.page_end
        _check_range(book_file, start, end)
        section.page_start, section.page_end = start, end
        section.extracted_text = _section_text(book_file, start, end)
    session.add(section)
    session.commit()
    return book_read(session, book)


@router.delete("/sections/{section_id}", response_model=BookRead)
def delete_section(section_id: int, user: User = Depends(require_professor), session: Session = Depends(get_session)):
    """Students' notes stay; only their link to this section is removed."""
    section, book, _ = owned_section(session, user, section_id)
    session.delete(section)
    session.flush()
    _renumber(session, book.id)
    session.commit()
    return book_read(session, book)


@router.post("/sections/{section_id}/split", response_model=BookRead)
def split_section(
    section_id: int, body: SplitRequest, user: User = Depends(require_professor), session: Session = Depends(get_session)
):
    """Note links stay with the first part. Both parts keep the original's publications."""
    section, book, _ = owned_section(session, user, section_id)
    book_file = _ready_file(session, book)
    if not section.page_start < body.at_page <= section.page_end:
        raise HTTPException(
            status_code=422,
            detail=f"Druga cjelina mora početi između stranica {section.page_start + 1} i {section.page_end}.",
        )
    for later in session.exec(select(Section).where(Section.book_id == book.id, Section.position > section.position)).all():
        later.position += 1
        session.add(later)
    second = Section(
        book_id=book.id,
        position=section.position + 1,
        title=(body.title or "").strip() or f"{section.title} (2. dio)",
        page_start=body.at_page,
        page_end=section.page_end,
        extracted_text=_section_text(book_file, body.at_page, section.page_end),
    )
    session.add(second)
    session.flush()
    for publication in session.exec(select(Publication).where(Publication.section_id == section.id)).all():
        session.add(Publication(section_id=second.id, class_id=publication.class_id))
    for inclusion in session.exec(select(Inclusion).where(Inclusion.section_id == section.id)).all():
        session.add(Inclusion(section_id=second.id, class_id=inclusion.class_id))
    section.page_end = body.at_page - 1
    section.extracted_text = _section_text(book_file, section.page_start, section.page_end)
    session.add(section)
    session.commit()
    return book_read(session, book)


@router.post("/books/{book_id}/sections/merge", response_model=BookRead)
def merge_sections(
    book_id: int, body: SectionIds, user: User = Depends(require_professor), session: Session = Depends(get_session)
):
    """Merges into the first section (by position); note links and publications move to it."""
    book, _ = owned_book(session, user, book_id)
    sections = session.exec(
        select(Section).where(col(Section.id).in_(body.section_ids), Section.book_id == book.id).order_by(Section.position)
    ).all()
    if len(sections) != len(set(body.section_ids)) or len(sections) < 2:
        raise HTTPException(status_code=422, detail="Odaberite barem dvije cjeline iz ove knjige.")
    book_file = _ready_file(session, book)
    target, others = sections[0], list(sections[1:])
    target.page_start = min(s.page_start for s in sections)
    target.page_end = max(s.page_end for s in sections)
    target.extracted_text = _section_text(book_file, target.page_start, target.page_end)
    _merge_into(session, target, others)
    session.add(target)
    _renumber(session, book.id)
    session.commit()
    return book_read(session, book)


@router.put("/books/{book_id}/sections/order", response_model=BookRead)
def reorder_sections(
    book_id: int, body: SectionIds, user: User = Depends(require_professor), session: Session = Depends(get_session)
):
    book, _ = owned_book(session, user, book_id)
    sections = {s.id: s for s in session.exec(select(Section).where(Section.book_id == book.id)).all()}
    if sorted(body.section_ids) != sorted(sections):
        raise HTTPException(status_code=422, detail="Popis mora sadržavati sve cjeline knjige točno jednom.")
    for position, section_id in enumerate(body.section_ids):
        sections[section_id].position = position
        session.add(sections[section_id])
    session.commit()
    return book_read(session, book)


# --- Publishing ----------------------------------------------------------------------------------


def _set_published(session: Session, section_ids: list[int], class_id: int, published: bool) -> None:
    if not section_ids:
        return
    if not published:
        session.exec(delete(Publication).where(col(Publication.section_id).in_(section_ids), Publication.class_id == class_id))
        return
    already = set(
        session.exec(
            select(Publication.section_id).where(col(Publication.section_id).in_(section_ids), Publication.class_id == class_id)
        ).all()
    )
    included = set(
        session.exec(
            select(Inclusion.section_id).where(col(Inclusion.section_id).in_(section_ids), Inclusion.class_id == class_id)
        ).all()
    )
    for section_id in section_ids:
        if section_id not in already:
            session.add(Publication(section_id=section_id, class_id=class_id))
        # Published sections are always part of the class's plan.
        if section_id not in included:
            session.add(Inclusion(section_id=section_id, class_id=class_id))


def _publishable_section(session: Session, user: User, section_id: int, class_id: int, clock: Clock) -> tuple[Section, Book]:
    section = session.get(Section, section_id)
    if section is None:
        raise HTTPException(status_code=404, detail="Cjelina ne postoji.")
    book, subject = viewable_book(session, user, section.book_id, clock)
    check_can_publish(session, user, subject, class_id, clock)
    return section, book


@router.put("/sections/{section_id}/publications/{class_id}", response_model=BookRead)
def publish_section(
    section_id: int,
    class_id: int,
    body: PublishState,
    user: User = Depends(require_professor),
    session: Session = Depends(get_session),
    clock: Clock = Depends(get_clock),
):
    section, book = _publishable_section(session, user, section_id, class_id, clock)
    _set_published(session, [section.id], class_id, body.published)
    session.commit()
    return book_read(session, book)


@router.put("/books/{book_id}/publications/{class_id}", response_model=BookRead)
def publish_book(
    book_id: int,
    class_id: int,
    body: PublishState,
    user: User = Depends(require_professor),
    session: Session = Depends(get_session),
    clock: Clock = Depends(get_clock),
):
    """Publish (or hide) every section of the book for one class."""
    book, subject = viewable_book(session, user, book_id, clock)
    check_can_publish(session, user, subject, class_id, clock)
    section_ids = list(session.exec(select(Section.id).where(Section.book_id == book.id)).all())
    _set_published(session, section_ids, class_id, body.published)
    session.commit()
    return book_read(session, book)


@router.put("/sections/{section_id}/inclusions/{class_id}", response_model=BookRead)
def include_section(
    section_id: int,
    class_id: int,
    body: IncludeState,
    user: User = Depends(require_professor),
    session: Session = Depends(get_session),
    clock: Clock = Depends(get_clock),
):
    section, book, subject = owned_section(session, user, section_id)
    check_can_publish(session, user, subject, class_id, clock)
    if body.included:
        exists = session.exec(select(Inclusion).where(Inclusion.section_id == section.id, Inclusion.class_id == class_id)).first()
        if not exists:
            session.add(Inclusion(section_id=section.id, class_id=class_id))
    else:
        if session.exec(select(Publication).where(Publication.section_id == section.id, Publication.class_id == class_id)).first():
            raise HTTPException(status_code=409, detail="Objavljena cjelina mora ostati uključena. Najprije je sakrijte.")
        session.exec(delete(Inclusion).where(Inclusion.section_id == section.id, Inclusion.class_id == class_id))
    session.commit()
    return book_read(session, book)


# --- Presets -------------------------------------------------------------------------------------


def _preset_read(session: Session, preset: Preset) -> PresetRead:
    section_ids = session.exec(select(PresetSection.section_id).where(PresetSection.preset_id == preset.id)).all()
    return PresetRead(id=preset.id, subject_id=preset.subject_id, year_level=preset.year_level, section_ids=sorted(section_ids))


def _subject_section_ids(session: Session, subject_id: int) -> set[int]:
    return set(session.exec(select(Section.id).join(Book, Book.id == Section.book_id).where(Book.subject_id == subject_id)).all())


def _set_preset_sections(session: Session, preset: Preset, section_ids: list[int]) -> None:
    valid = _subject_section_ids(session, preset.subject_id)
    if not set(section_ids) <= valid:
        raise HTTPException(status_code=422, detail="Predložak može sadržavati samo cjeline ovog predmeta.")
    session.exec(delete(PresetSection).where(PresetSection.preset_id == preset.id))
    for section_id in set(section_ids):
        session.add(PresetSection(preset_id=preset.id, section_id=section_id))


def _owned_preset(session: Session, user: User, preset_id: int) -> tuple[Preset, Subject]:
    preset = session.get(Preset, preset_id)
    if preset is None:
        raise HTTPException(status_code=404, detail="Predložak ne postoji.")
    return preset, owned_subject(session, user, preset.subject_id)


@router.get("/subjects/{subject_id}/presets", response_model=list[PresetRead])
def list_presets(subject_id: int, user: User = Depends(require_professor), session: Session = Depends(get_session)):
    owned_subject(session, user, subject_id)
    presets = session.exec(select(Preset).where(Preset.subject_id == subject_id).order_by(Preset.year_level)).all()
    return [_preset_read(session, p) for p in presets]


@router.post("/subjects/{subject_id}/presets", response_model=PresetRead, status_code=201)
def create_preset(
    subject_id: int, body: PresetWrite, user: User = Depends(require_professor), session: Session = Depends(get_session)
):
    owned_subject(session, user, subject_id)
    if session.exec(select(Preset).where(Preset.subject_id == subject_id, Preset.year_level == body.year_level)).first():
        raise HTTPException(status_code=409, detail=f"Predložak za {body.year_level}. razred već postoji.")
    preset = Preset(subject_id=subject_id, year_level=body.year_level)
    session.add(preset)
    session.flush()
    _set_preset_sections(session, preset, body.section_ids)
    session.commit()
    return _preset_read(session, preset)


@router.put("/presets/{preset_id}", response_model=PresetRead)
def update_preset(
    preset_id: int, body: PresetUpdate, user: User = Depends(require_professor), session: Session = Depends(get_session)
):
    preset, _ = _owned_preset(session, user, preset_id)
    _set_preset_sections(session, preset, body.section_ids)
    session.commit()
    return _preset_read(session, preset)


@router.delete("/presets/{preset_id}", status_code=204)
def delete_preset(preset_id: int, user: User = Depends(require_professor), session: Session = Depends(get_session)):
    preset, _ = _owned_preset(session, user, preset_id)
    session.delete(preset)
    session.commit()
    return Response(status_code=204)


@router.post("/presets/{preset_id}/apply/{class_id}", response_model=list[BookRead])
def apply_preset(
    preset_id: int,
    class_id: int,
    user: User = Depends(require_professor),
    session: Session = Depends(get_session),
    clock: Clock = Depends(get_clock),
):
    """Sets which of the subject's sections are included for the class. Publishing stays manual, and
    already published sections stay included."""
    preset, subject = _owned_preset(session, user, preset_id)
    check_can_publish(session, user, subject, class_id, clock)
    subject_sections = _subject_section_ids(session, subject.id)
    preset_sections = set(session.exec(select(PresetSection.section_id).where(PresetSection.preset_id == preset.id)).all())
    published = set(
        session.exec(
            select(Publication.section_id).where(
                col(Publication.section_id).in_(subject_sections), Publication.class_id == class_id
            )
        ).all()
    )
    session.exec(delete(Inclusion).where(col(Inclusion.section_id).in_(subject_sections), Inclusion.class_id == class_id))
    for section_id in preset_sections | published:
        session.add(Inclusion(section_id=section_id, class_id=class_id))
    session.commit()
    books = session.exec(select(Book).where(Book.subject_id == subject.id).order_by(Book.position, Book.id)).all()
    return [book_read(session, book) for book in books]


# --- Student preview -----------------------------------------------------------------------------


@router.get("/professor/preview/{class_id}", response_model=list[StudentSubject])
def preview_class(
    class_id: int,
    subject_id: int,
    user: User = Depends(require_professor),
    session: Session = Depends(get_session),
    clock: Clock = Depends(get_clock),
):
    """What students of a class see for this subject outside lessons."""
    subject = viewable_subject(session, user, subject_id, clock)
    if session.get(SchoolClass, class_id) is None:
        raise HTTPException(status_code=404, detail="Razred ne postoji.")
    check_can_publish(session, user, subject, class_id, clock)
    scope = AccessScope(mode="free", user_id=user.id, class_ids=[class_id])
    rows = [(section, book) for section, book in visible_sections(session, scope) if book.subject_id == subject.id]
    return student_subjects(session, [subject], rows)
