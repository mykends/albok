"""Which links professors may add as web tools. See docs/adr/0001-web-tools-in-the-kiosk.md.

Only public `https://` pages are accepted. The kiosk shell (desktop/web-tools.js) checks the same rules
again before it shows a tool, so a bad row in the database still can't open.
"""

import re
from urllib.parse import unquote, urlsplit

# Hosts under these suffixes never resolve on the public internet.
INTERNAL_SUFFIXES = (".local", ".lan", ".internal", ".home.arpa", ".localhost", ".test", ".example", ".invalid")
# They redirect to another host, which the kiosk would then block for students.
LINK_SHORTENERS = {"youtu.be", "forms.gle", "bit.ly", "goo.gl", "t.co", "tinyurl.com"}
# Documents, archives and installers: a web tool is a page, not a download.
FILE_EXTENSIONS = {
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "pps", "ppsx", "odt", "ods", "odp", "rtf", "epub", "csv",
    "zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz",
    "exe", "msi", "msix", "appx", "dmg", "pkg", "apk", "bat", "cmd", "ps1", "sh", "jar", "iso", "img", "deb", "rpm", "appimage",
}  # fmt: skip

_HOST_LABEL = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
# WHATWG URL parsing reads a host whose last label is a number (decimal, octal or 0x hex) as IPv4.
_NUMERIC_LABEL = re.compile(r"^(?:[0-9]+|0x[0-9a-f]*)$")
_FORBIDDEN_CHARS = re.compile(r"[\s\\\x00-\x1f\x7f]")


class InvalidLink(ValueError):
    """The message is shown to the professor next to the link field."""


def _host(raw_host: str) -> str:
    host = raw_host.lower().rstrip(".")
    try:
        host = host.encode("idna").decode("ascii")
    except UnicodeError:
        raise InvalidLink("Ovo nije ispravna poveznica.") from None
    return host


def normalize_link(raw: str) -> str:
    """The link as it is stored and opened, or InvalidLink with a reason the professor can act on."""
    link = raw.strip()
    if not link:
        raise InvalidLink("Upišite poveznicu na stranicu.")
    try:
        parts = urlsplit(link)
        port = parts.port
    except ValueError:
        raise InvalidLink("Ovo nije ispravna poveznica.") from None
    if parts.scheme.lower() != "https" or not link.lower().startswith("https://"):
        raise InvalidLink("Poveznica mora počinjati s https://.")
    if "@" in parts.netloc:
        raise InvalidLink("Poveznica ne smije sadržavati korisničko ime ni lozinku.")
    if port not in (None, 443):
        raise InvalidLink("Poveznica ne smije navoditi port. Upišite adresu kakvu vidite u pregledniku.")
    if parts.netloc.startswith("["):
        raise InvalidLink("Upišite adresu stranice, a ne IP adresu.")
    if not parts.hostname:
        raise InvalidLink("Ovo nije ispravna poveznica.")

    host = _host(parts.hostname)
    labels = host.split(".")
    if _NUMERIC_LABEL.match(labels[-1]):
        raise InvalidLink("Upišite adresu stranice, a ne IP adresu.")
    if _FORBIDDEN_CHARS.search(link) or not all(_HOST_LABEL.match(label) for label in labels):
        raise InvalidLink("Ovo nije ispravna poveznica.")
    if len(labels) < 2 or host == "localhost" or any(host.endswith(s) or host == s[1:] for s in INTERNAL_SUFFIXES):
        raise InvalidLink("Ovo je adresa unutar školske mreže. Dopuštene su samo javne stranice.")
    if host.removeprefix("www.") in LINK_SHORTENERS:
        raise InvalidLink("Ovo je skraćena poveznica. Otvorite je i upišite punu adresu stranice koja se prikaže.")
    filename = unquote(parts.path).rsplit("/", 1)[-1].lower()
    if "." in filename and filename.rsplit(".", 1)[-1] in FILE_EXTENSIONS:
        raise InvalidLink("Ovo je poveznica na datoteku. Web alat mora biti stranica; datoteke dodajte kao knjigu.")

    normalized = f"https://{host}{parts.path or '/'}"
    if parts.query:
        normalized += f"?{parts.query}"
    if parts.fragment:
        normalized += f"#{parts.fragment}"
    return normalized
