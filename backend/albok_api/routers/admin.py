"""Admin endpoints: school years and calendar, classes, roster and timetable, per-date overrides,
roles and accounts, disk usage."""

import shutil
from datetime import date, timedelta

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from sqlalchemy import func
from sqlmodel import Session, col, delete, select

from ..access import current_school_year
from ..auth import require_admin
from ..clock import Clock, get_clock
from ..db import get_session
from ..documents import disk_usage, files_root
from ..models import (
    Book,
    BookFile,
    CalendarDay,
    Enrollment,
    LessonOverride,
    Note,
    Lesson,
    SchoolClass,
    SchoolYear,
    Subject,
    TeachingAssignment,
    TimetableSlot,
    User,
    UserSession,
)
from ..school_csv import (
    CsvFormatError,
    find_or_create_assignment,
    find_or_create_subject,
    import_roster,
    import_timetable,
    normalize_class_name,
)
from ..schemas import (
    CalendarDayRead,
    CalendarDaysWrite,
    ClassRead,
    ClassWrite,
    ImportReport,
    OverrideRead,
    OverrideWrite,
    SlotRead,
    SlotWrite,
    StorageByProfessor,
    StorageRead,
    SubjectOption,
    UserAdminRead,
    UserAdminUpdate,
    YearRead,
    YearWrite,
)

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)])

MAX_CSV_BYTES = 5 * 1024 * 1024


def _year(session: Session, year_id: int | None, clock: Clock) -> SchoolYear:
    year = session.get(SchoolYear, year_id) if year_id else current_school_year(session, clock.today())
    if year is None:
        raise HTTPException(status_code=404, detail="Najprije dodajte školsku godinu.")
    if year.purged_at:
        raise HTTPException(status_code=409, detail="Ova školska godina je završena i obrisana.")
    return year


def _validate_year(body: YearWrite) -> None:
    if body.end < body.start:
        raise HTTPException(status_code=422, detail="Kraj nastave mora biti nakon početka.")
    if body.deletion_date <= body.end:
        raise HTTPException(status_code=422, detail="Datum brisanja mora biti nakon kraja nastave.")


def _year_read(year: SchoolYear, current: SchoolYear | None) -> YearRead:
    return YearRead(**year.model_dump(), is_current=bool(current and current.id == year.id))


# --- School years and calendar ----------------------------------------------------------------


@router.get("/years", response_model=list[YearRead])
def list_years(session: Session = Depends(get_session), clock: Clock = Depends(get_clock)):
    current = current_school_year(session, clock.today())
    return [_year_read(y, current) for y in session.exec(select(SchoolYear).order_by(col(SchoolYear.start).desc())).all()]


@router.post("/years", response_model=YearRead, status_code=201)
def create_year(body: YearWrite, session: Session = Depends(get_session), clock: Clock = Depends(get_clock)):
    _validate_year(body)
    year = SchoolYear(**body.model_dump())
    session.add(year)
    session.commit()
    return _year_read(year, current_school_year(session, clock.today()))


@router.put("/years/{year_id}", response_model=YearRead)
def update_year(year_id: int, body: YearWrite, session: Session = Depends(get_session), clock: Clock = Depends(get_clock)):
    _validate_year(body)
    year = _year(session, year_id, clock)
    for key, value in body.model_dump().items():
        setattr(year, key, value)
    session.add(year)
    session.commit()
    return _year_read(year, current_school_year(session, clock.today()))


@router.get("/years/{year_id}/days", response_model=list[CalendarDayRead])
def list_days(year_id: int, session: Session = Depends(get_session), clock: Clock = Depends(get_clock)):
    year = _year(session, year_id, clock)
    days = session.exec(select(CalendarDay).where(CalendarDay.school_year_id == year.id).order_by(CalendarDay.date)).all()
    return [CalendarDayRead(id=d.id, date=d.date, label=d.label) for d in days]


