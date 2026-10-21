from datetime import date, time

import pytest
from sqlmodel import select

from albok_api.models import Lesson, LessonWebTool, WebTool
from albok_api.web_tools import InvalidLink, normalize_link

# --- Link rules -----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("https://dictionary.cambridge.org/  ", "https://dictionary.cambridge.org/"),
        ("  https://quizlet.com", "https://quizlet.com/"),
        ("https://Quizlet.COM/en/Sets?x=1#top", "https://quizlet.com/en/Sets?x=1#top"),
        ("HTTPS://www.geogebra.org/classic", "https://www.geogebra.org/classic"),
        ("https://quizlet.com:443/", "https://quizlet.com/"),
        ("https://rječnik.hr/", "https://xn--rjenik-k2a.hr/"),
        ("https://www.wordreference.com/definition/report", "https://www.wordreference.com/definition/report"),
    ],
)
def test_accepted_links_are_normalized(raw, expected):
    assert normalize_link(raw) == expected


@pytest.mark.parametrize(
    ("raw", "reason"),
    [
        ("", "Upišite"),
        ("quizlet.com", "https://"),
        ("http://quizlet.com", "https://"),
        ("ftp://quizlet.com/", "https://"),
        ("javascript:alert(1)", "https://"),
        ("data:text/html,hi", "https://"),
        ("https://", "ispravna"),
        ("https://192.168.1.20/moodle", "IP"),  # AE7
        ("https://[::1]/", "IP"),
        ("https://127.1/", "IP"),
        ("https://0177.0.0.1/", "IP"),
        ("https://0x7f.0.0.1/", "IP"),
        ("https://2130706433/", "IP"),
        ("https://intranet.local/", "školske mreže"),
        ("https://intranet.local./", "školske mreže"),
        ("https://moodle/", "školske mreže"),
        ("https://localhost/", "školske mreže"),
        ("https://router.home.arpa/", "školske mreže"),
        ("https://printer.lan/", "školske mreže"),
        ("https://example.com/worksheet.pdf", "datoteku"),  # AE7
        ("https://example.com/files/Setup.EXE", "datoteku"),
        ("https://example.com/archive.zip?download=1", "datoteku"),
        ("https://user:pw@quizlet.com/", "korisničko ime"),
        ("https://user@quizlet.com/", "korisničko ime"),
        ("https://quizlet.com:8443/", "port"),
        ("https://youtu.be/abc", "punu adresu"),
        ("https://forms.gle/xyz", "punu adresu"),
        ("https://www.bit.ly/x", "punu adresu"),
        ("https://quizlet.com\\.evil.example/", "ispravna"),
        ("https://%31%32%37.0.0.1/", "IP"),
        ("https://quiz%6cet.com/", "ispravna"),
        ("https://quiz let.com/", "ispravna"),
        ("https://quizlet.com:abc/", "ispravna"),
    ],
)
def test_rejected_links_give_a_reason(raw, reason):
    with pytest.raises(InvalidLink) as error:
        normalize_link(raw)
    assert reason in str(error.value)


# --- Data ---------------------------------------------------------------------------------------


def test_deleting_a_web_tool_closes_it_for_every_lesson(db, school):
    tool = WebTool(subject_id=school.history.id, name="Rječnik", url="https://dictionary.cambridge.org/")
    lesson = Lesson(class_id=school.b3.id, subject_id=school.history.id, date=date(2026, 10, 20), starts_at=time(8), ends_at=time(8, 45))
    db.add_all([tool, lesson])
    db.flush()
    db.add(LessonWebTool(lesson_id=lesson.id, web_tool_id=tool.id))
    db.commit()

    db.delete(tool)
    db.commit()
    assert db.exec(select(LessonWebTool)).first() is None
    assert db.get(Lesson, lesson.id) is not None
