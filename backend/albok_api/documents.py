"""Uploaded files: storage, conversion to PDF, section suggestions, and per-section page extraction.

Layout under settings.files_dir:
  books/<book_id>/<file_id>/original.<ext>   the upload as received
  books/<book_id>/<file_id>/document.pdf     what students see (only in section-sized pieces)
  cache/sections/<file_id>/<start>-<end>.pdf
  exports/                                   temporary export PDFs
"""

import logging
import shutil
import subprocess
import tempfile
from pathlib import Path

import httpx
from fastapi import UploadFile
from sqlalchemy.engine import Engine
from sqlmodel import Session, select

from .config import settings
from .importers import (
    BookImportError,
    decode_text,
    docx_headings,
    docx_title,
    fallback_title,
    read_pdf,
    suggest_sections,
)
from .models import Book, BookFile, Section
from .pdfgen import image_to_pdf, text_to_pdf

log = logging.getLogger(__name__)

PDF_EXTENSIONS = {".pdf"}
DOCUMENT_EXTENSIONS = {".docx", ".odt"}
SLIDE_EXTENSIONS = {".pptx", ".odp"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff"}
TEXT_EXTENSIONS = {".md", ".markdown", ".txt"}
SUPPORTED_EXTENSIONS = PDF_EXTENSIONS | DOCUMENT_EXTENSIONS | SLIDE_EXTENSIONS | IMAGE_EXTENSIONS | TEXT_EXTENSIONS
CONVERSION_TIMEOUT = 600
COPY_CHUNK = 1024 * 1024


class UploadTooLarge(Exception):
    pass


def files_root() -> Path:
    return settings.files_dir


def abs_path(relative: str) -> Path:
    return files_root() / relative


def file_dir(book_id: int, file_id: int) -> Path:
    return files_root() / "books" / str(book_id) / str(file_id)


def check_extension(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise BookImportError(
            f"Vrsta datoteke '{ext or filename}' nije podržana. Koristite PDF, Word, PowerPoint, "
            "LibreOffice (ODT, ODP), slike, Markdown ili tekst."
        )
    return ext


def store_upload(upload: UploadFile, destination: Path) -> int:
    """Stream an upload to disk, enforcing the size limit without holding it in memory."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    with destination.open("wb") as out:
        while chunk := upload.file.read(COPY_CHUNK):
            size += len(chunk)
            if size > settings.max_upload_bytes:
                out.close()
                destination.unlink(missing_ok=True)
                raise UploadTooLarge()
            out.write(chunk)
    return size


def store_bytes(data: bytes, destination: Path) -> int:
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)
    return len(data)


def new_file_paths(book_id: int, file_id: int, filename: str) -> tuple[str, Path]:
    ext = Path(filename).suffix.lower() or ".txt"
    relative = f"books/{book_id}/{file_id}/original{ext}"
    return relative, files_root() / relative


# --- Conversion -----------------------------------------------------------------------------


def convert_to_pdf(original: Path, original_filename: str, out: Path) -> None:
    ext = Path(original_filename).suffix.lower()
    if ext in PDF_EXTENSIONS:
        shutil.copyfile(original, out)
    elif ext in IMAGE_EXTENSIONS:
        try:
            image_to_pdf(original, out)
        except Exception as exc:
            raise BookImportError("Slika se ne može pročitati.") from exc
    elif ext in TEXT_EXTENSIONS:
        text_to_pdf(decode_text(original.read_bytes()), fallback_title(original_filename), out)
    else:
        _convert_office(original, original_filename, out)


def _convert_office(original: Path, original_filename: str, out: Path) -> None:
    if settings.converter_url:
        # Gotenberg (LibreOffice headless behind an HTTP API), the `convert` service in Docker Compose.
        try:
            with original.open("rb") as handle, httpx.Client(timeout=CONVERSION_TIMEOUT) as http:
                response = http.post(
                    f"{settings.converter_url}/forms/libreoffice/convert",
                    files={"files": (f"document{Path(original_filename).suffix.lower()}", handle)},
                )
        except httpx.HTTPError as exc:
            raise BookImportError("Usluga za pretvorbu dokumenata nije dostupna. Pokušajte kasnije.") from exc
        if response.status_code != 200:
            raise BookImportError("Dokument se ne može pretvoriti u PDF. Je li datoteka oštećena?")
        out.write_bytes(response.content)
        return

    # Local LibreOffice, for development.
    with tempfile.TemporaryDirectory(prefix="albok-convert-") as work:
        source = Path(work) / f"document{Path(original_filename).suffix.lower()}"
        shutil.copyfile(original, source)
        profile = Path(work) / "profile"
        try:
            subprocess.run(
                [
                    settings.soffice_path,
                    f"-env:UserInstallation={profile.as_uri()}",
                    "--headless",
                    "--convert-to",
                    "pdf",
                    "--outdir",
                    work,
                    str(source),
                ],
                check=True,
                capture_output=True,
                timeout=CONVERSION_TIMEOUT,
            )
        except FileNotFoundError as exc:
            raise BookImportError("LibreOffice nije instaliran na poslužitelju.") from exc
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
            raise BookImportError("Dokument se ne može pretvoriti u PDF. Je li datoteka oštećena?") from exc
        converted = source.with_suffix(".pdf")
        if not converted.exists():
            raise BookImportError("Dokument se ne može pretvoriti u PDF. Je li datoteka oštećena?")
        shutil.move(converted, out)


def process_file(engine: Engine, file_id: int) -> None:
    """Convert an upload and suggest sections. Runs after the upload request has returned.

    For a new book the suggestions become its sections right away (hidden until published). For a
    replacement they wait until the professor confirms how old sections map to new ones."""
    with Session(engine) as session:
        book_file = session.get(BookFile, file_id)
        if book_file is None:
            return
        original = abs_path(book_file.original_path)
        pdf = original.with_name("document.pdf")
        try:
            convert_to_pdf(original, book_file.original_filename, pdf)
            pages, outline, document_title = read_pdf(pdf)
            ext = Path(book_file.original_filename).suffix.lower()
            if ext == ".docx":
                document_title = docx_title(original) or document_title
            suggestions = suggest_sections(
                pages,
                outline,
                fallback_title=fallback_title(book_file.original_filename),
                slides=ext in SLIDE_EXTENSIONS,
                known_headings=docx_headings(original) if ext == ".docx" else None,
            )
        except BookImportError as exc:
            book_file.status, book_file.error = "failed", str(exc)
        except Exception:
            log.exception("Processing file %s failed", file_id)
            book_file.status, book_file.error = "failed", "Datoteka se ne može obraditi."
        else:
            book_file.status, book_file.error = "ready", None
            book_file.pdf_path = str(pdf.relative_to(files_root()))
            book_file.pdf_size = pdf.stat().st_size
            book_file.page_count = len(pages)
            book_file.suggestions = [s.as_dict() for s in suggestions]
            has_sections = session.exec(select(Section.id).where(Section.book_id == book_file.book_id)).first()
            if book_file.state == "current" and not has_sections:
                # Without a title from the professor, prefer the document's own title over the filename.
                book = session.get(Book, book_file.book_id)
                if document_title and book.title_from_file:
                    book.title, book.title_from_file = document_title[:200], False
                    session.add(book)
                session.add_all(
                    Section(
                        book_id=book_file.book_id,
                        position=n,
                        title=s.title,
                        page_start=s.page_start,
                        page_end=s.page_end,
                        extracted_text=s.text,
                    )
                    for n, s in enumerate(suggestions)
                )
        session.add(book_file)
        session.commit()


def delete_file_tree(book_file: BookFile) -> None:
    shutil.rmtree(file_dir(book_file.book_id, book_file.id), ignore_errors=True)
    shutil.rmtree(files_root() / "cache" / "sections" / str(book_file.id), ignore_errors=True)


def delete_book_tree(book_id: int, file_ids: list[int]) -> None:
    shutil.rmtree(files_root() / "books" / str(book_id), ignore_errors=True)
    for file_id in file_ids:
        shutil.rmtree(files_root() / "cache" / "sections" / str(file_id), ignore_errors=True)


# --- Pages ----------------------------------------------------------------------------------


def page_texts(book_file: BookFile, first: int, last: int) -> str:
    pages, _, _ = read_pdf(abs_path(book_file.pdf_path))
    return "\n\n".join(pages[first - 1 : last]).strip()


def section_pdf(book_file: BookFile, page_start: int, page_end: int) -> Path:
    """A PDF with only these pages, so students never receive the rest of the book."""
    from pypdf import PdfReader, PdfWriter

    cached = files_root() / "cache" / "sections" / str(book_file.id) / f"{page_start}-{page_end}.pdf"
    if cached.exists():
        return cached
    cached.parent.mkdir(parents=True, exist_ok=True)
    reader = PdfReader(str(abs_path(book_file.pdf_path)))
    writer = PdfWriter()
    for index in range(page_start - 1, min(page_end, len(reader.pages))):
        writer.add_page(reader.pages[index])
    # Links to pages outside the range would point nowhere; drop them.
    for page in writer.pages:
        if "/Annots" in page:
            del page["/Annots"]
    temporary = cached.with_suffix(".tmp")
    with temporary.open("wb") as out:
        writer.write(out)
    temporary.replace(cached)
    return cached


def append_pages(writer, book_file: BookFile, page_start: int, page_end: int) -> None:
    from pypdf import PdfReader

    reader = PdfReader(str(section_pdf(book_file, page_start, page_end)))
    for page in reader.pages:
        writer.add_page(page)


def disk_usage(path: Path) -> int:
    if not path.exists():
        return 0
    return sum(entry.stat().st_size for entry in path.rglob("*") if entry.is_file())
