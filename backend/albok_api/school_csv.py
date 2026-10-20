"""Roster and timetable CSV imports.

Both run inside the caller's transaction and return a report. The caller commits only when the report
has no errors and it isn't a dry run, so a bad file never half-applies.

Headers are matched case-insensitively, in Croatian or English, with `,` `;` or tab as the delimiter
(Excel in Croatian locale saves with `;`). See README "School data" for the column list.
"""

import csv
import io
import re
from dataclasses import dataclass, field
from datetime import time

from sqlmodel import Session, col, select

from .importers import decode_text
from .models import (
    Enrollment,
    LessonOverride,
    SchoolClass,
    SchoolYear,
    Subject,
    TeachingAssignment,
    TimetableSlot,
    User,
)
from .schemas import ImportIssue, ImportReport

ROSTER_COLUMNS = {
    "username": ["korisnik", "korisničko ime", "korisnicko ime", "aai", "aai korisnik", "username", "uid", "login"],
    "name": ["ime i prezime", "ime", "name", "full name", "prezime i ime"],
    "role": ["uloga", "role", "vrsta"],
    "class": ["razred", "class", "odjel", "razredni odjel"],
    "year_level": ["godina", "razina", "year", "year_level", "year level", "godište"],
}
TIMETABLE_COLUMNS = {
    "weekday": ["dan", "weekday", "day", "dan u tjednu"],
    "start": ["početak", "pocetak", "start", "od", "starts_at"],
    "end": ["kraj", "end", "do", "ends_at", "završetak", "zavrsetak"],
    "week": ["tjedan", "week", "a/b"],
    "class": ["razred", "class", "odjel", "razredni odjel"],
    "subject": ["predmet", "subject"],
    "professor": ["nastavnik", "nastavnica", "profesor", "profesorica", "professor", "teacher", "korisnik"],
}
STUDENT_ROLES = {"učenik", "ucenik", "učenica", "ucenica", "student", "s"}
PROFESSOR_ROLES = {"profesor", "profesorica", "nastavnik", "nastavnica", "teacher", "professor", "p"}
WEEKDAYS = {
    "pon": 1, "ponedjeljak": 1, "mon": 1, "monday": 1,
    "uto": 2, "utorak": 2, "tue": 2, "tuesday": 2,
    "sri": 3, "srijeda": 3, "wed": 3, "wednesday": 3,
    "čet": 4, "cet": 4, "četvrtak": 4, "cetvrtak": 4, "thu": 4, "thursday": 4,
    "pet": 5, "petak": 5, "fri": 5, "friday": 5,
    "sub": 6, "subota": 6, "sat": 6, "saturday": 6,
    "ned": 7, "nedjelja": 7, "sun": 7, "sunday": 7,
}  # fmt: skip
CLASS_NAME = re.compile(r"^\s*(\d+)\s*\.?\s*([A-Za-zČĆŽŠĐčćžšđ0-9-]*)\s*$")


class CsvFormatError(ValueError):
    pass


@dataclass
class _Report:
    dry_run: bool
    rows: int = 0
    created: dict[str, int] = field(default_factory=dict)
    updated: dict[str, int] = field(default_factory=dict)
    removed: dict[str, int] = field(default_factory=dict)
    errors: list[ImportIssue] = field(default_factory=list)
    warnings: list[ImportIssue] = field(default_factory=list)

    def count(self, bucket: dict[str, int], key: str, n: int = 1) -> None:
        bucket[key] = bucket.get(key, 0) + n

    def error(self, line: int, message: str) -> None:
        self.errors.append(ImportIssue(line=line, message=message))

    def warn(self, line: int, message: str) -> None:
        self.warnings.append(ImportIssue(line=line, message=message))

    def build(self) -> ImportReport:
        return ImportReport(
            dry_run=self.dry_run,
            rows=self.rows,
            created=self.created,
            updated=self.updated,
            removed=self.removed,
            errors=self.errors,
            warnings=self.warnings,
        )


def read_rows(data: bytes, columns: dict[str, list[str]], required: list[str]) -> list[tuple[int, dict[str, str]]]:
    """[(line number, {canonical column: value})]"""
    text = decode_text(data)
    if not text.strip():
        raise CsvFormatError("Datoteka je prazna.")
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
    except csv.Error:

        class dialect(csv.excel):
            delimiter = ";" if sample.count(";") > sample.count(",") else ","
    reader = csv.reader(io.StringIO(text), dialect)
    header = next(reader, [])
    aliases = {alias: key for key, names in columns.items() for alias in names}
    mapping: dict[int, str] = {}
    for index, name in enumerate(header):
        key = aliases.get(name.strip().lower())
        if key and key not in mapping.values():
            mapping[index] = key
    missing = [key for key in required if key not in mapping.values()]
    if missing:
        names = ", ".join(f"'{columns[key][0]}'" for key in missing)
        raise CsvFormatError(f"Nedostaju stupci: {names}. Prvi redak mora sadržavati nazive stupaca.")

    rows = []
    for line, values in enumerate(reader, start=2):
        if not any(v.strip() for v in values):
            continue
        rows.append((line, {key: (values[i].strip() if i < len(values) else "") for i, key in mapping.items()}))
    return rows


