"""Suggest sections (page ranges) for a book's PDF. Professors adjust the suggestions afterwards.

Strategy, from most to least structured:
  1. PDF bookmarks (outline). Word/LibreOffice headings and Markdown headings arrive here too, because
     conversion to PDF turns them into bookmarks.
  2. Headings in the page text: Markdown `#`, "Chapter 3"/"Poglavlje 3" lines, "2.1 Title" lines, and
     known Word heading texts.
  3. Fallback: the whole file as one section, or 10-page parts for long files.
A slide deck is always one section.
"""

import re
from dataclasses import asdict, dataclass
from pathlib import Path

MAX_HEADING_LENGTH = 80
CHUNK_PAGES = 10
SINGLE_SECTION_MAX_PAGES = 20
# A heading among the first lines of a page starts the section on that page; one further down
# means the page is shared with the previous section.
TOP_OF_PAGE_LINES = 3

MD_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
KEYWORD_HEADING = re.compile(
    r"^(?:chapter|unit|lesson|section|part|topic|module|poglavlje|cjelina|lekcija|tema|dio|nastavna cjelina)"
    r"\s+(?:\d+|[ivxlc]+)\b",
    re.IGNORECASE,
)
NUMBERED_HEADING = re.compile(r"^(\d+(?:\.\d+)*)\.?\s+(\S)")


class BookImportError(ValueError):
    """The file can't be used; the message is safe to show to the user."""


@dataclass
class SuggestedSection:
    title: str
    page_start: int  # 1-based, inclusive
    page_end: int
    text: str = ""

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass
class _Start:
    title: str
    page: int  # 0-based
    at_top: bool
    level: int = 1


def suggest_sections(
    pages: list[str],
    outline: list[tuple[str, int]],
    *,
    fallback_title: str,
    slides: bool = False,
    known_headings: list[str] | None = None,
) -> list[SuggestedSection]:
    """`pages` is the text of each page, `outline` the top-level bookmarks as (title, 0-based page)."""
    page_count = len(pages)
    if page_count == 0:
        return []
    if slides:
        return [_section(fallback_title, 0, page_count - 1, pages)]

    starts: list[_Start] = []
    if len(outline) >= 2:
        starts = [_Start(title, page, at_top=True) for title, page in outline]
    if len(starts) < 2 and known_headings:
        starts = _find_known_headings(pages, known_headings)
    if len(starts) < 2:
        starts = _find_text_headings(pages)
    if len(starts) >= 2:
        return _ranges(starts, pages)

    if page_count <= SINGLE_SECTION_MAX_PAGES:
        return [_section(fallback_title, 0, page_count - 1, pages)]
    return [
        _section(f"Stranice {start + 1}–{min(start + CHUNK_PAGES, page_count)}", start, min(start + CHUNK_PAGES, page_count) - 1, pages)
        for start in range(0, page_count, CHUNK_PAGES)
    ]


def _section(title: str, first: int, last: int, pages: list[str]) -> SuggestedSection:
    text = "\n\n".join(pages[first : last + 1]).strip()
    return SuggestedSection(title.strip()[:200] or "Bez naslova", first + 1, last + 1, text)


def _ranges(starts: list[_Start], pages: list[str]) -> list[SuggestedSection]:
    starts = sorted(starts, key=lambda s: (s.page, not s.at_top))
    sections: list[SuggestedSection] = []
    first = starts[0]
    front_end = first.page - 1 if first.at_top else first.page
    if front_end >= 0 and "".join(pages[: front_end + 1]).strip():
        sections.append(_section("Uvod", 0, front_end, pages))
    for n, start in enumerate(starts):
        if n + 1 < len(starts):
            following = starts[n + 1]
            end = following.page - 1 if following.at_top else following.page
        else:
            end = len(pages) - 1
        sections.append(_section(start.title, start.page, max(end, start.page), pages))
    return sections


def _lines(page: str) -> list[str]:
    return [line.strip() for line in page.split("\n") if line.strip()]


def _find_known_headings(pages: list[str], headings: list[str]) -> list[_Start]:
    """Locate Word heading texts in the converted PDF, in order."""
    starts: list[_Start] = []
    page_index = 0
    for heading in headings:
        wanted = _squash(heading)
        for p in range(page_index, len(pages)):
            lines = [_squash(line) for line in _lines(pages[p])]
            if wanted in lines:
                starts.append(_Start(heading, p, at_top=lines.index(wanted) < TOP_OF_PAGE_LINES))
                page_index = p
                break
    return starts


