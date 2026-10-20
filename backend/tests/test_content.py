from datetime import datetime
from io import BytesIO

from pypdf import PdfReader

from .conftest import publish, upload_text


def titles(book):
    return [s["title"] for s in book["sections"]]


def test_professor_sees_own_subjects_with_classes(horvat, school):
    subjects = horvat.get("/api/professor/subjects").json()
    assert [s["name"] for s in subjects] == ["Povijest"]
    assert [c["name"] for c in subjects[0]["classes"]] == ["3.B"]


def test_upload_suggests_page_range_sections_hidden_by_default(horvat, luka, school):
    book = upload_text(horvat, school.history.id)
    assert titles(book) == ["Uvod", "Industrijska revolucija", "Revolucije 1848.", "Ujedinjenje Italije"]
    assert [(s["page_start"], s["page_end"]) for s in book["sections"]] == [(1, 1), (2, 2), (3, 3), (4, 4)]
    assert all(s["published_class_ids"] == [] for s in book["sections"])
    assert book["exportable"] is False
    # Nothing is visible to students until published.
    assert luka.get("/api/student/now").json()["subjects"][0]["sections"] == []


def test_upload_rejects_unsupported_files(horvat, school):
    response = horvat.post(f"/api/subjects/{school.history.id}/books", files={"file": ("x.exe", b"MZ", "application/octet-stream")})
    assert response.status_code == 422


def test_professor_cannot_manage_another_professors_subject(kovac, school):
    response = kovac.post(f"/api/subjects/{school.history.id}/books/text", json={"title": "x", "text": "y"})
    assert response.status_code == 403
    assert kovac.patch(f"/api/subjects/{school.history.id}", json={"name": "Moje"}).status_code == 403


def test_professor_can_edit_subject_details(horvat, school):
    updated = horvat.patch(f"/api/subjects/{school.history.id}", json={"name": "Povijest 3", "color": "#d97706"}).json()
    assert (updated["name"], updated["timetable_name"], updated["color"]) == ("Povijest 3", "Povijest", "#d97706")


def test_publish_only_to_classes_taught(horvat, school):
    book = upload_text(horvat, school.history.id)
    response = horvat.put(f"/api/sections/{book['sections'][1]['id']}/publications/{school.a1.id}", json={"published": True})
    assert response.status_code == 403


def test_student_reads_only_published_pages(horvat, luka, school, clock):
    book = upload_text(horvat, school.history.id)
    first, second, third = (s["id"] for s in book["sections"][1:])
    publish(horvat, first, school.b3.id)
    publish(horvat, third, school.b3.id)

    clock.set(datetime(2026, 10, 20, 9, 50))  # free period
    subjects = {s["name"]: s for s in luka.get("/api/student/now").json()["subjects"]}
    assert [s["id"] for s in subjects["Povijest"]["sections"]] == [first, third]
    assert subjects["Matematika"]["sections"] == []

    section = luka.get(f"/api/sections/{first}").json()
    assert (section["prev_id"], section["next_id"], section["index"], section["total"]) == (None, third, 0, 2)
    pdf = luka.get(f"/api/sections/{first}/pdf")
    assert pdf.headers["content-type"] == "application/pdf"
    assert "no-store" in pdf.headers["cache-control"]
    reader = PdfReader(BytesIO(pdf.content))
    assert len(reader.pages) == 1
    assert "Parni stroj" in reader.pages[0].extract_text()

    assert luka.get(f"/api/sections/{second}").status_code == 403
    assert luka.get(f"/api/sections/{second}/pdf").status_code == 403
    assert luka.get(f"/api/books/{book['id']}/pdf").status_code == 403

    # Unpublishing takes effect immediately.
    publish(horvat, third, school.b3.id, published=False)
    assert luka.get(f"/api/sections/{third}/pdf").status_code == 403


