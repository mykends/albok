# Spec: professor and student roles

Status: implemented (v1) · 2026-10-20. Decisions made during implementation are listed at the end.

## Summary

Albok becomes a school-wide system for one school (to start). Professors upload and publish material for their classes. Students sign in on locked-down school PCs with their AAI@EduHr account, read the material for the class they are in right now, and keep one note per lesson. The app moves from a single-user desktop app to a central server with a thin desktop client.

## Why this is a rewrite of the data layer

Today every install is isolated. Each one runs its own backend on `127.0.0.1` with its own SQLite file (`backend/albok_api/config.py`, `desktop/main.js`). There are no users, no ownership and no roles. `Subject`, `Book`, `Section` and `Note` have no owner fields, and `completed` / `last_opened_at` sit on the shared `Section` row (`backend/albok_api/models.py`). Students can only be restricted to professor-provided content if content and permissions live on a server, so:

- the backend moves to a central server, and auth plus ownership are added to every table;
- section content changes from extracted text to page ranges of a PDF;
- notes move from sections to lessons.

## Roles

| Role | Who | Can |
| --- | --- | --- |
| Student | AAI@EduHr `hrEduPersonPrimaryAffiliation = učenik` and in the roster | Read published content (subject to the time rule), write lesson notes, export by email |
| Professor | `djelatnik` with `hrEduPersonStaffCategory = nastavno osoblje`, or granted by an admin | Manage books and sections in their own subjects, publish per class, manage presets, toggle export per book. No time restrictions |
| Admin | 1–2 people (IT or timetable coordinator). The first admin is set by AAI username in server config | Import and edit roster and timetable, calendar, overrides, grant or revoke roles, deactivate accounts, view disk usage |

Admin is a set of permissions shown as extra screens in the professor UI, not a separate app. There is no self-study mode.

A user can only log in if their institution attribute matches this school **and** they appear in the imported roster.

## Architecture

```
School PCs (Windows kiosk)            Professors (app or any browser)
  Electron kiosk shell  ──┐               │
                          ▼               ▼
              https://albok.<school>.hr  (reverse proxy, TLS)
                          │
        Docker Compose on a school-owned Linux server
        ├─ api        FastAPI: auth, permissions, importer, PDF export, mail
        ├─ web        exported Expo web UI (static)
        ├─ db         PostgreSQL
        ├─ convert    LibreOffice headless (DOCX/PPTX/ODT/ODP → PDF)
        └─ backup     nightly pg_dump + files volume
                          │
              login.aaiedu.hr (OIDC)   school SMTP relay
```

- **Server.** It is reachable from the internet over HTTPS on a school subdomain, so professors can work from home and AAI@EduHr certification is satisfied. You publish versioned images, and IT updates them with `docker compose pull && docker compose up -d`.
- **Desktop client.** The Electron app becomes a minimal kiosk shell that loads `https://albok.<school>.hr`. It allows only that origin, blocks navigation and new windows, and shows no quit control in student mode. The UI ships with the server image, so PCs only need a redeploy when the shell itself changes. The PyInstaller backend and the bundled web export are removed from the installer.
- **Kiosk lockdown** is done by IT with Windows Assigned Access (kiosk mode) via Intune or Group Policy, not by Albok. A kiosk account logs in automatically at Windows startup and Albok opens on the sign-in screen.
- **Database.** PostgreSQL. SQLModel stays; the main change is the connection string, plus removing SQLite-specific code.
- **Files.** Uploaded originals, converted PDFs and generated exports live on a Docker volume. Ask IT for at least 100 GB.
- **Backups.** Nightly `pg_dump` plus the files volume, kept 14 days, copied to a location IT chooses. A documented restore command is tested once before go-live.
- **Language.** The UI is in Croatian only at launch, with all strings in translation files (e.g. i18next). Dates and times use `hr-HR` formats and weeks start on Monday.

## Authentication (AAI@EduHr)

- **Protocol.** OpenID Connect with the **backend as a confidential client**. The client secret stays on the server and the redirect URI is `https://albok.<school>.hr/auth/callback`. The kiosk shell and professors' browsers go through the same flow, and the session is an HTTP-only cookie on the Albok origin.
- **Registration.** The school registers the resource at registar.aaiedu.hr as the home institution, with the developer as technical contact. Development and testing start as a **Test** resource against AAI@EduHr Lab.
- **Requested scopes.** `openid profile email hrEduPersonPrimaryAffiliation hrEduPersonStaffCategory hrEduPersonHomeOrg o`. Each one needs a stated purpose in the registry. Do **not** request `hrEduPersonOIB`.
- **Identity.** Users are keyed on `sub` (= `hrEduPersonPersistentID`). Roster rows are matched to accounts on first login by `preferred_username` (= `hrEduPersonUniqueID`, e.g. `ime.prezime@skole.hr`). `mail` becomes the export address.
- **Shared kiosk PCs.**
  - Run the login in a non-persistent session partition that is wiped at sign-out.
  - Send `prompt=login` (or `max_age=0`).
  - At sign-out, call AAI@EduHr's `end_session_endpoint` as well.

  AAI@EduHr's SSO session lasts 8 hours, so without these steps the next student could be signed in as the previous one.
