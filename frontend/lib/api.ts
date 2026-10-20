// Typed client for the Albok API. Types mirror backend/albok_api/schemas.py.

export type Mode = 'lesson' | 'free' | 'staff';

export type LessonRef = {
  slot_id: number;
  date: string;
  class_id: number;
  subject_id: number;
  starts_at: string;
  ends_at: string;
};

export type Me = {
  id: number;
  username: string;
  display_name: string;
  email: string | null;
  is_student: boolean;
  is_professor: boolean;
  is_admin: boolean;
  class_names: string[];
  server_time: string;
  idle_minutes: number;
  session_expires_at: string | null;
  scope: { mode: Mode; lesson: LessonRef | null; day_ends_at: string | null };
};

export type SubjectInfo = { id: number; name: string; description: string; color: string; icon: string };
export type ClassRef = { id: number; name: string; year_level: number };

// --- Student ---

export type SectionRef = { id: number; title: string; book_id: number; book_title: string; page_count: number };
export type StudentSubject = SubjectInfo & { professor_name: string; sections: SectionRef[] };

export type CurrentLesson = {
  id: number;
  date: string;
  starts_at: string;
  ends_at: string;
  subject_id: number;
  subject_name: string;
  class_name: string;
  title: string;
};

export type Now = {
  mode: 'lesson' | 'free';
  server_time: string;
  day_ends_at: string | null;
  lesson: CurrentLesson | null;
  subjects: StudentSubject[];
};

export type ReaderSection = {
  id: number;
  title: string;
  book_id: number;
  book_title: string;
  subject: SubjectInfo;
  page_start: number;
  page_end: number;
  page_count: number;
  prev_id: number | null;
  next_id: number | null;
  index: number;
  total: number;
};

export type Note = {
  id: number | null;
  lesson_id: number;
  subject_id: number;
  subject_name: string;
  subject_color: string;
  date: string;
  starts_at: string;
  title: string;
  content: string;
  updated_at: string | null;
  sections: { id: number; title: string; available: boolean }[];
  editable: boolean;
  is_current: boolean;
};

export type ExportQuota = { email: string | null; subject_available: boolean; all_available: boolean };

// --- Professor ---

export type ProfessorSubject = SubjectInfo & {
  timetable_name: string;
  classes: ClassRef[];
  book_count: number;
  section_count: number;
};

export type BookFile = {
  id: number;
  status: 'processing' | 'ready' | 'failed';
  error: string | null;
  original_filename: string;
  original_size: number;
  pdf_size: number;
  page_count: number;
  created_at: string;
};

export type ProfessorSection = {
  id: number;
  position: number;
  title: string;
  page_start: number;
  page_end: number;
  published_class_ids: number[];
  included_class_ids: number[];
};

export type Book = {
  id: number;
  subject_id: number;
  title: string;
  position: number;
  exportable: boolean;
  created_at: string;
  file: BookFile | null;
  pending_file: BookFile | null;
  sections: ProfessorSection[];
};

export type SectionDraft = { title: string; page_start: number; page_end: number };
export type ReplaceProposal = { file: BookFile; suggestions: SectionDraft[]; mapping: Record<string, number | null> };
export type Preset = { id: number; subject_id: number; year_level: number; section_ids: number[] };

// --- Admin ---

