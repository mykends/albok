"""Turn uploaded book files into ordered, readable sections.

Strategy, from most to least structured:
  1. PDF bookmarks (outline) or DOCX heading styles
  2. Markdown headings / "Chapter 3", "Lesson 2", "1.2 Title" style headings in the text
  3. Fallback: one section per PDF page, or ~600-word chunks for plain text
Section content is kept as lightweight Markdown (headings, bullets) for the reader.
"""

import re
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

SUPPORTED_EXTENSIONS = (".pdf", ".docx", ".txt", ".md", ".markdown")
CHUNK_WORDS = 600
MAX_HEADING_LENGTH = 80

MD_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
KEYWORD_HEADING = re.compile(
    r"^(?:chapter|unit|lesson|section|part|topic|module)\s+(?:\d+|[ivxlc]+)\b", re.IGNORECASE
)
NUMBERED_HEADING = re.compile(r"^\d+(?:\.\d+)*\.?\s+(\S)")


class BookImportError(ValueError):
    """The file can't be turned into sections; the message is safe to show to the user."""


@dataclass
class ParsedSection:
    title: str
    content: str

    @property
    def word_count(self) -> int:
        return len(self.content.split())


@dataclass
class ParsedBook:
    title: str
    sections: list[ParsedSection]


def parse_book(filename: str, data: bytes) -> ParsedBook:
    ext = Path(filename).suffix.lower()
    fallback_title = re.sub(r"[_-]+", " ", Path(filename).stem).strip() or "Untitled book"

    if ext == ".pdf":
        book = _parse_pdf(data, fallback_title)
    elif ext == ".docx":
        book = _parse_docx(data, fallback_title)
    elif ext in (".txt", ".md", ".markdown"):
        book = parse_text(_decode(data), fallback_title)
    else:
        raise BookImportError(f"Unsupported file type '{ext or filename}'. Use PDF, DOCX, TXT or Markdown.")

    if not book.sections:
        raise BookImportError("No readable text was found in this file.")
    return book


def parse_text(text: str, fallback_title: str) -> ParsedBook:
    lines = _normalize(text).split("\n")
    split = _split_markdown(lines) or _split_plain(lines)
    if split:
        title, sections = split
        return ParsedBook(title or fallback_title, sections)
    return ParsedBook(fallback_title, _chunk(lines, fallback_title))


# --- Heading-based splitting -------------------------------------------------


def _split_markdown(lines: list[str]) -> tuple[str | None, list[ParsedSection]] | None:
    headings: list[tuple[int, int, str]] = []  # (line index, level, text)
    in_code = False
    for i, line in enumerate(lines):
        if line.lstrip().startswith("```"):
            in_code = not in_code
        elif not in_code and (match := MD_HEADING.match(line)):
            headings.append((i, len(match.group(1)), match.group(2).strip()))
    if not headings:
        return None

    # A lone top-level heading at the very start is the book title, not a section.
    title = None
    first_text_line = next((i for i, line in enumerate(lines) if line.strip()), None)
    level_one = [h for h in headings if h[1] == 1]
    if len(level_one) == 1 and headings[0][0] == first_text_line and headings[0][1] == 1:
        title = headings[0][2]
        lines = lines[:]
        lines[headings[0][0]] = ""
        headings = headings[1:]
    if not headings:
        return None

    # Split on the shallowest level that repeats; deeper headings stay inside the section.
    levels = [level for _, level, _ in headings]
    repeated = [level for level in sorted(set(levels)) if levels.count(level) >= 2]
    split_level = repeated[0] if repeated else min(levels)
    boundaries = [(i, text) for i, level, text in headings if level <= split_level]
    return title, _sections_from_boundaries(lines, boundaries)


def _split_plain(lines: list[str]) -> tuple[None, list[ParsedSection]] | None:
    boundaries = [
        (i, line.strip())
        for i, line in enumerate(lines)
        if _is_plain_heading(line, previous=lines[i - 1] if i else "")
    ]
    if len(boundaries) < 2:
        return None
    sections = _sections_from_boundaries(lines, boundaries)
    return (None, sections) if len(sections) >= 2 else None


def _is_plain_heading(line: str, previous: str) -> bool:
    text = line.strip()
    if not text or len(text) > MAX_HEADING_LENGTH or "...." in text or text[-1] in ".,;!?":
        return False
    if KEYWORD_HEADING.match(text):
        return True
    # "2.1 Linear equations" -- only after a blank line, to avoid catching numbered lists.
    numbered = NUMBERED_HEADING.match(text)
    return bool(numbered and numbered.group(1).isupper() and not previous.strip())


