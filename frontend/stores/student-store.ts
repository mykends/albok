import { api, type Now } from '@/lib/api';
import { errorMessage } from '@/lib/i18n';
import { create } from 'zustand';

type StudentState = {
  now: Now | null;
  error: string | null;
  /** Polled in the background (passive, so it doesn't count as activity). */
  refresh: (passive?: boolean) => Promise<Now | null>;
  reset: () => void;
};

export const useStudent = create<StudentState>()((set) => ({
  now: null,
  error: null,
  refresh: async (passive = true) => {
    try {
      const now = await api.now(passive);
      set({ now, error: null });
      return now;
    } catch (error) {
      set({ error: errorMessage(error) });
      return null;
    }
  },
  reset: () => set({ now: null, error: null }),
}));
