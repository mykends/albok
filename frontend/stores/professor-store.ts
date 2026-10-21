import { api, type ProfessorSubject, type TeachingLesson } from '@/lib/api';
import { errorMessage } from '@/lib/i18n';
import { create } from 'zustand';

type ProfessorState = {
  subjects: ProfessorSubject[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  /** Lessons the professor is teaching right now (usually none or one). */
  teaching: TeachingLesson[];
  refresh: () => Promise<void>;
  replaceSubject: (subject: ProfessorSubject) => void;
  /** Polled in the background (passive, so an unattended PC still reaches the idle sign-out). */
  refreshTeaching: (passive?: boolean) => Promise<void>;
  replaceLesson: (lesson: TeachingLesson) => void;
};

export const useProfessor = create<ProfessorState>()((set, get) => ({
  subjects: [],
  status: 'idle',
  error: null,
  teaching: [],
  refresh: async () => {
    if (get().status !== 'ready') set({ status: 'loading' });
    try {
      set({ subjects: await api.mySubjects(), status: 'ready', error: null });
    } catch (error) {
      set({ status: get().subjects.length ? 'ready' : 'error', error: errorMessage(error) });
    }
  },
  replaceSubject: (subject) =>
    set((state) => ({ subjects: state.subjects.map((s) => (s.id === subject.id ? subject : s)) })),
  refreshTeaching: async (passive = true) => {
    try {
      set({ teaching: await api.teaching(passive) });
    } catch {
      // Keep the last answer; the next poll tries again.
    }
  },
  replaceLesson: (lesson) =>
    set((state) => ({ teaching: state.teaching.map((l) => (l.lesson_id === lesson.lesson_id ? lesson : l)) })),
}));
