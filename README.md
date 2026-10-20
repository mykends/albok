# Albok

A Windows desktop app for students. You import a book (or part of one) into a subject, follow it section by section during class, and keep notes organised by subject.

Albok starts with five subjects: Mathematics, Physics, Chemistry, Biology and History.

## Stack

| Part | Tech |
| --- | --- |
| `frontend/` | Expo (React Native + expo-router) running as a web app, styled with NativeWind (Tailwind CSS). The UI components are [React Native Reusables](https://reactnativereusables.com), a port of shadcn/ui. State lives in zustand. |
| `backend/` | Python with FastAPI, SQLModel and SQLite. It parses imported PDF, DOCX, TXT and Markdown files into sections. |
| `desktop/` | Electron shell. It starts the backend, serves the exported web app and is packaged as a Windows installer. |

```
frontend/
  app/                     screens (expo-router): dashboard, subjects/[id], sections/[id] (class reader)
  components/              app components; components/ui/ holds the shadcn-style primitives
  stores/                  zustand stores: subjects, books/sections, notes, preferences (persisted)
  lib/api.ts               typed API client
backend/
  albok_api/importers.py   turns files into sections
  albok_api/routers/       REST endpoints
  tests/                   pytest suite
  samples/                 a sample book you can import
desktop/main.js            Electron main process
scripts/                   cross-platform setup/run/build helpers
```

## Getting started

Prerequisites:

- **Node.js 24**. The repo has an `.nvmrc`, so `nvm use` picks the right version.
- **Python 3.11+**.

```bash
npm install         # root helpers (concurrently, wait-on)
npm run setup       # Python venv + backend packages, frontend and desktop npm packages
```

Run it:

```bash
npm run dev           # backend + app in your browser (http://localhost:8081)
npm run desktop:dev   # backend + app in an Electron window, with hot reload
npm run desktop       # production web build in Electron (no hot reload)
npm test              # backend tests + frontend typecheck
```

To try it out, open **Mathematics → Import book** and pick `backend/samples/algebra-basics.md`.

## Building the Windows installer

Run this **on Windows**. PyInstaller can only build executables for the OS it runs on.

```powershell
npm run setup
npm run dist:win
```

The installer is written to `desktop/release/Albok Setup <version>.exe`. The build does three things:

1. Exports the Expo web app to `frontend/dist`.
2. Bundles the backend into `backend/dist/albok-backend/albok-backend.exe` with PyInstaller.
3. Packages both into an NSIS installer with electron-builder.

The installed app keeps its database in `%APPDATA%\Albok\data\albok.db`. In development the database is at `backend/data/albok.db`.

## How importing works

The backend splits a file into sections, trying these methods from most to least structured:

1. **PDF bookmarks** or **Word heading styles** (Heading 1, Heading 2, …).
2. **Headings in the text**: Markdown `#`/`##`, or lines like `Chapter 3`, `Lesson 2: …`, `2.1 Linear equations`.
3. **Fallback**: one section per PDF page, or chunks of about 600 words for plain text.

You can also paste text instead of uploading a file. Scanned PDFs without selectable text need OCR first.

## The class reader

- Use ← / → (or the buttons at the bottom) to move between sections.
- Mark a section as done to track progress per book and per subject.
- Change the text size with the A↓ / A↑ buttons. The size is remembered.
- Notes taken in the side panel are linked to the section. The first line becomes the note's title.

## Adding shadcn-style components

```bash
cd frontend
npx @react-native-reusables/cli@latest add select checkbox   # any component from reactnativereusables.com
```

## API

The backend runs on `http://127.0.0.1:8765`. Interactive docs are at `/docs` while it's running.

| Method | Path | |
| --- | --- | --- |
| GET | `/api/subjects` | subjects with book, section and note counts |
| GET | `/api/subjects/{id}/books` | books with their section lists |
| POST | `/api/subjects/{id}/books/import` | multipart `file` (+ optional `title`) |
| POST | `/api/subjects/{id}/books/text` | `{ title, text }` |
| DELETE | `/api/books/{id}` | deletes the book; its notes are kept but unlinked |
| GET | `/api/sections/{id}` | section content + prev/next ids; also records it as recently opened |
| PATCH | `/api/sections/{id}` | `{ completed }` |
| GET | `/api/sections/recent`, `/api/notes/recent` | dashboard feeds |
| GET / POST | `/api/subjects/{id}/notes` | list (`?q=`, `?section_id=`) / create |
| PATCH / DELETE | `/api/notes/{id}` | edit / delete |

## Configuration

These backend environment variables are optional:

| Variable | Default |
| --- | --- |
| `ALBOK_PORT` | `8765` |
| `ALBOK_DATA_DIR` | `backend/data` |
| `ALBOK_CORS_ORIGINS` | the Expo dev server and `app://albok` |

The frontend reads `EXPO_PUBLIC_API_URL` if you need to point it at a different backend.