def _class_level(name: str) -> int | None:
    match = CLASS_NAME.match(name)
    return int(match.group(1)) if match else None


def normalize_class_name(name: str) -> str:
    """"3 b", "3.b" and "3b" all become "3.B"."""
    match = CLASS_NAME.match(name)
    if not match:
        return name.strip()
    return f"{match.group(1)}.{match.group(2).upper()}" if match.group(2) else f"{match.group(1)}."


# --- Roster ---------------------------------------------------------------------------------


def import_roster(session: Session, year: SchoolYear, data: bytes, dry_run: bool) -> ImportReport:
    report = _Report(dry_run=dry_run)
    rows = read_rows(data, ROSTER_COLUMNS, ["username"])
    report.rows = len(rows)

    classes = {c.name: c for c in session.exec(select(SchoolClass).where(SchoolClass.school_year_id == year.id)).all()}
    users = {u.username: u for u in session.exec(select(User)).all()}
    seen: dict[str, int] = {}
    wanted_enrollments: set[tuple[int, int]] = set()

    for line, row in rows:
        username = row["username"].lower()
        if not username or " " in username:
            report.error(line, f"Neispravno korisničko ime '{row['username']}'.")
            continue
        if username in seen:
            report.error(line, f"{username} se ponavlja (prvi put u retku {seen[username]}).")
            continue
        seen[username] = line

        role_text = row.get("role", "").lower()
        class_name = normalize_class_name(row.get("class", ""))
        if role_text in PROFESSOR_ROLES or (not role_text and not class_name):
            role = "professor"
        elif role_text in STUDENT_ROLES or (not role_text and class_name):
            role = "student"
        else:
            report.error(line, f"Nepoznata uloga '{row.get('role')}'. Koristite 'učenik' ili 'profesor'.")
            continue

        user = users.get(username)
        if user is None:
            user = User(username=username, display_name=row.get("name", ""))
            users[username] = user
            report.count(report.created, "users")
        elif row.get("name") and user.display_name != row["name"] and not user.sub:
            user.display_name = row["name"]
            report.count(report.updated, "users")

        if role == "professor":
            user.is_professor = True
            session.add(user)
            continue

        if not class_name:
            report.error(line, f"Učenik {username} nema razred.")
            continue
        level_text = row.get("year_level", "")
        level = int(level_text) if level_text.isdigit() else _class_level(class_name)
        if level is None:
            report.error(line, f"Nedostaje godina za razred '{class_name}'.")
            continue
        school_class = classes.get(class_name)
        if school_class is None:
            school_class = SchoolClass(school_year_id=year.id, name=class_name, year_level=level)
            session.add(school_class)
            session.flush()
            classes[class_name] = school_class
            report.count(report.created, "classes")
        user.is_student = True
        session.add(user)
        session.flush()
        wanted_enrollments.add((user.id, school_class.id))

    if report.errors:
        return report.build()
    class_ids = [c.id for c in classes.values()]
    existing = session.exec(select(Enrollment).where(col(Enrollment.class_id).in_(class_ids))).all() if class_ids else []
    existing_pairs = {(e.student_id, e.class_id): e for e in existing}
    for pair, enrollment in existing_pairs.items():
        if pair not in wanted_enrollments:
            session.delete(enrollment)
            report.count(report.removed, "enrollments")
    for student_id, class_id in wanted_enrollments - existing_pairs.keys():
        session.add(Enrollment(student_id=student_id, class_id=class_id))
        report.count(report.created, "enrollments")

    left = {pair[0] for pair in existing_pairs} - {pair[0] for pair in wanted_enrollments}
    if left:
        report.warn(0, f"{len(left)} učenika više nije ni u jednom razredu. Njihovi računi ostaju; deaktivirajte ih ako su otišli.")
    return report.build()


# --- Timetable --------------------------------------------------------------------------------


def _parse_time(text: str) -> time | None:
    match = re.match(r"^\s*(\d{1,2})[:.](\d{2})\s*$", text)
    if not match or int(match.group(1)) > 23 or int(match.group(2)) > 59:
        return None
    return time(int(match.group(1)), int(match.group(2)))


def _parse_weekday(text: str) -> int | None:
    text = text.strip().lower().rstrip(".")
    if text.isdigit() and 1 <= int(text) <= 7:
        return int(text)
    return WEEKDAYS.get(text)


def find_or_create_subject(session: Session, professor: User, subject_name: str, report: _Report | None = None) -> Subject:
    subject = session.exec(
        select(Subject).where(Subject.professor_id == professor.id, Subject.timetable_name == subject_name)
    ).first()
    if subject is None:
        subject = Subject(professor_id=professor.id, timetable_name=subject_name, name=subject_name)
        session.add(subject)
        session.flush()
        if report:
            report.count(report.created, "subjects")
    return subject