export type SchoolYear = {
  id: number;
  name: string;
  start: string;
  end: string;
  deletion_date: string;
  day_end_time: string;
  week_a_monday: string | null;
  is_current: boolean;
  purged_at: string | null;
};
export type SchoolYearInput = Omit<SchoolYear, 'id' | 'is_current' | 'purged_at'>;
export type CalendarDay = { id: number; date: string; label: string };
export type SchoolClass = ClassRef & { student_count: number };
export type ImportIssue = { line: number; message: string };
export type ImportReport = {
  dry_run: boolean;
  rows: number;
  created: Record<string, number>;
  updated: Record<string, number>;
  removed: Record<string, number>;
  errors: ImportIssue[];
  warnings: ImportIssue[];
};
export type Slot = {
  id: number;
  weekday: number;
  starts_at: string;
  ends_at: string;
  week: 'A' | 'B' | null;
  class_id: number;
  class_name: string;
  subject_id: number;
  subject_name: string;
  professor_id: number;
  professor_name: string;
};
export type SlotInput = {
  weekday: number;
  starts_at: string;
  ends_at: string;
  week: 'A' | 'B' | null;
  class_id: number;
  subject_name: string;
  professor_id: number;
};
export type Override = {
  id: number;
  slot_id: number;
  date: string;
  cancelled: boolean;
  substitute_professor_id: number | null;
  substitute_professor_name: string | null;
  substitute_subject_id: number | null;
  substitute_subject_name: string | null;
  slot: Slot | null;
};
export type OverrideInput = {
  slot_id: number;
  date: string;
  cancelled: boolean;
  substitute_professor_id: number | null;
  substitute_subject_id: number | null;
};
export type AdminUser = {
  id: number;
  username: string;
  display_name: string;
  email: string | null;
  is_student: boolean;
  is_professor: boolean;
  is_admin: boolean;
  active: boolean;
  signed_in: boolean;
  last_login_at: string | null;
  class_names: string[];
};
export type Storage = {
  total_bytes: number;
  originals_bytes: number;
  pdf_bytes: number;
  cache_bytes: number;
  free_bytes: number | null;
  by_professor: { professor_id: number; professor_name: string; book_count: number; bytes: number }[];
};
export type SubjectOption = { id: number; name: string; professor_id: number; professor_name: string };

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

// Empty in production: the web UI and the API share one origin. Development sets it in .env.development.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '');

let onUnauthorized: (() => void) | null = null;

/** The session store registers this so any 401 sends the user back to the sign-in screen. */
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

type RequestOptions = RequestInit & { passive?: boolean };

async function request<T>(path: string, { passive, ...init }: RequestOptions = {}): Promise<T> {
  let response: Response;
  const headers = new Headers(init.headers);
  // Background polling must not keep an idle student signed in.
  if (passive) headers.set('X-Albok-Passive', '1');
  try {
    response = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: 'include' });
  } catch {
    throw new ApiError(0, 'offline');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = typeof body?.detail === 'string' ? body.detail : `HTTP ${response.status}`;
    if (response.status === 401 && path !== '/api/me') onUnauthorized?.();
    throw new ApiError(response.status, detail);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

function json(method: 'POST' | 'PATCH' | 'PUT', body?: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) };
}

function fileForm(picked: PickedFile, extra: Record<string, string> = {}) {
  const form = new FormData();
  if (picked.file) form.append('file', picked.file, picked.name);
  else form.append('file', { uri: picked.uri, name: picked.name, type: picked.mimeType } as unknown as Blob);
  for (const [key, value] of Object.entries(extra)) if (value) form.append(key, value);
  return form;
}

const del = { method: 'DELETE' } as const;

