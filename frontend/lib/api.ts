export type Subject = {
  id: number;
  name: string;
  slug: string;
  description: string;
  color: string;
  icon: string;
  book_count: number;
  section_count: number;
  completed_section_count: number;
  note_count: number;
};

export type SectionSummary = {
  id: number;
  position: number;
  title: string;
  word_count: number;
  completed: boolean;
  last_opened_at: string | null;
};

export type Book = {
  id: number;
  subject_id: number;
  title: string;
  source_filename: string | null;
  created_at: string;
  sections: SectionSummary[];
};

export type Section = SectionSummary & {
  content: string;
  book_id: number;
  book_title: string;
  subject_id: number;
  prev_id: number | null;
  next_id: number | null;
  total_sections: number;
};

export type RecentSection = SectionSummary & {
  book_id: number;
  book_title: string;
  subject_id: number;
};

export type Note = {
  id: number;
  subject_id: number;
  section_id: number | null;
  section_title: string | null;
  title: string;
  content: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
};

export type NoteInput = Partial<Pick<Note, 'title' | 'content' | 'section_id' | 'pinned'>>;

/** A file chosen with expo-document-picker. `file` is only set on web. */
export type PickedFile = { name: string; uri: string; mimeType?: string; file?: File };

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

// The Electron shell injects the backend URL via its preload script.
const API_URL = (
  (globalThis as { albok?: { apiUrl?: string } }).albok?.apiUrl ??
  process.env.EXPO_PUBLIC_API_URL ??
  'http://127.0.0.1:8765'
).replace(/\/$/, '');

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, init);
  } catch {
    throw new ApiError(0, 'Cannot reach the Albok server. Make sure the backend is running.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = typeof body?.detail === 'string' ? body.detail : `Request failed (${response.status})`;
    throw new ApiError(response.status, detail);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

function json(method: 'POST' | 'PATCH', body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export const api = {
  subjects: () => request<Subject[]>('/api/subjects'),

  books: (subjectId: number) => request<Book[]>(`/api/subjects/${subjectId}/books`),

  importBookFile: (subjectId: number, picked: PickedFile, title?: string) => {
    const form = new FormData();
    if (picked.file) {
      form.append('file', picked.file, picked.name);
    } else {
      // React Native's FormData accepts { uri, name, type } descriptors for files.
      form.append('file', { uri: picked.uri, name: picked.name, type: picked.mimeType } as unknown as Blob);
    }
    if (title?.trim()) form.append('title', title.trim());
    return request<Book>(`/api/subjects/${subjectId}/books/import`, { method: 'POST', body: form });
  },

  importBookText: (subjectId: number, title: string, text: string) =>
    request<Book>(`/api/subjects/${subjectId}/books/text`, json('POST', { title, text })),

  deleteBook: (bookId: number) => request<void>(`/api/books/${bookId}`, { method: 'DELETE' }),

  section: (sectionId: number) => request<Section>(`/api/sections/${sectionId}`),

  recentSections: (limit = 5) => request<RecentSection[]>(`/api/sections/recent?limit=${limit}`),

  updateSection: (sectionId: number, patch: { completed: boolean }) =>
    request<SectionSummary>(`/api/sections/${sectionId}`, json('PATCH', patch)),

  notes: (subjectId: number) => request<Note[]>(`/api/subjects/${subjectId}/notes`),

  recentNotes: (limit = 5) => request<Note[]>(`/api/notes/recent?limit=${limit}`),

  createNote: (subjectId: number, input: NoteInput) =>
    request<Note>(`/api/subjects/${subjectId}/notes`, json('POST', input)),

  updateNote: (noteId: number, input: NoteInput) => request<Note>(`/api/notes/${noteId}`, json('PATCH', input)),

  deleteNote: (noteId: number) => request<void>(`/api/notes/${noteId}`, { method: 'DELETE' }),
};

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.';
}
