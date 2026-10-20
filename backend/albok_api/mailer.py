"""Email through the school's SMTP relay. Without ALBOK_SMTP_HOST, messages go to <data_dir>/outbox."""

import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import make_msgid
from pathlib import Path

from .config import settings

log = logging.getLogger(__name__)


def send_mail(to: str, subject: str, body: str, attachments: list[tuple[str, bytes, str]] | None = None) -> None:
    message = EmailMessage()
    message["From"] = settings.mail_from
    message["To"] = to
    message["Subject"] = subject
    message["Message-ID"] = make_msgid(domain="albok")
    message.set_content(body)
    for filename, data, mime in attachments or []:
        maintype, _, subtype = mime.partition("/")
        message.add_attachment(data, maintype=maintype, subtype=subtype, filename=filename)

    if not settings.smtp_host:
        outbox = settings.data_dir / "outbox"
        outbox.mkdir(parents=True, exist_ok=True)
        path = outbox / f"{message['Message-ID'].strip('<>').replace('@', '_')}.eml"
        Path(path).write_bytes(bytes(message))
        log.info("SMTP not configured; wrote %s", path)
        return

    if settings.smtp_security == "ssl":
        server: smtplib.SMTP = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, context=ssl.create_default_context(), timeout=60)
    else:
        server = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=60)
    with server:
        if settings.smtp_security == "starttls":
            server.starttls(context=ssl.create_default_context())
        if settings.smtp_user:
            server.login(settings.smtp_user, settings.smtp_password)
        server.send_message(message)