def test_during_a_lesson_only_its_subject_is_visible(horvat, kovac, luka, school, clock):
    history = upload_text(horvat, school.history.id)
    math = upload_text(kovac, school.math.id, title="Algebra", text="# A\n\n## Jednadžbe\n\nx\n\n## Funkcije\n\ny")
    publish(horvat, history["sections"][1]["id"], school.b3.id)
    publish(kovac, math["sections"][0]["id"], school.b3.id)

    clock.set(datetime(2026, 10, 20, 8, 10))  # Povijest
    now = luka.get("/api/student/now").json()
    assert now["mode"] == "lesson"
    assert now["lesson"]["subject_name"] == "Povijest"
    assert now["lesson"]["title"] == "Povijest · uto 20. 10. 2026."
    assert [s["name"] for s in now["subjects"]] == ["Povijest"]
    assert luka.get(f"/api/sections/{math['sections'][0]['id']}").status_code == 403

    clock.set(datetime(2026, 10, 20, 9, 50))  # free period
    assert luka.get(f"/api/sections/{math['sections'][0]['id']}").status_code == 200


def test_student_preview_shows_what_a_class_sees(horvat, school):
    book = upload_text(horvat, school.history.id)
    publish(horvat, book["sections"][2]["id"], school.b3.id)
    preview = horvat.get(f"/api/professor/preview/{school.b3.id}", params={"subject_id": school.history.id}).json()
    assert [s["title"] for s in preview[0]["sections"]] == ["Revolucije 1848."]
    section = horvat.get(f"/api/sections/{book['sections'][2]['id']}", params={"preview_class_id": school.b3.id}).json()
    assert section["total"] == 1
    # Without preview the professor can open every section of their own subject.
    assert horvat.get(f"/api/sections/{book['sections'][1]['id']}").json()["total"] == 4


def test_bulk_publish_whole_book(horvat, school):
    book = upload_text(horvat, school.history.id)
    book = horvat.put(f"/api/books/{book['id']}/publications/{school.b3.id}", json={"published": True}).json()
    assert all(s["published_class_ids"] == [school.b3.id] for s in book["sections"])
    assert all(s["included_class_ids"] == [school.b3.id] for s in book["sections"])
    book = horvat.put(f"/api/books/{book['id']}/publications/{school.b3.id}", json={"published": False}).json()
    assert all(s["published_class_ids"] == [] for s in book["sections"])


def test_edit_split_merge_reorder_sections(horvat, school):
    book = upload_text(horvat, school.history.id)
    intro, industry, revolutions, italy = (s["id"] for s in book["sections"])

    book = horvat.patch(f"/api/sections/{industry}", json={"title": "Industrija", "page_end": 3}).json()
    assert book["sections"][1]["title"] == "Industrija"
    assert horvat.patch(f"/api/sections/{industry}", json={"page_end": 9}).status_code == 422

    book = horvat.post(f"/api/sections/{industry}/split", json={"at_page": 3, "title": "Drugi dio"}).json()
    assert [(s["title"], s["page_start"], s["page_end"]) for s in book["sections"][1:3]] == [
        ("Industrija", 2, 2),
        ("Drugi dio", 3, 3),
    ]

    book = horvat.post(f"/api/books/{book['id']}/sections/merge", json={"section_ids": [revolutions, italy]}).json()
    assert titles(book) == ["Uvod", "Industrija", "Drugi dio", "Revolucije 1848."]
    assert (book["sections"][3]["page_start"], book["sections"][3]["page_end"]) == (3, 4)

    order = [s["id"] for s in reversed(book["sections"])]
    book = horvat.put(f"/api/books/{book['id']}/sections/order", json={"section_ids": order}).json()
    assert [s["id"] for s in book["sections"]] == order

    book = horvat.delete(f"/api/sections/{intro}").json()
    assert intro not in [s["id"] for s in book["sections"]]
    assert [s["position"] for s in book["sections"]] == [0, 1, 2]


