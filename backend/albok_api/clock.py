"""Server time. Every time-dependent decision goes through a Clock so tests (and ALBOK_FAKE_NOW) can move it."""

from collections.abc import Callable
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import Request

WEEKDAYS_SHORT = ["pon", "uto", "sri", "čet", "pet", "sub", "ned"]


class Clock:
    def __init__(self, tz: ZoneInfo, source: Callable[[], datetime] | None = None):
        self.tz = tz
        self._source = source or (lambda: datetime.now(timezone.utc))

    def now(self) -> datetime:
        """Aware local time in the school's timezone."""
        return self._source().astimezone(self.tz)

    def today(self) -> date:
        return self.now().date()

    @classmethod
    def offset_to(cls, tz: ZoneInfo, local_iso: str) -> "Clock":
        """A running clock that started at `local_iso` (school time) when the process started."""
        start = datetime.fromisoformat(local_iso).replace(tzinfo=tz)
        offset = start - datetime.now(timezone.utc)
        return cls(tz, lambda: datetime.now(timezone.utc) + offset)

    @classmethod
    def fixed(cls, tz: ZoneInfo, local: datetime) -> "Clock":
        """For tests: always returns `local` (naive values are school time). Change it with `set`."""
        clock = cls(tz)
        clock.set(local)
        return clock

    def set(self, local: datetime) -> None:
        moment = local if local.tzinfo else local.replace(tzinfo=self.tz)
        self._source = lambda: moment


def get_clock(request: Request) -> Clock:
    return request.app.state.clock


def format_lesson_date(day: date) -> str:
    """"uto 21. 10. 2026." -- the Croatian short form used in note titles."""
    return f"{WEEKDAYS_SHORT[day.weekday()]} {day.day}. {day.month}. {day.year}."