- **Sign-out triggers.** The student signs out, 10 minutes pass with no activity, or the school day ends (a time in the school calendar). There is no sign-out between classes.
- **Certification requirements** (annual): HTTPS with a valid certificate, a published GDPR privacy policy, a stated purpose for each attribute, and the AAI@EduHr logo next to the login button.
- **Local development.** A mock OIDC provider with seeded users for each role, so the app runs without AAI@EduHr Lab.

## School data

None of this comes from AAI@EduHr: no class, subject or timetable attributes are available, and e-Matica and e-Dnevnik have no API. Albok owns it, and the admin maintains it.

- **Roster import (CSV).** One row per student: AAI username, name, class (e.g. `3.B`), year level. Professors are listed by AAI username.
- **Timetable import (CSV).** One row per slot: weekday, start, end, A/B week (optional), class, subject name, professor username.
- **Manual editing** of everything in the admin screens. aSc Timetables XML import is out of scope for v1.
- **Teaching assignments.** The timetable import creates `(professor, subject name, class)` assignments. A professor gets **one subject per subject name**, shared across all their classes. The professor can edit the subject's name, description, colour and books, but cannot create subjects that aren't on the timetable.
- **Calendar.** School-year start and end, non-teaching days, the daily end-of-school-day time, and the year-end deletion date (default 31 August).
- **Per-date overrides.** Cancel a lesson, or change the professor or subject for one date. A substitute professor gets access only for that slot.
- The five hard-coded subjects are removed.

## Content

### Formats

Professors can upload PDF, DOCX, PPTX, ODT, ODP, images, or Markdown/pasted text, up to **300 MB per file** (currently 50 MB in `config.py`). The server keeps the original and converts everything to a PDF, which is the only thing students see:

- PDF is kept as is (scanned PDFs work without OCR);
- office formats go through LibreOffice headless;
- images become one-page PDFs;
- Markdown and text are rendered to PDF.

The professor sees each upload's total size, and the admin sees total disk usage. There is no per-professor quota in v1.

### Sections

- **A section is a page range** of a book's PDF, e.g. "2.1 Linear equations = pages 14–19". The importer logic in `backend/albok_api/importers.py` (bookmarks, Word headings, `Chapter 3`-style lines) is reused to *suggest* page ranges instead of producing text. A slide deck defaults to the whole deck as one section.
- **Editing.** Professors adjust boundaries, rename, split, merge and reorder sections. They never edit the material itself.
- **Hidden text.** Extracted text is stored per section for future search and for heading detection. It is never shown to students.
- **Replacing a file** (e.g. a corrected edition). Sections are re-suggested, and the professor confirms how the old sections map to the new ones.

### Publishing

- **Per section, per class.** A bulk "publish whole book" action publishes everything for a class.
- **Manual toggles only**, with no scheduling.
- **Edits go live** immediately.
- **New imports start hidden.**
- **Student preview.** A toggle shows the professor what a chosen class sees.

### Presets

- A preset belongs to a subject and a **year level** (e.g. "3rd year"). It lists which sections that year level covers.
- Applying a preset to a class (one click) sets which sections are *included* for it. The professor still publishes the included sections over the year. After that, the class can be edited on its own.
- Presets survive the year-end reset.

### Export permission

A per-book toggle "students may export this content", **off by default**.

## Student experience

### Time rule

Visibility uses **server time**, never the PC clock.

| When | Content (left pane) | Notes |
| --- | --- | --- |
| During a lesson: 5 min before the bell until the lesson ends | Published sections of the current subject only | That subject's notes, including past lessons. New text goes into this lesson's note |
| Outside lessons: breaks, free periods, after the last class until sign-out | All sections published to the student's classes, read-only | All notes, editable |

All checks go through one function, e.g. `access_at(user, now) -> AccessScope`. The function also applies the calendar and per-date overrides. A future per-lesson exam or quiet mode will plug in here, so it must stay the only place where this decision is made.

### Reader

- **Layout.** A split screen: the section on the left, the lesson note on the right (the current class reader layout).
- **PDF viewer.** Pages are rendered in the app with pdf.js, not Chromium's built-in viewer, so there are no download or print controls. The API sends **only the pages of the published section**, never the whole file, so hidden chapters can't be pulled out.
- **Controls.** The A↓ / A↑ buttons become zoom, which is remembered on the device. ← / → move between sections of the current subject. Students can browse freely among published sections, and the professor does not lead the class.
- **Removed for students:** import, any editing, mark-as-done, the "recently opened" feed.