def _find_text_headings(pages: list[str]) -> list[_Start]:
    found: list[_Start] = []
    in_code = False
    for p, page in enumerate(pages):
        previous = ""
        for i, line in enumerate(_lines(page)):
            if line.startswith("```"):
                in_code = not in_code
            elif not in_code and (level := _heading_level(line, previous)):
                found.append(_Start(MD_HEADING.sub(r"\2", line), p, at_top=i < TOP_OF_PAGE_LINES, level=level))
            previous = line
    if not found:
        return []
    # Split on the shallowest level that repeats; deeper headings stay inside the section.
    levels = [start.level for start in found]
    repeated = [level for level in sorted(set(levels)) if levels.count(level) >= 2]
    split_level = repeated[0] if repeated else min(levels)
    return [start for start in found if start.level <= split_level]


def _heading_level(line: str, previous: str) -> int:
    if match := MD_HEADING.match(line):
        return len(match.group(1))
    if len(line) > MAX_HEADING_LENGTH or "...." in line or line[-1] in ".,;!?:":
        return 0
    if KEYWORD_HEADING.match(line):
        return 1
    # "2.1 Linear equations": capitalised, short, and not part of a numbered list.
    numbered = NUMBERED_HEADING.match(line)
    if numbered and numbered.group(2).isupper() and not NUMBERED_HEADING.match(previous):
        return numbered.group(1).count(".") + 1
    return 0


def _squash(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


# --- Reading files ---------------------------------------------------------------------------


def read_pdf(path: Path) -> tuple[list[str], list[tuple[str, int]], str]:
    """(page texts, top-level outline, metadata title). Raises BookImportError for unusable PDFs."""
    from pypdf import PdfReader

    try:
        reader = PdfReader(str(path))
        if reader.is_encrypted and not reader.decrypt(""):
            raise BookImportError("PDF je zaštićen lozinkom.")
        pages = [_normalize(_safe_text(page)) for page in reader.pages]
        title = (reader.metadata.title or "").strip() if reader.metadata else ""
        outline = _pdf_outline(reader)
    except BookImportError:
        raise
    except Exception as exc:  # pypdf raises many exception types on malformed input
        raise BookImportError("PDF se ne može pročitati. Datoteka je možda oštećena.") from exc
    if not pages:
        raise BookImportError("PDF nema stranica.")
    return pages, outline, title


def _safe_text(page) -> str:
    # Scanned pages have no text layer; they still work, just without heading detection.
    try:
        return page.extract_text() or ""
    except Exception:
        return ""


def _pdf_outline(reader) -> list[tuple[str, int]]:
    """Top-level bookmarks as (title, 0-based page), descending one level if the top is a single entry."""
    try:
        items = reader.outline
        entries = [item for item in items if not isinstance(item, list)]
        if len(entries) < 2:
            nested = next((item for item in items if isinstance(item, list)), [])
            entries = [item for item in nested if not isinstance(item, list)]
        starts = []
        for item in entries:
            page = reader.get_destination_page_number(item)
            if page is not None:
                starts.append((str(item.title).strip() or f"Stranica {page + 1}", page))
        return sorted(starts, key=lambda entry: entry[1])
    except Exception:
        return []


def docx_headings(path: Path) -> list[str]:
    """Heading texts of a Word document, used when its PDF has no bookmarks."""
    from docx import Document

    try:
        document = Document(str(path))
    except Exception:
        return []
    headings = []
    for paragraph in document.paragraphs:
        style = (paragraph.style.name if paragraph.style is not None else "").lower()
        if style in ("heading 1", "heading1", "naslov 1") and paragraph.text.strip():
            headings.append(paragraph.text.strip())
    return headings


def docx_title(path: Path) -> str:
    """The document's Title (core property or a paragraph in the Title style)."""
    from docx import Document

    try:
        document = Document(str(path))
    except Exception:
        return ""
    if (document.core_properties.title or "").strip():
        return document.core_properties.title.strip()
    for paragraph in document.paragraphs:
        style = (paragraph.style.name if paragraph.style is not None else "").lower()
        if style in ("title", "naslov") and paragraph.text.strip():
            return paragraph.text.strip()
    return ""


def fallback_title(filename: str) -> str:
    return re.sub(r"[_-]+", " ", Path(filename).stem).strip() or "Bez naslova"


def decode_text(data: bytes) -> str:
    for encoding in ("utf-8-sig", "cp1250"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1")


def _normalize(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\x0c", "\n").replace(" ", " ")
    text = "\n".join(line.rstrip() for line in text.split("\n"))
    return re.sub(r"\n{3,}", "\n\n", text).strip()
