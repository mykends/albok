from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from ..access import AccessScope
from ..auth import require_student, student_scope
from ..clock import Clock, get_clock
from ..db import get_session
from ..exports import export_subjects, run_export
from ..models import ExportLog, User
from ..schemas import ExportAccepted, ExportQuota, ExportRequest

router = APIRouter(prefix="/api/exports", tags=["student"])


def _used_today(session: Session, user: User, clock: Clock) -> set[str]:
    return set(session.exec(select(ExportLog.kind).where(ExportLog.student_id == user.id, ExportLog.date == clock.today())).all())


@router.get("/quota", response_model=ExportQuota)
def quota(user: User = Depends(require_student), session: Session = Depends(get_session), clock: Clock = Depends(get_clock)):
    used = _used_today(session, user, clock)
    return ExportQuota(email=user.email, subject_available="subject" not in used, all_available="all" not in used)


@router.post("", response_model=ExportAccepted, status_code=202)
def create_export(
    body: ExportRequest,
    request: Request,
    background: BackgroundTasks,
    user: User = Depends(require_student),
    scope: AccessScope = Depends(student_scope),
    session: Session = Depends(get_session),
    clock: Clock = Depends(get_clock),
):
    """Each day a student can send one single-subject and one all-subjects export."""
    if scope.lesson:
        raise HTTPException(status_code=409, detail="Izvoz je dostupan izvan nastavnih sati.")
    if not user.email:
        raise HTTPException(status_code=409, detail="Vaš račun nema adresu e-pošte.")
    what = "jednog predmeta" if body.kind == "subject" else "svih predmeta"
    limit_reached = HTTPException(status_code=429, detail=f"Danas ste već poslali izvoz {what}. Pokušajte sutra.")
    if body.kind in _used_today(session, user, clock):
        raise limit_reached
    if body.kind == "subject":
        allowed = {s.id for s in export_subjects(session, user, scope.class_ids)}
        if body.subject_id not in allowed:
            raise HTTPException(status_code=422, detail="Odaberite jedan od svojih predmeta.")
    entry = ExportLog(
        student_id=user.id, date=clock.today(), kind=body.kind, subject_id=body.subject_id if body.kind == "subject" else None
    )
    session.add(entry)
    try:
        session.commit()
    except IntegrityError:
        raise limit_reached
    background.add_task(run_export, request.app.state.engine, clock, entry.id)
    return ExportAccepted(email=user.email)
