import { api, type ProfessorSubject } from '@/lib/api';
import { errorMessage } from '@/lib/i18n';
import { create } from 'zustand';

type ProfessorState = {
  subjects: ProfessorSubject[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  refresh: () => Promise<void>;
  replaceSubject: (subject: ProfessorSubject) => void;
};

export const useProfessor = create<ProfessorState>()((set, get) => ({
  subjects: [],
  status: 'idle',
  error: null,
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
}));