@router.post("/years/{year_id}/days", response_model=list[CalendarDayRead], status_code=201)
def add_days(
    year_id: int, body: CalendarDaysWrite, session: Session = Depends(get_session), clock: Clock = Depends(get_clock)
):
    """Mark a day, or a range of days (e.g. a holiday), as non-teaching."""
    year = _year(session, year_id, clock)
    end = body.end or body.start
    if end < body.start or (end - body.start).days > 120:
        raise HTTPException(status_code=422, detail="Neispravan raspon datuma.")
    existing = set(session.exec(select(CalendarDay.date).where(CalendarDay.school_year_id == year.id)).all())
    day = body.start
    while day <= end:
        if day not in existing:
            session.add(CalendarDay(school_year_id=year.id, date=day, label=body.label.strip()))
        day += timedelta(days=1)
    session.commit()
    return list_days(year.id, session, clock)


@router.delete("/years/{year_id}/days/{day_id}", status_code=204)
def delete_day(year_id: int, day_id: int, session: Session = Depends(get_session)):
    session.exec(delete(CalendarDay).where(CalendarDay.id == day_id, CalendarDay.school_year_id == year_id))
    session.commit()
    return Response(status_code=204)


# --- Classes -------------------------------------------------------------------------------------


@router.get("/classes", response_model=list[ClassRead])
def list_classes(year_id: int | None = None, session: Session = Depends(get_session), clock: Clock = Depends(get_clock)):
    year = _year(session, year_id, clock)
    counts = dict(
        session.exec(
            select(Enrollment.class_id, func.count(Enrollment.id))
            .join(SchoolClass, SchoolClass.id == Enrollment.class_id)
            .where(SchoolClass.school_year_id == year.id)
            .group_by(Enrollment.class_id)
        ).all()
    )
    classes = session.exec(
        select(SchoolClass).where(SchoolClass.school_year_id == year.id).order_by(SchoolClass.year_level, SchoolClass.name)
    ).all()
    return [ClassRead(id=c.id, name=c.name, year_level=c.year_level, student_count=counts.get(c.id, 0)) for c in classes]


@router.post("/classes", response_model=ClassRead, status_code=201)
def create_class(
    body: ClassWrite, year_id: int | None = None, session: Session = Depends(get_session), clock: Clock = Depends(get_clock)
):
    year = _year(session, year_id, clock)
    name = normalize_class_name(body.name)
    if session.exec(select(SchoolClass).where(SchoolClass.school_year_id == year.id, SchoolClass.name == name)).first():
        raise HTTPException(status_code=409, detail=f"Razred {name} već postoji.")
    school_class = SchoolClass(school_year_id=year.id, name=name, year_level=body.year_level)
    session.add(school_class)
    session.commit()
    return ClassRead(id=school_class.id, name=name, year_level=body.year_level, student_count=0)


@router.put("/classes/{class_id}", response_model=ClassRead)
def update_class(class_id: int, body: ClassWrite, session: Session = Depends(get_session)):
    school_class = session.get(SchoolClass, class_id)
    if school_class is None:
        raise HTTPException(status_code=404, detail="Razred ne postoji.")
    school_class.name, school_class.year_level = normalize_class_name(body.name), body.year_level
    session.add(school_class)
    session.commit()
    count = session.exec(select(func.count(Enrollment.id)).where(Enrollment.class_id == class_id)).one()
    return ClassRead(id=class_id, name=school_class.name, year_level=school_class.year_level, student_count=count)


@router.delete("/classes/{class_id}", status_code=204)
def delete_class(class_id: int, session: Session = Depends(get_session)):
    has_notes = session.exec(
        select(Note.id).join(Lesson, Lesson.id == Note.lesson_id).where(Lesson.class_id == class_id)
    ).first()
    if has_notes:
        raise HTTPException(status_code=409, detail="Učenici ovog razreda imaju bilješke; razred se briše tek na kraju godine.")
    session.exec(delete(SchoolClass).where(SchoolClass.id == class_id))
    session.commit()
    return Response(status_code=204)


# --- CSV imports ------------------------------------------------------------------------------


def _read_csv(upload: UploadFile) -> bytes:
    data = upload.file.read(MAX_CSV_BYTES + 1)
    if len(data) > MAX_CSV_BYTES:
        raise HTTPException(status_code=413, detail="CSV datoteka je prevelika.")
    return data


def _run_import(session: Session, importer, year: SchoolYear, data: bytes, dry_run: bool) -> ImportReport:
    try:
        report = importer(session, year, data, dry_run)
    except CsvFormatError as exc:
        session.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if dry_run or report.errors:
        session.rollback()
    else:
        session.commit()
    return report


