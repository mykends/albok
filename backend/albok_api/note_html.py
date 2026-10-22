"""Lesson notes are formatted text: a small, fixed subset of HTML written by the notes editor.

Students get a title, a subtitle, bold/italic/underline, bullet lists and left/centre/right alignment.
Everything else (fonts, sizes, colours, links, images, scripts) is dropped when a note is saved, so the
stored HTML is safe to render. Notes written before formatting existed are plain text and stay plain
text until the student edits them in the new editor.
"""

import html
import re

import nh3

TAGS = {"p", "h1", "h2", "strong", "em", "u", "ul", "ol", "li", "br"}
ALIGNABLE = {"p", "h1", "h2"}
# The editor writes left alignment as no style at all.
_ALIGN_STYLE = re.compile(r"\s*text-align:\s*(center|right)\s*;?\s*", re.IGNORECASE)
# The editor's HTML always starts with a block; an old plain-text note practically never does.
_FORMATTED = re.compile(r"\s*<(p|h1|h2|ul|ol)[\s>]", re.IGNORECASE)


def is_formatted(content: str) -> bool:
    """Whether `content` comes from the notes editor, rather than being an old plain-text note."""
    return bool(_FORMATTED.match(content))


def _alignment_only(tag: str, attribute: str, value: str) -> str | None:
    match = _ALIGN_STYLE.fullmatch(value) if attribute == "style" and tag in ALIGNABLE else None
    return f"text-align: {match.group(1).lower()};" if match else None


def clean_note(content: str) -> str:
    """What is stored: formatted notes reduced to the allowed HTML; plain text exactly as it was."""
    if not is_formatted(content):
        return content
    return nh3.clean(
        content,
        tags=TAGS,
        attributes={tag: {"style"} for tag in ALIGNABLE},
        attribute_filter=_alignment_only,
    )


def note_text(content: str) -> str:
    """The words of a note without formatting, e.g. to tell whether it is empty."""
    if not is_formatted(content):
        return content
    with_breaks = re.sub(r"</(p|h1|h2|li)>|<br\s*/?>", "\n", content, flags=re.IGNORECASE)
    return html.unescape(nh3.clean(with_breaks, tags=set()))


def note_pdf_html(content: str) -> str:
    """A formatted note as HTML for fpdf2, which reads alignment from an `align` attribute and would
    drop empty paragraphs (the student's blank lines)."""
    cleaned = clean_note(content)
    cleaned = re.sub(r'<(p|h1|h2) style="text-align: (center|right);">', r'<\1 align="\2">', cleaned)
    # A list item's paragraph would put the text on a new line after the bullet.
    cleaned = re.sub(r"<li>\s*<p>(.*?)</p>\s*</li>", r"<li>\1</li>", cleaned, flags=re.DOTALL)
    return cleaned.replace("<p></p>", "<p><br></p>")
