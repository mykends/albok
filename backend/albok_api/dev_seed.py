"""Development data for the mock login: one school year, two classes, the mock users, a timetable and
three published books. Runs once, on an empty database, when ALBOK_MOCK_OIDC=1."""

import logging
from datetime import date
from pathlib import Path

from sqlalchemy.engine import Engine
from sqlmodel import Session, select

from .clock import Clock
from .documents import new_file_paths, process_file, store_bytes
from .models import Book, BookFile, Publication, SchoolClass, SchoolYear, Section, Subject, User
from .school_csv import import_roster, import_timetable

log = logging.getLogger(__name__)
SAMPLES = Path(__file__).resolve().parent.parent / "samples"

ROSTER = """korisnik;ime i prezime;uloga;razred
ivana.horvat@skole.hr;Ivana Horvat;profesor;
marko.kovac@skole.hr;Marko Kovač;profesor;
maja.juric@skole.hr;Maja Jurić;profesor;
luka.babic@skole.hr;Luka Babić;učenik;3.B
ana.maric@skole.hr;Ana Marić;učenik;3.B
petra.novak@skole.hr;Petra Novak;učenik;1.A
"""
PERIODS = ["08:00-08:45", "08:50-09:35", "09:40-10:25", "10:40-11:25", "11:30-12:15", "12:20-13:05", "13:10-13:55"]
SUBJECTS = [("Povijest", "ivana.horvat@skole.hr"), ("Matematika", "marko.kovac@skole.hr"),
            ("Geografija", "ivana.horvat@skole.hr"), ("Fizika", "marko.kovac@skole.hr"),
            ("Engleski jezik", "maja.juric@skole.hr")]  # fmt: skip

HISTORY_TEXT = """# Povijest 3

## 1. Prva industrijska revolucija

Krajem 18. stoljeća u Velikoj Britaniji parni stroj mijenja proizvodnju. Tvornice zamjenjuju radionice,
a gradovi naglo rastu.

- Parni stroj (James Watt, 1769.)
- Tekstilna industrija
- Željeznica

## 2. Revolucije 1848.

Godine 1848. u mnogim europskim zemljama izbijaju revolucije. U Hrvatskoj ban Josip Jelačić ukida kmetstvo.

## 3. Ujedinjenje Italije i Njemačke

Italija se ujedinjuje 1861., a Njemačka 1871. pod vodstvom Otta von Bismarcka.
"""


def _timetable() -> str:
    lines = ["dan;početak;kraj;tjedan;razred;predmet;nastavnik"]
    for weekday in range(1, 6):
        for n, period in enumerate(PERIODS):
            start, end = period.split("-")
            # Offsetting 1.A by one subject alternates professors, so nobody teaches two classes at once.
            for offset, class_name in enumerate(["3.B", "1.A"]):
                subject, professor = SUBJECTS[(weekday + n + offset) % len(SUBJECTS)]
                lines.append(f"{weekday};{start};{end};;{class_name};{subject};{professor}")
    return "\n".join(lines) + "\n"


def _school_year_for(today: date) -> SchoolYear:
    first = today.year if today.month >= 8 else today.year - 1
    return SchoolYear(
        name=f"{first}./{first + 1}.",
        start=date(first, 9, 1),
        end=date(first + 1, 6, 20),
        deletion_date=date(first + 1, 8, 31),
    )


def _add_book(session: Session, engine: Engine, subject: Subject, title: str, filename: str, text: str, classes: list[SchoolClass]) -> None:
    book = Book(subject_id=subject.id, title=title, exportable=True)
    session.add(book)
    session.flush()
    book_file = BookFile(book_id=book.id, original_filename=filename, original_path="")
    session.add(book_file)
    session.flush()
    relative, destination = new_file_paths(book.id, book_file.id, filename)
    book_file.original_size = store_bytes(text.encode("utf-8"), destination)
    book_file.original_path = relative
    session.commit()
    process_file(engine, book_file.id)
    for section in session.exec(select(Section).where(Section.book_id == book.id)).all():
        for school_class in classes:
            session.add(Publication(section_id=section.id, class_id=school_class.id))
    session.commit()


def seed_if_empty(engine: Engine, clock: Clock) -> None:
    with Session(engine) as session:
        if session.exec(select(SchoolYear)).first() is not None:
            return
        log.info("Seeding development data")
        year = _school_year_for(clock.today())
        session.add(year)
        session.add(User(username="ana.admin@skole.hr", display_name="Ana Admin", is_admin=True))
        session.flush()
        for importer, data in ((import_roster, ROSTER), (import_timetable, _timetable())):
            report = importer(session, year, data.encode("utf-8"), dry_run=False)
            if report.errors:
                raise RuntimeError(f"Seed data is invalid: {report.errors}")
        session.commit()

        b3 = session.exec(select(SchoolClass).where(SchoolClass.name == "3.B")).one()
        math = session.exec(select(Subject).where(Subject.timetable_name == "Matematika")).one()
        history = session.exec(select(Subject).where(Subject.timetable_name == "Povijest")).one()
        english = session.exec(select(Subject).where(Subject.timetable_name == "Engleski jezik")).one()
        math.color, math.icon, math.description = "#2563eb", "calculator", "Algebra i funkcije"
        history.color, history.icon, history.description = "#d97706", "landmark", "19. stoljeće"
        english.color, english.icon, english.description = "#7c3aed", "languages", "Gramatika i vokabular"
        session.add_all([math, history, english])
        session.commit()
        _add_book(session, engine, math, "Osnove algebre", "algebra-basics.md", (SAMPLES / "algebra-basics.md").read_text(), [b3])
        _add_book(session, engine, history, "Povijest 3", "povijest-3.md", HISTORY_TEXT, [b3])
        _add_book(session, engine, english, "English Grammar Basics", "english-grammar-basics.md", (SAMPLES / "english-grammar-basics.md").read_text(), [b3])
