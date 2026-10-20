import { api, errorMessage, type Subject } from '@/lib/api';
import { create } from 'zustand';

type SubjectsState = {
  subjects: Subject[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  fetchSubjects: () => Promise<void>;
};

export const useSubjectsStore = create<SubjectsState>()((set, get) => ({
  subjects: [],
  status: 'idle',
  error: null,

  fetchSubjects: async () => {
    if (get().status !== 'ready') set({ status: 'loading' });
    try {
      set({ subjects: await api.subjects(), status: 'ready', error: null });
    } catch (error) {
      set({ status: get().subjects.length ? 'ready' : 'error', error: errorMessage(error) });
    }
  },
}));

export function useSubject(subjectId: number) {
  return useSubjectsStore((state) => state.subjects.find((subject) => subject.id === subjectId));
}

/** Book/section/note counts are computed by the server, so refresh them after mutations. */
export function refreshSubjects() {
  return useSubjectsStore.getState().fetchSubjects();
}
