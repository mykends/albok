"""PDFs made by the server: pasted text / Markdown, images, and the students' exported notebook.

Uses the bundled Noto Sans fonts (SIL OFL, see fonts/OFL.txt) so Croatian letters render everywhere.
"""

import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import markdown as md
from fpdf import FPDF, FontFace

from .clock import format_lesson_date
from .importers import MD_HEADING, _heading_level

FONTS = Path(__file__).resolve().parent / "fonts"
FAMILY = "NotoSans"
MONO = "NotoSansMono"
CODE_STYLES = {"code": FontFace(family=MONO), "pre": FontFace(family=MONO)}


def _pdf(title: str = "") -> FPDF:
    pdf = FPDF(format="A4")
    pdf.add_font(FAMILY, "", FONTS / "NotoSans-Regular.ttf")
    pdf.add_font(FAMILY, "B", FONTS / "NotoSans-Bold.ttf")
    pdf.add_font(FAMILY, "I", FONTS / "NotoSans-Italic.ttf")
    pdf.add_font(FAMILY, "BI", FONTS / "NotoSans-BoldItalic.ttf")
    pdf.add_font(MONO, "", FONTS / "NotoSansMono-Regular.ttf")
    pdf.set_font(FAMILY, size=11)
    pdf.set_margins(20, 18, 20)
    pdf.set_auto_page_break(True, margin=18)
    pdf.set_creator("Albok")
    if title:
        pdf.set_title(title)
    return pdf


# --- Text and Markdown -----------------------------------------------------------------------


def text_to_pdf(text: str, title: str, out: Path) -> None:
    """Render Markdown (or plain text with "Poglavlje 3" / "2.1 Naslov" style headings) to a PDF.
    Each heading becomes a bookmark, so the section suggester can find it."""
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    blocks = _heading_blocks(lines)
    # A lone top-level Markdown heading is the document's title.
    level_one = [heading for level, heading, _ in blocks if level == 1]
    pdf = _pdf(level_one[0] if len(level_one) == 1 and any(MD_HEADING.match(l.strip()) for l in lines) else title)
    pdf.add_page()
    levels = [level for level, _, _ in blocks if level]
    min_level = min(levels, default=1)
    # Sections are page ranges, so each section-level heading (the shallowest that repeats) starts a page.
    repeated = [level for level in sorted(set(levels)) if levels.count(level) >= 2]
    split_level = repeated[0] if repeated else min_level
    previous_level = -1
    page_has_body = False
    for level, heading, body in blocks:
        if heading:
            # A title-only first page stays with the first section instead of becoming one.
            if level <= split_level and page_has_body:
                pdf.add_page()
                page_has_body = False
            outline_level = min(level - min_level, previous_level + 1)
            previous_level = outline_level
            pdf.start_section(heading, level=outline_level)
            size = {0: 18, 1: 15}.get(outline_level, 13)
            pdf.set_font(FAMILY, "B", size)
            pdf.multi_cell(0, size * 0.55, heading, new_x="LMARGIN", new_y="NEXT")
            pdf.ln(2)
            pdf.set_font(FAMILY, size=11)
        if body.strip():
            html = md.markdown(body, extensions=["tables", "fenced_code", "sane_lists"])
            pdf.write_html(html, font_family=FAMILY, tag_styles=CODE_STYLES)
            pdf.ln(3)
            page_has_body = True
    pdf.output(str(out))


def _heading_blocks(lines: list[str]) -> list[tuple[int, str, str]]:
    """[(level, heading, body markdown)]; level 0 / heading "" for text before the first heading."""
    has_markdown = any(MD_HEADING.match(line) for line in lines)
    blocks: list[tuple[int, str, list[str]]] = [(0, "", [])]
    in_code = False
    previous = ""
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("```"):
            in_code = not in_code
        level = 0
        if not in_code and stripped:
            if match := MD_HEADING.match(stripped):
                level, stripped = len(match.group(1)), match.group(2).strip()
            elif not has_markdown:
                level = _heading_level(stripped, previous)
        if level:
            blocks.append((level, stripped, []))
        else:
            blocks[-1][2].append(line)
        previous = line.strip() if line.strip() else previous
    return [(level, heading, "\n".join(body)) for level, heading, body in blocks if heading or "\n".join(body).strip()]


# --- Images ---------------------------------------------------------------------------------


def image_to_pdf(image_path: Path, out: Path) -> None:
    """One page sized to the image (A4 width), embedding it without re-encoding where possible."""
    from PIL import Image

    with Image.open(image_path) as image:
        width, height = image.size
        needs_conversion = image.format not in ("JPEG", "PNG")
        if needs_conversion:
            converted = image_path.with_suffix(".png")
            image.convert("RGBA" if image.mode in ("RGBA", "LA", "P") else "RGB").save(converted, "PNG")
            image_path = converted
    page_width = 210.0
    page_height = page_width * height / width
    pdf = FPDF(unit="mm", format=(page_width, page_height))
    pdf.set_auto_page_break(False)
    pdf.add_page()
    pdf.image(str(image_path), x=0, y=0, w=page_width, h=page_height)
    pdf.output(str(out))


# --- Exported notebook ------------------------------------------------------------------------


@dataclass
class NotebookLesson:
    date: date
    section_titles: list[str]
    content: str


@dataclass
class NotebookSubject:
    name: str
    lessons: list[NotebookLesson] = field(default_factory=list)


def notebook_pdf(student_name: str, subjects: list[NotebookSubject], out: Path, generated_on: date) -> None:
    pdf = _pdf(f"Bilježnica – {student_name}")
    pdf.add_page()
    pdf.set_font(FAMILY, "B", 22)
    pdf.multi_cell(0, 11, "Bilježnica", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font(FAMILY, size=12)
    pdf.multi_cell(0, 7, student_name, new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(110)
    pdf.multi_cell(0, 6, f"Izvezeno {format_lesson_date(generated_on)}", new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(0)

    for subject in subjects:
        pdf.add_page()
        pdf.start_section(subject.name, level=0)
        pdf.set_font(FAMILY, "B", 18)
        pdf.multi_cell(0, 9, subject.name, new_x="LMARGIN", new_y="NEXT")
        pdf.ln(3)
        if not subject.lessons:
            pdf.set_font(FAMILY, "I", 11)
            pdf.multi_cell(0, 6, "Nema bilješki.", new_x="LMARGIN", new_y="NEXT")
        for lesson in subject.lessons:
            pdf.set_font(FAMILY, "B", 12)
            pdf.multi_cell(0, 7, f"{subject.name} · {format_lesson_date(lesson.date)}", new_x="LMARGIN", new_y="NEXT")
            if lesson.section_titles:
                pdf.set_font(FAMILY, "I", 10)
                pdf.set_text_color(90)
                pdf.multi_cell(0, 5.5, "Gradivo: " + ", ".join(lesson.section_titles), new_x="LMARGIN", new_y="NEXT")
                pdf.set_text_color(0)
            pdf.set_font(FAMILY, size=11)
            content = _printable(lesson.content.strip())
            if content:
                pdf.ln(1)
                pdf.multi_cell(0, 6, content, new_x="LMARGIN", new_y="NEXT")
            pdf.ln(5)
    pdf.output(str(out))


def _printable(text: str) -> str:
    # Drop control characters (other than newlines/tabs) that fonts can't draw.
    return re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", text).replace("\t", "    ")
