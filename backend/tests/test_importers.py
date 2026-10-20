from io import BytesIO

import pytest
from docx import Document

from albok_api.importers import BookImportError, parse_book, parse_text


def make_pdf(pages: list[str]) -> bytes:
    """Build a minimal text PDF (one line per page) without extra dependencies."""
    objects = ["<< /Type /Catalog /Pages 2 0 R >>", ""]
    kids = []
    for text in pages:
        page_id, content_id = len(objects) + 1, len(objects) + 2
        kids.append(f"{page_id} 0 R")
        stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET"
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {content_id} 0 R "
            f"/Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>"
        )
        objects.append(f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream")
    objects[1] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(kids)} >>"

    out = BytesIO(b"%PDF-1.4\n")
    offsets = []
    for n, body in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(f"{n} 0 obj\n{body}\nendobj\n".encode())
    xref = out.tell()
    out.write(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for offset in offsets:
        out.write(f"{offset:010d} 00000 n \n".encode())
    out.write(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode())
    return out.getvalue()


def test_markdown_uses_lone_h1_as_title_and_splits_on_repeated_level():
    text = "# Algebra\n\nWelcome.\n\n## Equations\n\nSolve for x.\n\n### Example\n\n2x = 4\n\n## Inequalities\n\nx > 1"
    book = parse_text(text, "fallback")
    assert book.title == "Algebra"
    assert [s.title for s in book.sections] == ["Introduction", "Equations", "Inequalities"]
    assert "### Example" in book.sections[1].content


def test_plain_text_chapter_headings():
    text = "Chapter 1: Cells\nCells are small.\n\nChapter 2: Tissues\nTissues are groups of cells."
    book = parse_text(text, "Biology")
    assert [s.title for s in book.sections] == ["Chapter 1: Cells", "Chapter 2: Tissues"]


def test_numbered_list_items_are_not_headings():
    text = "Steps to follow:\n1. Mix the solution\n2. Heat it gently\n3. Record the result"
    book = parse_text(text, "Lab")
    assert len(book.sections) == 1
    assert book.sections[0].title == "Lab"


def test_long_text_without_headings_is_chunked():
    paragraph = " ".join(["word"] * 400)
    book = parse_text("\n\n".join([paragraph] * 4), "Reader")
    assert [s.title for s in book.sections] == ["Part 1", "Part 2"]


def test_docx_heading_styles_become_sections():
    document = Document()
    document.add_heading("World History", level=0)
    document.add_heading("Ancient Egypt", level=1)
    document.add_paragraph("The Nile shaped Egyptian life.")
    document.add_heading("Ancient Rome", level=1)
    document.add_paragraph("Rome grew from a city-state.")
    buffer = BytesIO()
    document.save(buffer)

    book = parse_book("history.docx", buffer.getvalue())
    assert book.title == "World History"
    assert [s.title for s in book.sections] == ["Ancient Egypt", "Ancient Rome"]


def test_pdf_without_outline_or_headings_splits_per_page():
    book = parse_book("my_physics-notes.pdf", make_pdf(["Velocity is speed with direction", "Force equals mass times acceleration"]))
    assert book.title == "my physics notes"
    assert [s.title for s in book.sections] == ["Page 1", "Page 2"]
    assert "Force equals" in book.sections[1].content


def test_pdf_chapter_headings_are_detected():
    book = parse_book("p.pdf", make_pdf(["Chapter 1 Motion", "Moving things move", "Chapter 2 Energy", "Energy is conserved"]))
    assert [s.title for s in book.sections] == ["Chapter 1 Motion", "Chapter 2 Energy"]


@pytest.mark.parametrize(
    ("filename", "data", "message"),
    [
        ("slides.pptx", b"x", "Unsupported file type"),
        ("broken.pdf", b"not a pdf", "could not be read"),
        ("empty.txt", b"   \n\n ", "No readable text"),
    ],
)
def test_bad_files_raise_readable_errors(filename, data, message):
    with pytest.raises(BookImportError, match=message):
        parse_book(filename, data)


def test_windows_1250_text_is_decoded():
    book = parse_book("hr.txt", "Učenici čitaju štivo.".encode("cp1250"))
    assert "Učenici čitaju štivo." in book.sections[0].content
