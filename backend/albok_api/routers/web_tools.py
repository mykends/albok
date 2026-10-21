"""Web tools: professors keep a list on each Subject and open tools live for the lesson they teach;
students in that lesson get them. See docs/adr/0001-web-tools-in-the-kiosk.md."""

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlmodel import Session, delete, select

from ..access import AccessScope, EffectiveLesson, get_or_create_lesson, open_web_tools, teaching_now
from ..auth import require_professor, student_scope
from ..clock import Clock, get_clock
from ..db import get_session
from ..models import Lesson, LessonWebTool, SchoolClass, Subject, User, WebTool
from ..permissions import owned_subject
from ..schemas import (
    LessonToolState,
    StudentWebTool,
    StudentWebTools,
    TeachingLesson,
    WebToolOpenState,
    WebToolRead,
    WebToolUpdate,
    WebToolWrite,
)
from ..web_tools import InvalidLink, normalize_link

router = APIRouter(prefix="/api", tags=["web tools"])


def _checked_link(url: str) -> str:
    try:
        return normalize_link(url)
    except InvalidLink as error:
        raise HTTPException(status_code=422, detail=str(error)) from None


def _subject_tools(session: Session, subject_id: int) -> list[WebTool]:
    return list(session.exec(select(WebTool).where(WebTool.subject_id == subject_id).order_by(WebTool.position, WebTool.id)).all())


def _owned_tool(session: Session, user: User, tool_id: int) -> WebTool:
    tool = session.get(WebTool, tool_id)
    if tool is None:
        raise HTTPException(status_code=404, detail="Web alat ne postoji.")
    owned_subject(session, user, tool.subject_id)
    return tool


def _add_tool(session: Session, subject_id: int, body: WebToolWrite) -> WebTool:
    url = _checked_link(body.url)
    tools = _subject_tools(session, subject_id)
    tool = WebTool(subject_id=subject_id, name=body.name.strip(), url=url, position=len(tools))
    session.add(tool)
    session.flush()
    return tool


# --- The Subject's list --------------------------------------------------------------------------


@router.get("/subjects/{subject_id}/web-tools", response_model=list[WebToolRead])
def list_tools(subject_id: int, user: User = Depends(require_professor), session: Session = Depends(get_session)):
    owned_subject(session, user, subject_id)
    return _subject_tools(session, subject_id)


@router.post("/subjects/{subject_id}/web-tools", response_model=WebToolRead, status_code=201)
def create_tool(
    subject_id: int, body: WebToolWrite, user: User = Depends(require_professor), session: Session = Depends(get_session)
):
    owned_subject(session, user, subject_id)
    tool = _add_tool(session, subject_id, body)
    session.commit()
    session.refresh(tool)
    return tool


@router.patch("/web-tools/{tool_id}", response_model=WebToolRead)
def update_tool(
    tool_id: int, body: WebToolUpdate, user: User = Depends(require_professor), session: Session = Depends(get_session)
):
    tool = _owned_tool(session, user, tool_id)
    changes = body.model_dump(exclude_unset=True)
    if changes.get("name"):
        tool.name = changes["name"].strip()
    if changes.get("url") is not None:
        tool.url = _checked_link(changes["url"])
    if changes.get("position") is not None:
        siblings = [t for t in _subject_tools(session, tool.subject_id) if t.id != tool.id]
        siblings.insert(min(changes["position"], len(siblings)), tool)
        for position, sibling in enumerate(siblings):
            sibling.position = position
            session.add(sibling)
    session.add(tool)
    session.commit()
    session.refresh(tool)
    return tool


@router.delete("/web-tools/{tool_id}", status_code=204)
def delete_tool(tool_id: int, user: User = Depends(require_professor), session: Session = Depends(get_session)):
    """Closes the tool for every lesson it is open in (the lesson links cascade)."""
    session.delete(_owned_tool(session, user, tool_id))
    session.commit()
    return Response(status_code=204)


# --- Opening tools for the lesson being taught --------------------------------------------------