def _sections_from_boundaries(lines: list[str], boundaries: list[tuple[int, str]]) -> list[ParsedSection]:
    sections: list[ParsedSection] = []
    preamble = "\n".join(lines[: boundaries[0][0]]).strip()
    if preamble:
        sections.append(ParsedSection("Introduction", preamble))
    for n, (start, heading) in enumerate(boundaries):
        end = boundaries[n + 1][0] if n + 1 < len(boundaries) else len(lines)
        content = "\n".join(lines[start + 1 : end]).strip()
        if content:
            sections.append(ParsedSection(heading, content))
    return sections


def _chunk(lines: list[str], title: str) -> list[ParsedSection]:
    paragraphs = [p.strip() for p in "\n".join(lines).split("\n\n") if p.strip()]
    chunks: list[list[str]] = []
    words = 0
    for paragraph in paragraphs:
        if not chunks or words >= CHUNK_WORDS:
            chunks.append([])
            words = 0
        chunks[-1].append(paragraph)
        words += len(paragraph.split())
    if len(chunks) == 1:
        return [ParsedSection(title, "\n\n".join(chunks[0]))]
    return [ParsedSection(f"Part {n}", "\n\n".join(chunk)) for n, chunk in enumerate(chunks, start=1)]


# --- File formats --------------------------------------------------------------


def _parse_pdf(data: bytes, fallback_title: str) -> ParsedBook:
    from pypdf import PdfReader

    try:
        reader = PdfReader(BytesIO(data))
        if reader.is_encrypted and not reader.decrypt(""):
            raise BookImportError("This PDF is password protected.")
        pages = [_normalize(page.extract_text() or "") for page in reader.pages]
        meta_title = (reader.metadata.title or "").strip() if reader.metadata else ""
        outline = _pdf_outline(reader)
    except BookImportError:
        raise
    except Exception as exc:  # pypdf raises many exception types on malformed input
        raise BookImportError("This PDF could not be read. It may be damaged.") from exc

    if not any(pages):
        raise BookImportError("This PDF has no selectable text (it may be a scan). Run OCR on it first.")
    title = meta_title or fallback_title

    if len(outline) >= 2:
        sections: list[ParsedSection] = []
        front = "\n\n".join(pages[: outline[0][1]]).strip()
        if front:
            sections.append(ParsedSection("Front matter", front))
        for n, (heading, start) in enumerate(outline):
            end = outline[n + 1][1] if n + 1 < len(outline) else len(pages)
            content = "\n\n".join(pages[start : max(end, start + 1)]).strip()
            if content:
                sections.append(ParsedSection(heading, content))
        return ParsedBook(title, sections)

    lines = "\n\n".join(pages).split("\n")
    split = _split_markdown(lines) or _split_plain(lines)
    if split:
        return ParsedBook(split[0] or title, split[1])
    return ParsedBook(title, [ParsedSection(f"Page {n}", text) for n, text in enumerate(pages, start=1) if text])


def _pdf_outline(reader) -> list[tuple[str, int]]:
    """Top-level bookmarks as (title, start page), descending one level if the top is a single entry."""
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
                starts.append((str(item.title).strip() or f"Page {page + 1}", page))
        return sorted(starts, key=lambda entry: entry[1])
    except Exception:
        return []


def _parse_docx(data: bytes, fallback_title: str) -> ParsedBook:
    from docx import Document

    try:
        document = Document(BytesIO(data))
    except Exception as exc:
        raise BookImportError("This Word document could not be read.") from exc

    lines: list[str] = []
    for paragraph in document.paragraphs:
        text = paragraph.text.strip()
        if not text:
            continue
        style = (paragraph.style.name if paragraph.style is not None else "").lower()
        if style == "title":
            lines.append(f"# {text}")
        elif style.startswith("heading"):
            level = int(match.group()) if (match := re.search(r"\d+", style)) else 1
            lines.append("#" * min(level + 1, 6) + f" {text}")
        elif "list" in style:
            lines.append(f"- {text}")
        else:
            lines.append(text)
        lines.append("")

    core_title = (document.core_properties.title or "").strip()
    return parse_text("\n".join(lines), core_title or fallback_title)


# --- Text helpers ----------------------------------------------------------------


def _decode(data: bytes) -> str:
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
