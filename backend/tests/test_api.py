import pytest
from fastapi.testclient import TestClient

from albok_api.main import create_app

SAMPLE_MD = b"# Algebra\n\n## Equations\n\nSolve 2x = 4.\n\n## Inequalities\n\nSolve x > 1.\n\n## Functions\n\nf(x) = x + 1"


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(f"sqlite:///{tmp_path / 'test.db'}")) as test_client:
        yield test_client


def import_sample(client, subject_id=1):
    response = client.post(
        f"/api/subjects/{subject_id}/books/import", files={"file": ("algebra.md", SAMPLE_MD, "text/markdown")}
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_starts_with_five_subjects(client):
    subjects = client.get("/api/subjects").json()
    assert [s["name"] for s in subjects] == ["Mathematics", "Physics", "Chemistry", "Biology", "History"]
    assert all(s["book_count"] == 0 and s["note_count"] == 0 for s in subjects)


def test_import_and_follow_sections(client):
    book = import_sample(client)
    assert book["title"] == "Algebra"
    assert [s["title"] for s in book["sections"]] == ["Equations", "Inequalities", "Functions"]

    first, middle, last = (s["id"] for s in book["sections"])
    section = client.get(f"/api/sections/{middle}").json()
    assert (section["prev_id"], section["next_id"], section["total_sections"]) == (first, last, 3)
    assert section["content"] == "Solve x > 1."
    assert section["last_opened_at"].endswith("Z")

    client.patch(f"/api/sections/{first}", json={"completed": True})
    subject = client.get("/api/subjects/1").json()
    assert (subject["book_count"], subject["section_count"], subject["completed_section_count"]) == (1, 3, 1)

    recent = client.get("/api/sections/recent").json()
    assert [r["id"] for r in recent] == [middle]
    assert client.get("/api/subjects/1/books").json()[0]["id"] == book["id"]


def test_import_pasted_text_uses_given_title(client):
    response = client.post("/api/subjects/5/books/text", json={"title": "WW1 handout", "text": "The war began in 1914."})
    assert response.status_code == 201
    assert response.json()["title"] == "WW1 handout"
    assert response.json()["sections"][0]["title"] == "WW1 handout"


def test_import_rejects_unsupported_files(client):
    response = client.post("/api/subjects/1/books/import", files={"file": ("a.exe", b"MZ", "application/octet-stream")})
    assert response.status_code == 422
    assert "Unsupported file type" in response.json()["detail"]


def test_unknown_subject_is_404(client):
    assert client.get("/api/subjects/99").status_code == 404
    assert client.get("/api/subjects/99/notes").status_code == 404


def test_notes_crud_search_and_pinning(client):
    section_id = import_sample(client)["sections"][0]["id"]

    created = client.post(
        "/api/subjects/1/notes", json={"title": "Linear", "content": "Isolate x first", "section_id": section_id}
    )
    assert created.status_code == 201
    note = created.json()
    assert note["section_title"] == "Equations"
    client.post("/api/subjects/1/notes", json={"title": "Homework", "content": "Page 12, tasks 1-5"})

    titles = lambda **params: [n["title"] for n in client.get("/api/subjects/1/notes", params=params).json()]
    assert titles(q="isolate") == ["Linear"]
    assert titles(q="100%") == []
    assert titles(section_id=section_id) == ["Linear"]

    client.patch(f"/api/notes/{note['id']}", json={"pinned": True})
    assert titles() == ["Linear", "Homework"]

    unlinked = client.patch(f"/api/notes/{note['id']}", json={"section_id": None}).json()
    assert unlinked["section_id"] is None and unlinked["title"] == "Linear"

    assert client.delete(f"/api/notes/{note['id']}").status_code == 204
    assert titles() == ["Homework"]
    assert client.get("/api/subjects/1").json()["note_count"] == 1


def test_note_cannot_link_section_from_another_subject(client):
    section_id = import_sample(client, subject_id=1)["sections"][0]["id"]
    response = client.post("/api/subjects/2/notes", json={"title": "x", "section_id": section_id})
    assert response.status_code == 422


def test_deleting_book_keeps_notes_but_unlinks_them(client):
    book = import_sample(client)
    section_id = book["sections"][0]["id"]
    note = client.post("/api/subjects/1/notes", json={"title": "Keep me", "section_id": section_id}).json()

    assert client.delete(f"/api/books/{book['id']}").status_code == 204
    assert client.get(f"/api/sections/{section_id}").status_code == 404
    notes = client.get("/api/subjects/1/notes").json()
    assert [(n["id"], n["section_id"]) for n in notes] == [(note["id"], None)]