def test_whole_pdf_only_for_the_professor(horvat, kovac, school):
    book = upload_text(horvat, school.history.id)
    assert len(PdfReader(BytesIO(horvat.get(f"/api/books/{book['id']}/pdf").content)).pages) == 4
    assert kovac.get(f"/api/books/{book['id']}/pdf").status_code == 403


def test_export_toggle_and_book_order(horvat, school):
    first = upload_text(horvat, school.history.id, title="Prva")
    second = upload_text(horvat, school.history.id, title="Druga")
    assert horvat.patch(f"/api/books/{first['id']}", json={"exportable": True}).json()["exportable"] is True
    horvat.patch(f"/api/books/{second['id']}", json={"position": 0})
    assert [b["title"] for b in horvat.get(f"/api/subjects/{school.history.id}/books").json()] == ["Druga", "Prva"]


def test_replace_file_keeps_mapped_sections(horvat, luka, school, clock):
    book = upload_text(horvat, school.history.id)
    industry = book["sections"][1]["id"]
    publish(horvat, industry, school.b3.id)

    corrected = "# Povijest 3\n\n## Industrijska revolucija\n\nIspravljeno.\n\n## Novo poglavlje\n\nNovo.\n"
    response = horvat.post(f"/api/books/{book['id']}/replace", files={"file": ("v2.md", corrected.encode(), "text/markdown")})
    assert response.status_code == 202
    proposal = horvat.get(f"/api/books/{book['id']}/replace").json()
    assert [s["title"] for s in proposal["suggestions"]] == ["Industrijska revolucija", "Novo poglavlje"]
    assert proposal["mapping"][str(industry)] == 0

    book = horvat.post(
        f"/api/books/{book['id']}/replace/confirm",
        json={"sections": proposal["suggestions"], "mapping": proposal["mapping"]},
    ).json()
    assert titles(book) == ["Industrijska revolucija", "Novo poglavlje"]
    assert book["sections"][0]["id"] == industry
    assert book["sections"][0]["published_class_ids"] == [school.b3.id]
    assert book["pending_file"] is None and book["file"]["original_filename"] == "v2.md"

    clock.set(datetime(2026, 10, 20, 9, 50))
    pdf = PdfReader(BytesIO(luka.get(f"/api/sections/{industry}/pdf").content))
    assert "Ispravljeno" in pdf.pages[0].extract_text()


def test_presets_set_inclusions_for_a_class(horvat, school):
    book = upload_text(horvat, school.history.id)
    ids = [s["id"] for s in book["sections"]]
    publish(horvat, ids[3], school.b3.id)
    preset = horvat.post(f"/api/subjects/{school.history.id}/presets", json={"year_level": 3, "section_ids": ids[1:3]}).json()
    assert horvat.post(f"/api/subjects/{school.history.id}/presets", json={"year_level": 3}).status_code == 409

    books = horvat.post(f"/api/presets/{preset['id']}/apply/{school.b3.id}").json()
    included = [s["id"] for s in books[0]["sections"] if school.b3.id in s["included_class_ids"]]
    # Preset sections plus the already published one; publishing itself is unchanged.
    assert included == ids[1:4]
    assert [s["id"] for s in books[0]["sections"] if s["published_class_ids"]] == [ids[3]]

    response = horvat.put(f"/api/sections/{ids[3]}/inclusions/{school.b3.id}", json={"included": False})
    assert response.status_code == 409


def test_untitled_upload_takes_the_documents_own_title(horvat, school):
    from .conftest import HISTORY_MD

    def upload(**form):
        response = horvat.post(
            f"/api/subjects/{school.history.id}/books",
            files={"file": ("udzbenik_v2.md", HISTORY_MD.encode(), "text/markdown")},
            data=form,
        )
        assert response.status_code == 202, response.text
        return horvat.get(f"/api/books/{response.json()['id']}").json()["title"]

    assert upload() == "Povijest 3"
    assert upload(title="Moj naslov") == "Moj naslov"