export const api = {
  publicConfig: () => request<{ school_name: string; privacy_url: string | null }>('/api/public'),
  me: () => request<Me>('/api/me'),
  ping: () => request<Me>('/api/me'),
  logout: () => request<{ end_session_url: string | null }>('/auth/logout', { method: 'POST' }),
  loginUrl: (next = '/') => `${API_URL}/auth/login?next=${encodeURIComponent(next)}`,

  // Student
  now: (passive = false) => request<Now>('/api/student/now', { passive }),
  section: (id: number, previewClassId?: number) =>
    request<ReaderSection>(`/api/sections/${id}${previewClassId ? `?preview_class_id=${previewClassId}` : ''}`),
  sectionPdfUrl: (id: number, previewClassId?: number) =>
    `${API_URL}/api/sections/${id}/pdf${previewClassId ? `?preview_class_id=${previewClassId}` : ''}`,
  bookPdfUrl: (id: number, pending = false) => `${API_URL}/api/books/${id}/pdf${pending ? '?pending=true' : ''}`,
  notes: (subjectId?: number) => request<Note[]>(`/api/student/notes${subjectId ? `?subject_id=${subjectId}` : ''}`),
  note: (lessonId: number) => request<Note>(`/api/lessons/${lessonId}/note`),
  saveNote: (lessonId: number, content: string) => request<Note>(`/api/lessons/${lessonId}/note`, json('PUT', { content })),
  sectionOpened: (sectionId: number) =>
    request<void>(`/api/lessons/current/sections/${sectionId}/opened`, { method: 'POST' }),
  exportQuota: () => request<ExportQuota>('/api/exports/quota'),
  requestExport: (kind: 'subject' | 'all', subjectId?: number) =>
    request<{ email: string }>('/api/exports', json('POST', { kind, subject_id: subjectId ?? null })),

  // Professor
  mySubjects: () => request<ProfessorSubject[]>('/api/professor/subjects'),
  subject: (id: number) => request<ProfessorSubject>(`/api/subjects/${id}`),
  updateSubject: (id: number, patch: Partial<Pick<SubjectInfo, 'name' | 'description' | 'color' | 'icon'>>) =>
    request<ProfessorSubject>(`/api/subjects/${id}`, json('PATCH', patch)),
  books: (subjectId: number) => request<Book[]>(`/api/subjects/${subjectId}/books`),
  book: (id: number) => request<Book>(`/api/books/${id}`),
  uploadBook: (subjectId: number, picked: PickedFile, title?: string) =>
    request<Book>(`/api/subjects/${subjectId}/books`, { method: 'POST', body: fileForm(picked, { title: title?.trim() ?? '' }) }),
  pasteBook: (subjectId: number, title: string, text: string) =>
    request<Book>(`/api/subjects/${subjectId}/books/text`, json('POST', { title, text })),
  updateBook: (id: number, patch: Partial<Pick<Book, 'title' | 'exportable' | 'position'>>) =>
    request<Book>(`/api/books/${id}`, json('PATCH', patch)),
  deleteBook: (id: number) => request<void>(`/api/books/${id}`, del),
  replaceFile: (id: number, picked: PickedFile) =>
    request<Book>(`/api/books/${id}/replace`, { method: 'POST', body: fileForm(picked) }),
  replaceProposal: (id: number) => request<ReplaceProposal>(`/api/books/${id}/replace`),
  confirmReplace: (id: number, sections: SectionDraft[], mapping: Record<string, number | null>) =>
    request<Book>(`/api/books/${id}/replace/confirm`, json('POST', { sections, mapping })),
  cancelReplace: (id: number) => request<Book>(`/api/books/${id}/replace`, del),
  createSection: (bookId: number, draft: SectionDraft) =>
    request<Book>(`/api/books/${bookId}/sections`, json('POST', draft)),
  updateSection: (id: number, patch: Partial<SectionDraft>) => request<Book>(`/api/sections/${id}`, json('PATCH', patch)),
  deleteSection: (id: number) => request<Book>(`/api/sections/${id}`, del),
  splitSection: (id: number, atPage: number, title?: string) =>
    request<Book>(`/api/sections/${id}/split`, json('POST', { at_page: atPage, title: title || null })),
  mergeSections: (bookId: number, sectionIds: number[]) =>
    request<Book>(`/api/books/${bookId}/sections/merge`, json('POST', { section_ids: sectionIds })),
  reorderSections: (bookId: number, sectionIds: number[]) =>
    request<Book>(`/api/books/${bookId}/sections/order`, json('PUT', { section_ids: sectionIds })),
  publishSection: (id: number, classId: number, published: boolean) =>
    request<Book>(`/api/sections/${id}/publications/${classId}`, json('PUT', { published })),
  publishBook: (id: number, classId: number, published: boolean) =>
    request<Book>(`/api/books/${id}/publications/${classId}`, json('PUT', { published })),
  includeSection: (id: number, classId: number, included: boolean) =>
    request<Book>(`/api/sections/${id}/inclusions/${classId}`, json('PUT', { included })),
  presets: (subjectId: number) => request<Preset[]>(`/api/subjects/${subjectId}/presets`),
  createPreset: (subjectId: number, yearLevel: number, sectionIds: number[]) =>
    request<Preset>(`/api/subjects/${subjectId}/presets`, json('POST', { year_level: yearLevel, section_ids: sectionIds })),
  updatePreset: (id: number, sectionIds: number[]) =>
    request<Preset>(`/api/presets/${id}`, json('PUT', { section_ids: sectionIds })),
  deletePreset: (id: number) => request<void>(`/api/presets/${id}`, del),
  applyPreset: (id: number, classId: number) => request<Book[]>(`/api/presets/${id}/apply/${classId}`, json('POST')),
  preview: (classId: number, subjectId: number) =>
    request<StudentSubject[]>(`/api/professor/preview/${classId}?subject_id=${subjectId}`),

  // Admin
  years: () => request<SchoolYear[]>('/api/admin/years'),
  createYear: (input: SchoolYearInput) => request<SchoolYear>('/api/admin/years', json('POST', input)),
  updateYear: (id: number, input: SchoolYearInput) => request<SchoolYear>(`/api/admin/years/${id}`, json('PUT', input)),
  days: (yearId: number) => request<CalendarDay[]>(`/api/admin/years/${yearId}/days`),
  addDays: (yearId: number, start: string, end: string | null, label: string) =>
    request<CalendarDay[]>(`/api/admin/years/${yearId}/days`, json('POST', { start, end, label })),
  deleteDay: (yearId: number, dayId: number) => request<void>(`/api/admin/years/${yearId}/days/${dayId}`, del),
  classes: () => request<SchoolClass[]>('/api/admin/classes'),
  createClass: (name: string, yearLevel: number) =>
    request<SchoolClass>('/api/admin/classes', json('POST', { name, year_level: yearLevel })),
  updateClass: (id: number, name: string, yearLevel: number) =>
    request<SchoolClass>(`/api/admin/classes/${id}`, json('PUT', { name, year_level: yearLevel })),
  deleteClass: (id: number) => request<void>(`/api/admin/classes/${id}`, del),
  importCsv: (kind: 'roster' | 'timetable', picked: PickedFile, dryRun: boolean) =>
    request<ImportReport>(`/api/admin/${kind}/import?dry_run=${dryRun}`, { method: 'POST', body: fileForm(picked) }),
  slots: () => request<Slot[]>('/api/admin/slots'),
  createSlot: (input: SlotInput) => request<Slot>('/api/admin/slots', json('POST', input)),
  updateSlot: (id: number, input: SlotInput) => request<Slot>(`/api/admin/slots/${id}`, json('PUT', input)),
  deleteSlot: (id: number) => request<void>(`/api/admin/slots/${id}`, del),
  overrides: (start?: string) => request<Override[]>(`/api/admin/overrides${start ? `?start=${start}` : ''}`),
  saveOverride: (input: OverrideInput) => request<Override>('/api/admin/overrides', json('PUT', input)),
  deleteOverride: (id: number) => request<void>(`/api/admin/overrides/${id}`, del),
  allSubjects: () => request<SubjectOption[]>('/api/admin/subjects'),
  users: (q?: string, role?: 'student' | 'professor' | 'admin') => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (role) params.set('role', role);
    return request<AdminUser[]>(`/api/admin/users?${params}`);
  },
  updateUser: (id: number, patch: Partial<Pick<AdminUser, 'is_professor' | 'is_admin' | 'active'>>) =>
    request<AdminUser>(`/api/admin/users/${id}`, json('PATCH', patch)),
  storage: () => request<Storage>('/api/admin/storage'),
};