### Notes

- **One note per lesson.** A lesson is a real class session: a timetable slot on a date. The title is automatic, e.g. "Povijest · uto 21. 10. 2026." (History · Tue 21 Oct 2026). Notes can only be created during a lesson; outside lessons, students can edit existing ones. There are no free-standing notes, no pinning, and the first line no longer becomes the title.
- **Section links.** Every section the student had open during the lesson is linked to that lesson's note automatically.
- **Saving.** Each keystroke is saved to the device immediately and synced to the server in the background every few seconds. The local copy is cleared once the server confirms it. All pending writes are flushed before any sign-out (manual, idle or end of day). This survives network outages and crashes, and leaves no unsynced notes on a shared PC.
- **Privacy.** Only the student can read their notes. Professors and admins have no view of them. The privacy policy states that server administrators have technical access.
- **Professor restructuring never deletes a note.** A note keeps its lesson; only the section links change:
  - **merge:** links move to the merged section;
  - **split:** links stay with the first part;
  - **delete:** the link is removed and the note remains;
  - **unpublish:** the link stays, but the student can't open the section.

### Export by email

- **What can be exported.** A PDF of one subject, or of all subjects (one chapter per subject).
- **Limits.** Each day, a student can send one single-subject export and one all-subjects export.
- **Contents:**
  1. **Notebook.** Lessons in date order. Each shows the date, the titles of the linked sections and the note text.
  2. **Material.** The pages of every published section, in book order, **only for books with export enabled**. A section from a book without export appears only as its title in the notebook.
- **Delivery.** The PDF is generated on the server and sent to the student's school address (`mail` from login) through the school's SMTP relay, which is configured in the Compose environment.

## School-year lifecycle

On the deletion date (default 31 August, set by the admin), the following happens.

**Deleted:**
- student notes;
- per-class publish state;
- classes, rosters, enrollments and the timetable for that year;
- student accounts.

**Kept:**
- professors' subjects, books, sections and presets.

**Warnings.** Students get an email 30 days and 7 days before the deletion date, reminding them to export.

**Next year.** The admin imports the new roster and timetable, and professors apply their presets to the new classes.

## Data model (sketch)

New or changed tables. Every row is scoped to a school year where it says so.

| Table | Key fields |
| --- | --- |
| `User` | `sub` (unique), `username`, `display_name`, `email`, `is_student`, `is_professor`, `is_admin`, `active` |
| `SchoolYear` | `start`, `end`, `deletion_date`, `day_end_time` |
| `CalendarDay` | `school_year_id`, `date`, `kind` (non-teaching) |
| `SchoolClass` | `school_year_id`, `name` (`3.B`), `year_level` |
| `Enrollment` | `student_id`, `class_id` |
| `Subject` | `professor_id`, `name`, `description`, `color`, `icon` (persists across years) |
| `TeachingAssignment` | `school_year_id`, `subject_id`, `class_id` |
| `TimetableSlot` | `assignment_id`, `weekday`, `start`, `end`, `week` (`A`/`B`/null) |
| `LessonOverride` | `slot_id`, `date`, `cancelled`, `substitute_professor_id`, `substitute_subject_id` |
| `Lesson` | `slot_id`, `date` (created when the first note for it is written) |
| `Book` | `subject_id`, `title`, `original_path`, `pdf_path`, `page_count`, `exportable` (default false) |
| `Section` | `book_id`, `position`, `title`, `page_start`, `page_end`, `extracted_text` (drops `content`, `word_count`, `completed`, `last_opened_at`) |
| `Inclusion` | `section_id`, `class_id` (from a preset or set by hand) |
| `Publication` | `section_id`, `class_id`, `published_at` |
| `Preset` / `PresetSection` | `subject_id`, `year_level` / `preset_id`, `section_id` |
| `Note` | `student_id`, `lesson_id` (unique pair), `content`, `updated_at` |
| `NoteSection` | `note_id`, `section_id` |
| `ExportLog` | `student_id`, `date`, `kind` (`subject` / `all`), `subject_id` |

There is no migration of existing local SQLite data.

## API changes (outline)