@router.post("/roster/import", response_model=ImportReport)
def roster_import(
    file: UploadFile = File(...),
    dry_run: bool = Query(True),
    year_id: int | None = None,
    session: Session = Depends(get_session),
    clock: Clock = Depends(get_clock),
):
    """Preview with dry_run=true (the default), then send again with dry_run=false to apply.
    Nothing is applied while the report has errors."""
    return _run_import(session, import_roster, _year(session, year_id, clock), _read_csv(file), dry_run)


@router.post("/timetable/import", response_model=ImportReport)
def timetable_import(
    file: UploadFile = File(...),
    dry_run: bool = Query(True),
    year_id: int | None = None,
    session: Session = Depends(get_session),
    clock: Clock = Depends(get_clock),
):
    return _run_import(session, import_timetable, _year(session, year_id, clock), _read_csv(file), dry_run)


# --- Timetable slots -----------------------------------------------------------------------------


def _slot_rows(session: Session, year: SchoolYear, slot_ids: list[int] | None = None) -> list[SlotRead]:
    query = (
        select(TimetableSlot, TeachingAssignment, SchoolClass, Subject, User)
        .join(TeachingAssignment, TeachingAssignment.id == TimetableSlot.assignment_id)
        .join(SchoolClass, SchoolClass.id == TeachingAssignment.class_id)
        .join(Subject, Subject.id == TeachingAssignment.subject_id)
        .join(User, User.id == Subject.professor_id)
        .where(TeachingAssignment.school_year_id == year.id)
        .order_by(TimetableSlot.weekday, TimetableSlot.starts_at, SchoolClass.name)
    )
    if slot_ids is not None:
        query = query.where(col(TimetableSlot.id).in_(slot_ids))
    return [
        SlotRead(
            id=slot.id,
            weekday=slot.weekday,
            starts_at=slot.starts_at,
            ends_at=slot.ends_at,
            week=slot.week,
            class_id=school_class.id,
            class_name=school_class.name,
            subject_id=subject.id,
            subject_name=subject.timetable_name,
            professor_id=professor.id,
            professor_name=professor.display_name or professor.username,
        )
        for slot, _, school_class, subject, professor in session.exec(query).all()
    ]


@router.get("/slots", response_model=list[SlotRead])
def list_slots(year_id: int | None = None, session: Session = Depends(get_session), clock: Clock = Depends(get_clock)):
    return _slot_rows(session, _year(session, year_id, clock))


def _apply_slot(session: Session, year: SchoolYear, slot: TimetableSlot, body: SlotWrite) -> None:
    if body.ends_at <= body.starts_at:
        raise HTTPException(status_code=422, detail="Kraj sata mora biti nakon početka.")
    school_class = session.get(SchoolClass, body.class_id)
    professor = session.get(User, body.professor_id)
    if school_class is None or school_class.school_year_id != year.id:
        raise HTTPException(status_code=422, detail="Razred ne postoji u ovoj školskoj godini.")
    if professor is None or not professor.is_professor:
        raise HTTPException(status_code=422, detail="Odabrani korisnik nije profesor.")
    subject = find_or_create_subject(session, professor, body.subject_name.strip())
    assignment = find_or_create_assignment(session, year, subject, school_class)
    slot.assignment_id = assignment.id
    slot.weekday, slot.starts_at, slot.ends_at, slot.week = body.weekday, body.starts_at, body.ends_at, body.week
    session.add(slot)


@router.post("/slots", response_model=SlotRead, status_code=201)
def create_slot(
    body: SlotWrite, year_id: int | None = None, session: Session = Depends(get_session), clock: Clock = Depends(get_clock)
):
    year = _year(session, year_id, clock)
    slot = TimetableSlot(assignment_id=0, weekday=body.weekday, starts_at=body.starts_at, ends_at=body.ends_at)
    _apply_slot(session, year, slot, body)
    session.commit()
    return _slot_rows(session, year, [slot.id])[0]


