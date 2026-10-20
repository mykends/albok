# Albok

Albok is a school-wide class companion for one school. Professors upload material and publish it, section by section, to the classes they teach. Students sign in on locked-down school PCs with AAI@EduHr, read what is published for the lesson they are in right now, and keep one note per lesson.

The design is in [docs/specs/professor-student-roles.md](docs/specs/professor-student-roles.md). School IT installs and runs it with [docs/deployment.md](docs/deployment.md).

## How it fits together

```
School PCs: Electron kiosk shell ──┐      Professors: browser or the same app (windowed)
                                   ▼      ▼
                    https://albok.<school>.hr   (Caddy: TLS, static web UI, /api and /auth → api)
                                   │
          api  FastAPI: OIDC login, roles, access rules, conversion, PDF export, mail, daily jobs
          db   PostgreSQL          convert  Gotenberg (LibreOffice headless)      backup  nightly
```

| Part | Tech |
| --- | --- |
| `backend/` | Python, FastAPI, SQLModel. PostgreSQL in production, SQLite for development and tests. pypdf, fpdf2 and LibreOffice (through Gotenberg) for PDFs. |
| `frontend/` | Expo (React Native + expo-router) exported as a web app, NativeWind, [React Native Reusables](https://reactnativereusables.com), zustand, i18next (Croatian only for now), pdf.js. |
| `desktop/` | Electron kiosk shell that only shows the server's web UI. |
| `deploy/` | Docker Compose stack, Caddyfile, backup and restore scripts. |

```
backend/albok_api/
  access.py        access_at(): THE place that decides what a student sees right now (time rule, calendar, overrides)
  auth.py          sessions (HTTP-only cookie), idle/end-of-day sign-out, roles, login rules
  oidc.py          OpenID Connect client for AAI@EduHr;  mock_oidc.py: stand-in provider for development
  documents.py     uploads → PDF, section suggestions, per-section page extraction
  importers.py     page-range suggestions from bookmarks and headings
  school_csv.py    roster and timetable CSV import (dry run first)
  exports.py       notebook + material PDF emailed to the student
  jobs.py          30/7-day reminder emails and the year-end deletion
  routers/         auth, student, reader, exports, content (professor), admin
frontend/
  app/             screens: login, index (role home), read/[sectionId], notes, subjects/[id], books/[id], admin
  components/      professor/, admin/, pdf-viewer, lesson-note-editor, session-watch, ui/ (shadcn-style primitives)
  lib/note-sync.ts offline-first lesson notes
  locales/hr.json  every UI string
```

## Getting started

Prerequisites: **Node.js 24** (`nvm use`), **Python 3.11+**, and LibreOffice if you want to try Word/PowerPoint uploads locally (`soffice` on the PATH).

```bash
npm install         # root helpers
npm run setup       # Python venv + backend packages, frontend and desktop npm packages
npm run dev         # API on :8765 (mock login, demo data) + web app on http://localhost:8081
npm test            # backend tests + frontend typecheck
```

`npm run dev` starts the API with `ALBOK_MOCK_OIDC=1`. The sign-in button leads to a page where you pick a seeded user: an admin, two professors (Ivana Horvat, Marko Kovač), three students in 3.B and 1.A, and one user who is not on the roster. The first start seeds a school year, a timetable (Mon–Fri, 08:00–13:55) and two published books.

Lessons only exist during school hours. To try the lesson view at any time, set a starting time for the server clock:

```bash
ALBOK_FAKE_NOW=2026-10-20T09:45 npm run dev    # a Tuesday during 3.B's Povijest lesson
```

Delete `backend/data/` to start over.

`npm run desktop:dev` runs the same thing inside the kiosk shell in a normal window.

### Tests

```bash
npm test                                                     # SQLite
ALBOK_TEST_DATABASE_URL=postgresql+psycopg://user:pw@localhost/albok_test npm test   # PostgreSQL (drops all tables first)
```

The Word conversion test is skipped when LibreOffice isn't installed.

## Rules worth knowing before changing code

- **Students' visibility is decided only in `access_at(user, now)`** (`backend/albok_api/access.py`). It uses server time, never the PC clock. During a lesson (5 minutes before the bell until it ends) a student sees only that subject's published sections and notes; outside lessons, everything published to their classes. A future exam mode belongs there too.
- **Students only ever receive the pages of a published section** (`GET /api/sections/{id}/pdf`). The whole PDF is professor-only.
- **Restructuring never deletes notes.** Merge moves note links, split keeps them on the first part, delete removes only the link, unpublish keeps the link but makes it unavailable. Lessons copy their class, subject and times so re-importing a timetable can't delete notes either.
- **Notes are offline-first.** Every keystroke is stored on the device and synced every few seconds; the local copy is cleared when the server confirms, and wiped at every sign-out.
- Professors never see students' notes.

## API

Interactive docs are at `http://localhost:8765/docs` in development.

| Area | Endpoints |
| --- | --- |
| Auth | `GET /auth/login`, `GET /auth/callback`, `POST /auth/logout` (returns the AAI end-session URL), `GET /api/me`, `GET /api/public` |
| Student | `GET /api/student/now`, `GET /api/student/notes`, `GET`/`PUT /api/lessons/{id}/note`, `POST /api/lessons/current/sections/{id}/opened`, `GET /api/exports/quota`, `POST /api/exports` |
| Reader | `GET /api/sections/{id}`, `GET /api/sections/{id}/pdf` (`?preview_class_id=` for professors) |
| Professor | `GET /api/professor/subjects`, `GET`/`PATCH /api/subjects/{id}`, books (`/api/subjects/{id}/books`, `/books/text`, `/api/books/{id}`, `/pdf`, `/original`, `/replace`, `/replace/confirm`), sections (`POST /api/books/{id}/sections`, `PATCH`/`DELETE /api/sections/{id}`, `/split`, `/sections/merge`, `/sections/order`), publishing (`PUT /api/sections/{id}/publications/{class_id}`, `PUT /api/books/{id}/publications/{class_id}`, `PUT /api/sections/{id}/inclusions/{class_id}`), presets (`/api/subjects/{id}/presets`, `/api/presets/{id}`, `POST /api/presets/{id}/apply/{class_id}`), `GET /api/professor/preview/{class_id}` |
| Admin | `/api/admin/years` (+ `/days`), `/classes`, `/roster/import`, `/timetable/import` (`?dry_run=true` by default), `/slots`, `/overrides`, `/subjects`, `/users`, `/storage` |

## Configuration

All settings are environment variables; see [`backend/albok_api/config.py`](backend/albok_api/config.py) and [`deploy/.env.example`](deploy/.env.example). The ones you need in development:

| Variable | Default | |
| --- | --- | --- |
| `ALBOK_MOCK_OIDC` | off (`npm run backend` turns it on) | built-in mock AAI@EduHr provider |
| `ALBOK_FAKE_NOW` | – | server clock starts at this local time and keeps running |
| `ALBOK_DATABASE_URL` | SQLite in `backend/data/` | |
| `ALBOK_CONVERTER_URL` | – (uses local `soffice`) | Gotenberg URL |
| `ALBOK_SMTP_HOST` | – (emails go to `backend/data/outbox/*.eml`) | |
| `EXPO_PUBLIC_API_URL` | `frontend/.env.development` | empty in production (same origin) |

## Building

- **Server images:** `npm run docker:build`. Tagging `v1.2.3` on GitHub publishes `albok-api` and `albok-web` to GHCR (`.github/workflows/ci.yml`).
- **Kiosk installer:** `npm run dist:win` on Windows writes `desktop/release/Albok Setup <version>.exe`. It contains only the shell; IT sets the server address in `%ProgramData%\Albok\config.json` (see [docs/deployment.md](docs/deployment.md)).

## Fonts

PDFs made by the server use Noto Sans (`backend/albok_api/fonts/`, SIL Open Font License, see `OFL.txt`) so Croatian letters render everywhere.