def _teaching_lesson(session: Session, user: User, lesson: Lesson, effective: EffectiveLesson) -> TeachingLesson:
    subject = session.get(Subject, effective.subject_id)
    opened = set(session.exec(select(LessonWebTool.web_tool_id).where(LessonWebTool.lesson_id == lesson.id)).all())
    return TeachingLesson(
        lesson_id=lesson.id,
        date=effective.date,
        starts_at=effective.starts_at,
        ends_at=effective.ends_at,
        class_name=session.get(SchoolClass, effective.class_id).name,
        subject_id=subject.id,
        subject_name=subject.name,
        substitute=effective.substitute,
        can_edit_tools=subject.professor_id == user.id,
        tools=[
            LessonToolState(**tool.model_dump(), open=tool.id in opened)
            for tool in _subject_tools(session, subject.id)
        ],
    )


def _taught_now(session: Session, user: User, lesson_id: int, clock: Clock) -> tuple[Lesson, EffectiveLesson]:
    """The lesson, if the user teaches it and it is running now. Checked again on every change."""
    lesson = session.get(Lesson, lesson_id)
    if lesson is None:
        raise HTTPException(status_code=404, detail="Sat ne postoji.")
    for effective in teaching_now(session, user, clock.now()):
        if lesson.slot_id is not None and effective.slot_id == lesson.slot_id and effective.date == lesson.date:
            return lesson, effective
    raise HTTPException(status_code=403, detail="Web alate možete otvoriti samo tijekom sata koji predajete.")


@router.get("/professor/now", response_model=list[TeachingLesson])
def teaching(user: User = Depends(require_professor), session: Session = Depends(get_session), clock: Clock = Depends(get_clock)):
    """The lessons the professor is teaching right now; usually one, two at a handover."""
    lessons = [(get_or_create_lesson(session, effective), effective) for effective in teaching_now(session, user, clock.now())]
    session.commit()
    return [_teaching_lesson(session, user, lesson, effective) for lesson, effective in lessons]


@router.put("/lessons/{lesson_id}/web-tools/{tool_id}", response_model=TeachingLesson)
def set_tool_open(
    lesson_id: int,
    tool_id: int,
    body: WebToolOpenState,
    user: User = Depends(require_professor),
    session: Session = Depends(get_session),
    clock: Clock = Depends(get_clock),
):
    lesson, effective = _taught_now(session, user, lesson_id, clock)
    tool = session.get(WebTool, tool_id)
    if tool is None:
        raise HTTPException(status_code=404, detail="Web alat ne postoji.")
    if tool.subject_id != effective.subject_id:
        raise HTTPException(status_code=422, detail="Ovaj web alat ne pripada predmetu ovog sata.")
    if not body.open:
        session.exec(delete(LessonWebTool).where(LessonWebTool.lesson_id == lesson.id, LessonWebTool.web_tool_id == tool.id))
    elif session.get(LessonWebTool, (lesson.id, tool.id)) is None:
        session.add(LessonWebTool(lesson_id=lesson.id, web_tool_id=tool.id))
    session.commit()
    return _teaching_lesson(session, user, lesson, effective)


@router.post("/lessons/{lesson_id}/web-tools", response_model=TeachingLesson, status_code=201)
def add_and_open(
    lesson_id: int,
    body: WebToolWrite,
    user: User = Depends(require_professor),
    session: Session = Depends(get_session),
    clock: Clock = Depends(get_clock),
):
    """Adds a tool to the lesson's Subject and opens it. Only the Subject's owner may add to its list."""
    lesson, effective = _taught_now(session, user, lesson_id, clock)
    if session.get(Subject, effective.subject_id).professor_id != user.id:
        raise HTTPException(status_code=403, detail="Na popis web alata drugog nastavnika ne možete dodavati.")
    tool = _add_tool(session, effective.subject_id, body)
    session.add(LessonWebTool(lesson_id=lesson.id, web_tool_id=tool.id))
    session.commit()
    return _teaching_lesson(session, user, lesson, effective)


# --- Students ------------------------------------------------------------------------------------


@router.get("/student/web-tools", response_model=StudentWebTools, tags=["student"])
def student_tools(
    scope: AccessScope = Depends(student_scope),
    session: Session = Depends(get_session),
    clock: Clock = Depends(get_clock),
):
    """Polled every few seconds during a lesson (as a passive request), so it stays a small query."""
    now = clock.now()
    lesson, tools = open_web_tools(session, scope)
    return StudentWebTools(
        lesson_id=lesson.id if lesson else None,
        lesson_ends_at=scope.lesson.window(now.tzinfo)[1] if scope.lesson else None,
        server_time=now,
        tools=[StudentWebTool(id=tool.id, name=tool.name, url=tool.url) for tool in tools],
    )