@router.put("/slots/{slot_id}", response_model=SlotRead)
def update_slot(slot_id: int, body: SlotWrite, session: Session = Depends(get_session), clock: Clock = Depends(get_clock)):
    slot = session.get(TimetableSlot, slot_id)
    if slot is None:
        raise HTTPException(status_code=404, detail="Sat ne postoji.")
    year = session.get(SchoolYear, session.get(TeachingAssignment, slot.assignment_id).school_year_id)
    _apply_slot(session, year, slot, body)
    session.commit()
    return _slot_rows(session, year, [slot.id])[0]


@router.delete("/slots/{slot_id}", status_code=204)
def delete_slot(slot_id: int, session: Session = Depends(get_session)):
    """Lessons that already happened keep their notes (they store their own class and subject)."""
    session.exec(delete(TimetableSlot).where(TimetableSlot.id == slot_id))
    session.commit()
    return Response(status_code=204)


# --- Per-date overrides --------------------------------------------------------------------------


def _override_read(session: Session, override: LessonOverride, year: SchoolYear | None) -> OverrideRead:
    professor = session.get(User, override.substitute_professor_id) if override.substitute_professor_id else None
    subject = session.get(Subject, override.substitute_subject_id) if override.substitute_subject_id else None
    slots = _slot_rows(session, year, [override.slot_id]) if year else []
    return OverrideRead(
        id=override.id,
        slot_id=override.slot_id,
        date=override.date,
        cancelled=override.cancelled,
        substitute_professor_id=professor.id if professor else None,
        substitute_professor_name=(professor.display_name or professor.username) if professor else None,
        substitute_subject_id=subject.id if subject else None,
        substitute_subject_name=subject.name if subject else None,
        slot=slots[0] if slots else None,
    )


@router.get("/overrides", response_model=list[OverrideRead])
def list_overrides(
    start: date | None = None,
    end: date | None = None,
    year_id: int | None = None,
    session: Session = Depends(get_session),
    clock: Clock = Depends(get_clock),
):
    year = _year(session, year_id, clock)
    query = (
        select(LessonOverride)
        .join(TimetableSlot, TimetableSlot.id == LessonOverride.slot_id)
        .join(TeachingAssignment, TeachingAssignment.id == TimetableSlot.assignment_id)
        .where(TeachingAssignment.school_year_id == year.id)
        .order_by(LessonOverride.date)
    )
    if start:
        query = query.where(LessonOverride.date >= start)
    if end:
        query = query.where(LessonOverride.date <= end)
    return [_override_read(session, o, year) for o in session.exec(query).all()]


@router.put("/overrides", response_model=OverrideRead)
def upsert_override(body: OverrideWrite, session: Session = Depends(get_session), clock: Clock = Depends(get_clock)):
    """Cancel a lesson, or change its professor or subject, for one date."""
    slot = session.get(TimetableSlot, body.slot_id)
    if slot is None:
        raise HTTPException(status_code=404, detail="Sat ne postoji.")
    if body.date.isoweekday() != slot.weekday:
        raise HTTPException(status_code=422, detail="Taj se sat ne održava na odabrani dan u tjednu.")
    if not body.cancelled and not body.substitute_professor_id and not body.substitute_subject_id:
        raise HTTPException(status_code=422, detail="Odaberite otkazivanje, zamjenskog profesora ili drugi predmet.")
    if body.substitute_professor_id:
        professor = session.get(User, body.substitute_professor_id)
        if professor is None or not professor.is_professor:
            raise HTTPException(status_code=422, detail="Zamjena mora biti profesor.")
    if body.substitute_subject_id and session.get(Subject, body.substitute_subject_id) is None:
        raise HTTPException(status_code=422, detail="Predmet ne postoji.")
    override = session.exec(
        select(LessonOverride).where(LessonOverride.slot_id == body.slot_id, LessonOverride.date == body.date)
    ).first() or LessonOverride(slot_id=body.slot_id, date=body.date)
    override.cancelled = body.cancelled
    override.substitute_professor_id = None if body.cancelled else body.substitute_professor_id
    override.substitute_subject_id = None if body.cancelled else body.substitute_subject_id
    session.add(override)
    session.commit()
    year = session.get(SchoolYear, session.get(TeachingAssignment, slot.assignment_id).school_year_id)
    return _override_read(session, override, year)


@router.delete("/overrides/{override_id}", status_code=204)
def delete_override(override_id: int, session: Session = Depends(get_session)):
    session.exec(delete(LessonOverride).where(LessonOverride.id == override_id))
    session.commit()
    return Response(status_code=204)


