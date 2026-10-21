# Installing Albok at a school

For the school's IT staff and the Albok administrator. Albok runs as a Docker Compose stack on one Linux server; student PCs run a small kiosk app that shows it.

## What you need

| | |
| --- | --- |
| **Server** | Linux with Docker Engine and the Compose plugin. 4 CPU cores, 8 GB RAM (document conversion runs LibreOffice), **at least 100 GB** of disk for uploads. |
| **Address** | A subdomain such as `albok.skola.hr` pointing at the server, with ports **80 and 443 open to the internet** (professors work from home, and AAI@EduHr requires HTTPS with a valid certificate). |
| **Certificate** | Automatic from Let's Encrypt, or one the school provides (see step 3). |
| **Email** | Credentials for the school's SMTP relay. Students' exports and reminders are sent through it. |
| **AAI@EduHr** | A registered resource (step 1) and a published GDPR privacy policy. |
| **Student PCs** | Windows 10/11 with Assigned Access (kiosk mode) configured through Intune or Group Policy. |

If the developer can reach the server, the school and the developer need a data-processing agreement.

## 1. Register Albok with AAI@EduHr

The school registers the resource at [registar.aaiedu.hr](https://registar.aaiedu.hr) as the home institution, with the developer as technical contact.

- **Protocol:** OpenID Connect, confidential client.
- **Redirect URI:** `https://albok.skola.hr/auth/callback`
- **Post-logout redirect URI:** `https://albok.skola.hr/login`
- **Start as a Test resource** against AAI@EduHr Lab. Switch to production after the first successful test sign-ins.
- **Requested scopes and their purposes** (the registry asks for a purpose for each; do **not** request `hrEduPersonOIB`):

| Scope | Purpose (suggested wording) |
| --- | --- |
| `openid` | Prijava korisnika. |
| `profile` | Prikaz imena korisnika u aplikaciji. |
| `email` | Slanje izvoza bilješki i obavijesti na školsku adresu e-pošte. |
| `hrEduPersonPrimaryAffiliation` | Provjera je li korisnik učenik ili djelatnik škole. |
| `hrEduPersonStaffCategory` | Provjera pripada li djelatnik nastavnom osoblju. |
| `hrEduPersonHomeOrg`, `o` | Provjera pripada li korisnik ovoj školi. |

The registry gives you the issuer URL, client ID and client secret for step 3. Certification is renewed every year and needs HTTPS with a valid certificate, the published privacy policy, a stated purpose for each attribute, and the AAI@EduHr logo next to the login button.

> **Logo:** the sign-in screen currently shows a text badge "AAI@EduHr" in place of the logo. Replace it with the official logo file from Srce (in `frontend/app/login.tsx`) before certification.

## 2. Copy the deployment files

On the server, copy the repository's `deploy/` folder (for example to `/opt/albok`) and create the configuration:

```bash
cd /opt/albok
cp .env.example .env
openssl rand -hex 32   # use one value for POSTGRES_PASSWORD, another for ALBOK_SESSION_SECRET
nano .env
```

Fill in at least `ALBOK_DOMAIN`, `POSTGRES_PASSWORD`, `ALBOK_SESSION_SECRET`, `ALBOK_ADMINS` (the AAI username of the first administrator), the `ALBOK_OIDC_*` values from the registry, `ALBOK_PRIVACY_URL` and the SMTP settings.

`ALBOK_SCHOOL_ORG` restricts sign-in to users whose `o` or `hrEduPersonHomeOrg` matches. For skole.hr accounts this value may be the shared realm `skole.hr` rather than the school; sign in once with AAI@EduHr Lab, check the value, and only then set it. Users must also be on the imported roster, so leaving it empty is safe.

## 3. Start it

```bash
docker compose pull
docker compose up -d
docker compose ps          # all services "Up"; db "healthy"
curl https://albok.skola.hr/api/health
```

With the default setup Caddy gets a Let's Encrypt certificate automatically. To use the school's certificate instead, put the files in `certs/` and create `caddy/extra/tls.caddy` containing:

```
tls /certs/fullchain.pem /certs/privkey.pem
```

| Service | Role |
| --- | --- |
| `web` | Caddy: HTTPS, the web UI, and the proxy to `api`. The only service with open ports. |
| `api` | Albok server. Runs the daily job (reminders, year-end deletion) itself. |
| `db` | PostgreSQL. |
| `convert` | LibreOffice (Gotenberg) for Word, PowerPoint, ODT and ODP uploads. |
| `backup` | Nightly backup (step 6). |

## 4. Set up the school year

Sign in as the administrator from `ALBOK_ADMINS` and work through **Administracija**:

1. **Školska godina:** start and end of teaching, the time the school day ends (students are signed out then), the deletion date (default 31 August), and non-teaching days. If the timetable uses A/B weeks, set a day in an A week.
2. **Uvoz podataka → Popis učenika i nastavnika:** a CSV with one row per person. Choose the file to see a preview; nothing changes until you click **Primijeni**, and nothing can be applied while the file has errors.

   ```
   korisnik;ime i prezime;uloga;razred;godina
   ana.horvat@skole.hr;Ana Horvat;učenik;3.B;3
   ivan.kovac@skole.hr;Ivan Kovač;profesor;;
   ```

   Headers can also be in English (`username;name;role;class;year_level`); `,` `;` and tab all work, as do UTF-8 and Windows-1250 files saved from Excel.
3. **Uvoz podataka → Raspored sati:** one row per lesson. `tjedan` is `A`, `B` or empty. Importing again replaces the timetable but keeps unchanged lessons (and their per-date changes).

   ```
   dan;početak;kraj;tjedan;razred;predmet;nastavnik
   pon;08:00;08:45;;3.B;Povijest;ivan.kovac@skole.hr
   ```

   Each professor gets one subject per subject name, shared across their classes.
4. **Korisnici i uloge:** grant the professor or administrator role, or deactivate accounts.

Only people on the roster (and the `ALBOK_ADMINS`) can sign in.

## 5. Student PCs

1. Build the installer on Windows with `npm run setup && npm run dist:win` (or use a released one) and deploy `Albok Setup <version>.exe` per machine.
2. Create `C:\ProgramData\Albok\config.json`:

   ```json
   { "url": "https://albok.skola.hr", "kiosk": true }
   ```

   If AAI@EduHr Lab or a future login page uses another address than `https://login.aaiedu.hr`, list it: `"authOrigins": ["https://login.aaiedu.hr", "https://..."]`.
3. Configure **Windows Assigned Access** (kiosk mode) through Intune or Group Policy: a kiosk account that signs in automatically at startup and runs only Albok. Albok then opens on its sign-in screen.

The kiosk app shows the Albok and AAI@EduHr addresses and, during a lesson, the web tools the lesson's professor has opened (below). It blocks all other navigation, new windows, downloads and printing, has no quit control, and keeps cookies in memory only. When a student signs out (or after 10 idle minutes, or at the end of the school day) it wipes the session and also signs them out of AAI@EduHr, so the next student can't be signed in as the previous one.

### Web tools

Professors can name external sites on their subject, such as an online dictionary or a flash-card set, and open them live for the lesson they are teaching. Students in that lesson see each one as a tab next to the material. The reasons for this design are in [the decision record](adr/0001-web-tools-in-the-kiosk.md); these are the limits to check before signing off:

- **Only what the professor opened, only during the lesson.** A tool appears for the students of one lesson while it runs. It closes for everyone when the lesson ends (the kiosk closes it by its own clock even if the server is unreachable), within about five seconds of the professor closing it or deleting it, and never carries over to the next lesson. A substitute can open the covered lesson's tools; nobody can open tools ahead of time.
- **Same site only.** A tool starts at the professor's `https://` link, and the student can move anywhere on that link's host and its subdomains (a leading `www.` is ignored), nowhere else. A link to another site, a pop-up and a third-party sign-in such as "Sign in with Google" show "not allowed in this lesson" instead of opening. A Google Translate tool can't reach Google search or sign-in.
- **Only public pages can be added.** Albok refuses links that aren't `https://`, IP addresses, school-internal names (`.local`, `.lan` and similar), link shorteners and links to files. The kiosk checks the same rules again before showing a tool.
- **No downloads, printing, pop-up windows, camera or microphone** inside tools. Tools run in their own in-memory session, wiped at every sign-out like the Albok session.
- **Nothing recorded.** Albok stores which tools were opened for which lesson, never what a student did in them. The school's privacy policy may need to say that students can reach professor-chosen third-party sites during lessons.
- **The school's network filtering still applies** to everything a tool loads; Albok doesn't replace it.

Web tools need the kiosk installer from this release or later. A PC with an older installer shows no web tools at all; outside the kiosk (an ordinary browser, or the app with `"kiosk": false`) students see the lesson's tools as plain links.

Professors can use the same installer with `"kiosk": false` or any browser.

## 6. Backups

The `backup` service writes `albok-YYYY-MM-DD.dump` (database) and `albok-files-YYYY-MM-DD.tar.gz` (uploads) to `BACKUP_DIR` every night at `BACKUP_HOUR` and keeps them `BACKUP_KEEP_DAYS` days (14). Copy that folder to another location regularly.

Run a backup now and **test a restore once before go-live**:

```bash
docker compose exec backup sh /backup/backup.sh now
sh backup/restore.sh 2026-10-20      # stops api and web, restores, starts again
```

## 7. Updating

Set `ALBOK_VERSION` in `.env` to the new version, then:

```bash
docker compose pull && docker compose up -d
```

Student PCs only need a new installer when the kiosk app itself changes; the UI comes from the server. Web tools were such a change (see step 5).

## 8. During and after the school year

- 30 and 7 days before the deletion date, students get an email reminding them to export their notes.
- On the deletion date Albok deletes students' notes, per-class publishing, classes, rosters, the timetable, the record of which web tools were opened in which lesson, and student accounts. Professors' subjects, books, sections, presets and web tools stay.
- Next year: add the new school year, import the new roster and timetable; professors apply their presets to the new classes.

## Troubleshooting

| Problem | Where to look |
| --- | --- |
| Sign-in fails | `docker compose logs api`. The sign-in screen shows why a user was refused (not on the roster, deactivated, other school). |
| Uploads stay "processing" or fail | `docker compose logs convert api`. Scanned PDFs work without OCR; password-protected PDFs don't. |
| Emails don't arrive | `docker compose logs api`; check the `ALBOK_SMTP_*` settings. |
| Disk filling up | Administracija → Prostor na disku. |

## Open questions with external parties

These don't block installation but may change login settings. Ask Srce (aai@srce.hr):

1. Is `prompt=login` / `max_age=0` supported? If not, set `ALBOK_OIDC_PROMPT=` (empty); the kiosk's session wipe and the AAI@EduHr sign-out at every Albok sign-out still protect shared PCs.
2. What do `o` and `hrEduPersonHomeOrg` contain for skole.hr accounts? (Decides `ALBOK_SCHOOL_ORG`.)
3. Is `hrEduPersonGroupMember` filled in for school users?

Ask CARNET (helpdesk@skole.hr) whether there is any official data access to e-Matica or e-Dnevnik. Until then, the roster and timetable come from CSV files.