def find_or_create_assignment(
    session: Session, year: SchoolYear, subject: Subject, school_class: SchoolClass, report: _Report | None = None
) -> TeachingAssignment:
    assignment = session.exec(
        select(TeachingAssignment).where(
            TeachingAssignment.subject_id == subject.id, TeachingAssignment.class_id == school_class.id
        )
    ).first()
    if assignment is None:
        assignment = TeachingAssignment(school_year_id=year.id, subject_id=subject.id, class_id=school_class.id)
        session.add(assignment)
        session.flush()
        if report:
            report.count(report.created, "assignments")
    return assignment


def import_timetable(session: Session, year: SchoolYear, data: bytes, dry_run: bool) -> ImportReport:
    """Replaces the year's timetable. Unchanged slots keep their id (and their overrides and lessons)."""
    report = _Report(dry_run=dry_run)
    rows = read_rows(data, TIMETABLE_COLUMNS, ["weekday", "start", "end", "class", "subject", "professor"])
    report.rows = len(rows)

    classes = {c.name: c for c in session.exec(select(SchoolClass).where(SchoolClass.school_year_id == year.id)).all()}
    users = {u.username: u for u in session.exec(select(User)).all()}
    wanted_slots: dict[tuple, int] = {}
    used_assignments: set[int] = set()
    busy: dict[tuple, int] = {}

    for line, row in rows:
        weekday = _parse_weekday(row["weekday"])
        starts_at, ends_at = _parse_time(row["start"]), _parse_time(row["end"])
        week = row.get("week", "").strip().upper() or None
        class_name = normalize_class_name(row["class"])
        subject_name = row["subject"].strip()
        professor = users.get(row["professor"].strip().lower())

        problems = []
        if weekday is None:
            problems.append(f"nepoznat dan '{row['weekday']}'")
        if starts_at is None or ends_at is None:
            problems.append("vrijeme mora biti u obliku HH:MM")
        elif ends_at <= starts_at:
            problems.append("kraj mora biti nakon početka")
        if week not in (None, "A", "B"):
            problems.append(f"tjedan mora biti A, B ili prazno, a ne '{week}'")
        if class_name not in classes:
            problems.append(f"razred '{class_name}' ne postoji (najprije uvezite popis učenika)")
        if not subject_name:
            problems.append("nedostaje predmet")
        if professor is None or not professor.is_professor:
            problems.append(f"'{row['professor']}' nije na popisu kao profesor")
        if problems:
            message = "; ".join(problems)
            report.error(line, message[0].upper() + message[1:] + ".")
            continue

        school_class = classes[class_name]
        clash_key = (school_class.id, weekday, starts_at, week)
        if clash_key in busy:
            report.warn(line, f"{class_name} već ima sat u isto vrijeme (redak {busy[clash_key]}).")
        busy[clash_key] = line

        subject = find_or_create_subject(session, professor, subject_name, report)
        assignment = find_or_create_assignment(session, year, subject, school_class, report)
        used_assignments.add(assignment.id)
        wanted_slots[(assignment.id, weekday, starts_at, ends_at, week)] = line

    if report.errors:
        # The caller rolls back; don't compute removals from a partial file.
        return report.build()
    assignments = session.exec(select(TeachingAssignment).where(TeachingAssignment.school_year_id == year.id)).all()
    existing = (
        session.exec(select(TimetableSlot).where(col(TimetableSlot.assignment_id).in_([a.id for a in assignments]))).all()
        if assignments
        else []
    )
    unused = {a.id for a in assignments if a.id not in used_assignments}
    kept: set[tuple] = set()
    for slot in existing:
        if slot.assignment_id in unused:
            continue  # removed with its assignment below
        key = (slot.assignment_id, slot.weekday, slot.starts_at, slot.ends_at, slot.week)
        if key in wanted_slots and key not in kept:
            kept.add(key)
            continue
        overrides = session.exec(select(LessonOverride.id).where(LessonOverride.slot_id == slot.id)).all()
        if overrides:
            report.warn(0, f"Uklanja se sat s {len(overrides)} izmjena po datumu; te izmjene se brišu.")
        session.delete(slot)
        report.count(report.removed, "slots")
    for key in wanted_slots.keys() - kept:
        assignment_id, weekday, starts_at, ends_at, week = key
        session.add(TimetableSlot(assignment_id=assignment_id, weekday=weekday, starts_at=starts_at, ends_at=ends_at, week=week))
        report.count(report.created, "slots")
    for assignment in assignments:
        if assignment.id not in used_assignments:
            session.delete(assignment)
            report.count(report.removed, "assignments")
    # Lessons keep copies of class, subject and times, so removing a slot never removes notes.
    session.flush()
    return report.build()