@router.get("/subjects", response_model=list[SubjectOption])
def all_subjects(session: Session = Depends(get_session)):
    """For choosing a substitute subject."""
    rows = session.exec(select(Subject, User).join(User, User.id == Subject.professor_id).order_by(Subject.name)).all()
    return [
        SubjectOption(id=s.id, name=s.name, professor_id=u.id, professor_name=u.display_name or u.username) for s, u in rows
    ]


# --- Users and roles -----------------------------------------------------------------------------


def _user_read(session: Session, user: User, year: SchoolYear | None) -> UserAdminRead:
    class_names: list[str] = []
    if year and user.is_student:
        class_names = list(
            session.exec(
                select(SchoolClass.name)
                .join(Enrollment, Enrollment.class_id == SchoolClass.id)
                .where(Enrollment.student_id == user.id, SchoolClass.school_year_id == year.id)
            ).all()
        )
    return UserAdminRead(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        email=user.email,
        is_student=user.is_student,
        is_professor=user.is_professor,
        is_admin=user.is_admin,
        active=user.active,
        signed_in=user.sub is not None,
        last_login_at=user.last_login_at,
        class_names=class_names,
    )


@router.get("/users", response_model=list[UserAdminRead])
def list_users(
    q: str | None = Query(default=None, max_length=100),
    role: str | None = Query(default=None, pattern="^(student|professor|admin)$"),
    limit: int = Query(default=200, ge=1, le=1000),
    session: Session = Depends(get_session),
    clock: Clock = Depends(get_clock),
):
    query = select(User).order_by(User.display_name, User.username).limit(limit)
    if q and q.strip():
        term = q.strip()
        query = query.where(col(User.username).icontains(term, autoescape=True) | col(User.display_name).icontains(term, autoescape=True))
    if role:
        query = query.where(getattr(User, f"is_{role}"))
    year = current_school_year(session, clock.today())
    return [_user_read(session, u, year) for u in session.exec(query).all()]


@router.patch("/users/{user_id}", response_model=UserAdminRead)
def update_user(
    user_id: int,
    body: UserAdminUpdate,
    admin: User = Depends(require_admin),
    session: Session = Depends(get_session),
    clock: Clock = Depends(get_clock),
):
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Korisnik ne postoji.")
    changes = body.model_dump(exclude_unset=True)
    if user.id == admin.id and (changes.get("is_admin") is False or changes.get("active") is False):
        raise HTTPException(status_code=409, detail="Ne možete sebi oduzeti administratorska prava ni deaktivirati se.")
    for key, value in changes.items():
        if value is not None:
            setattr(user, key, value)
    if user.active is False:
        session.exec(delete(UserSession).where(UserSession.user_id == user.id))
    session.add(user)
    session.commit()
    return _user_read(session, user, current_school_year(session, clock.today()))


# --- Disk usage ----------------------------------------------------------------------------------


@router.get("/storage", response_model=StorageRead)
def storage(session: Session = Depends(get_session)):
    rows = session.exec(
        select(User, func.count(func.distinct(Book.id)), func.coalesce(func.sum(BookFile.original_size + BookFile.pdf_size), 0))
        .join(Subject, Subject.professor_id == User.id)
        .join(Book, Book.subject_id == Subject.id)
        .join(BookFile, BookFile.book_id == Book.id, isouter=True)
        .group_by(User.id)
    ).all()
    originals, pdfs = session.exec(
        select(func.coalesce(func.sum(BookFile.original_size), 0), func.coalesce(func.sum(BookFile.pdf_size), 0))
    ).one()
    root = files_root()
    free = shutil.disk_usage(root).free if root.exists() else None
    return StorageRead(
        total_bytes=disk_usage(root),
        originals_bytes=originals,
        pdf_bytes=pdfs,
        cache_bytes=disk_usage(root / "cache"),
        free_bytes=free,
        by_professor=sorted(
            (
                StorageByProfessor(professor_id=u.id, professor_name=u.display_name or u.username, book_count=books, bytes=size)
                for u, books, size in rows
            ),
            key=lambda row: row.bytes,
            reverse=True,
        ),
    )