- **Auth:** `GET /auth/login`, `GET /auth/callback`, `POST /auth/logout`, `GET /api/me` (roles and the current `AccessScope`).
- **Student:**
  - `GET /api/student/now` (current lesson or none, and visible subjects);
  - `GET /api/sections/{id}/pdf` (the section's pages only, permission-checked);
  - `PUT /api/lessons/{id}/note`;
  - `POST /api/lessons/current/sections/{id}/opened`;
  - `POST /api/exports`.
- **Professor:**
  - book upload and replace;
  - section range editing;
  - `PUT /api/sections/{id}/publications/{class_id}`, plus bulk per book;
  - preset CRUD and `POST /api/presets/{id}/apply/{class_id}`;
  - `PATCH /api/books/{id}` (`exportable`).
- **Admin:**
  - roster and timetable CSV import with a dry-run preview;
  - CRUD for classes, slots, calendar and overrides;
  - role grants;
  - account deactivation;
  - disk usage.

Every endpoint checks the role and, for students, `access_at(user, now)`. The current unauthenticated endpoints in `backend/albok_api/routers/` are replaced.

## Out of scope for v1

| Item | Note |
| --- | --- |
| Exam or quiet mode per lesson | `access_at` is built so this can be added later |
| Professor-led "follow along" | Would need real-time push |
| Student progress reporting to professors | — |
| Highlighting or annotation on PDFs | — |
| Free-standing revision notes outside lessons | — |
| aSc Timetables XML import | — |
| Scheduled publishing | — |
| Multi-school deployment | — |

## Open questions for external parties

These don't block the design, but they can change login details. Ask Srce (aai@srce.hr):

1. Is `prompt=login` / `max_age` supported? If not, the wiped session partition alone still protects shared PCs.
2. What do `o` and `hrEduPersonHomeOrg` contain for skole.hr accounts? This may be the shared realm `skole.hr`. A test login in AAI@EduHr Lab answers it.
3. Is `hrEduPersonGroupMember` filled in for school users?

Ask CARNET (helpdesk@skole.hr):

4. Is there any official data access to e-Matica or e-Dnevnik? Plan as if the answer is no.

## Organisational prerequisites

- **Server.** The school provides a Linux server with Docker, a subdomain and a TLS certificate, and opens HTTPS to the internet.
- **Kiosk setup.** IT configures Windows Assigned Access on student PCs.
- **AAI@EduHr registration.** The school registers the resource and publishes a GDPR privacy policy.
- **Data-processing agreement** between the school and the developer, if the developer has access to the server.
- **SMTP.** The school provides relay credentials.

## Implementation notes (v1)

Where the spec was silent, implementation chose the following. Each can be changed.

**Sign-in and sessions**

- Sessions are stored on the server; the cookie holds a random token and the database only its hash.
- Students: 10 minutes idle (the server allows one extra minute so the final note flush is accepted) and the end of the school day. A student who signs in after the school day has ended only has the idle limit.
- Professors and admins: 2 hours idle, 12 hours at most (`ALBOK_STAFF_IDLE_MINUTES`, `ALBOK_STAFF_SESSION_HOURS`).
- Roles come from the roster and from admin grants. The AAI@EduHr affiliation must not contradict the roster: a roster student must be `učenik`, a roster professor `djelatnik`. Admins skip that check.
- An admin who is not a professor lands on the admin screens.

**Lessons and notes**

- A `Lesson` row is created when the lesson starts (the first time a student in that class checks the current lesson). It copies class, subject and times from the slot, so re-importing the timetable never deletes notes.
- Opening a section during a lesson creates the student's (empty) note for that lesson if needed, so the link is kept even before any text is written.
- A note for one of today's lessons can still be created after the bell. This lets text typed offline during the lesson sync later.
- During a lesson, earlier notes of the same subject are shown read-only. Only the current lesson's note is editable.
- Exports are only available outside lessons.

**Publishing**

- Publishing a section also includes it in the class's plan. A published section can't be removed from the plan until it is hidden. Applying a preset keeps already published sections included.
- "Publish whole book" publishes every section, regardless of the plan.
- Splitting a section copies its publications and plan membership to the new second part. Note links stay with the first part.
- A substitute professor can open the covered subject and publish to the covered class, but only during that slot.

**Content**

- Without headings, a file of up to 20 pages becomes one section; longer files become 10-page parts.
- Pasted text and Markdown are rendered so that each section starts on a new page.
- Without a title from the professor, a book takes the document's own title (PDF metadata, Word Title style or a lone Markdown H1), then the filename.
- If an export with material is larger than 20 MB, it is sent without material and the email says so.
- An admin can't delete a class whose students have notes; those classes are removed at year end.

**Infrastructure**

- `convert` is [Gotenberg](https://gotenberg.dev) (LibreOffice headless behind an HTTP API). Without it, the API calls a local `soffice`.
- `web` is Caddy. It serves the UI, terminates TLS (Let's Encrypt or the school's certificate) and proxies `/api` and `/auth`.
- The database schema is created on start (`create_all`). Add a migration tool (e.g. Alembic) before the first schema change in production.

**Open items**

- The sign-in button shows a text badge instead of the official AAI@EduHr logo, which has to come from Srce.
- The kiosk shell's window behaviour (sign-out wipe, blocked navigation, no quit) has not been tested on Windows yet.
