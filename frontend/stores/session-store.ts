import { api, setUnauthorizedHandler, type Me } from '@/lib/api';
import { kioskBridge } from '@/lib/kiosk';
import { flushNotes, startNoteSync, wipeLocalNotes } from '@/lib/note-sync';
import { router } from 'expo-router';
import { create } from 'zustand';

export type SignOutReason = 'manual' | 'idle' | 'day-end' | 'expired';

type SessionState = {
  status: 'loading' | 'signed-in' | 'signed-out';
  me: Me | null;
  /** server time minus device time, so timers use the server clock, never the PC clock. */
  clockOffsetMs: number;
  lastSignOut: SignOutReason | null;
  load: () => Promise<void>;
  /** Returns 'unsynced' (and stays signed in) if a manual sign-out would lose notes, unless forced. */
  signOut: (reason: SignOutReason, options?: { force?: boolean }) => Promise<'done' | 'unsynced'>;
};

export const useSession = create<SessionState>()((set, get) => ({
  status: 'loading',
  me: null,
  clockOffsetMs: 0,
  lastSignOut: null,

  load: async () => {
    try {
      const me = await api.me();
      set({
        status: 'signed-in',
        me,
        clockOffsetMs: new Date(me.server_time).getTime() - Date.now(),
      });
      startNoteSync(me.id);
    } catch {
      set({ status: 'signed-out', me: null });
    }
  },

  signOut: async (reason, { force = false } = {}) => {
    const synced = await flushNotes();
    if (!synced && reason === 'manual' && !force) return 'unsynced';
    wipeLocalNotes();
    let endSessionUrl: string | null = null;
    if (reason !== 'expired') {
      endSessionUrl = await api
        .logout()
        .then((result) => result.end_session_url)
        .catch(() => null);
    }
    set({ status: 'signed-out', me: null, lastSignOut: reason });
    // The kiosk shell wipes its session partition (cookies, storage, cache) for the next student.
    await kioskBridge()?.signOut?.();
    if (endSessionUrl && typeof window !== 'undefined') {
      // Also end the AAI@EduHr session, or the next student could be signed in as this one.
      window.location.assign(endSessionUrl);
    } else {
      router.replace({ pathname: '/login', params: reason === 'manual' ? {} : { reason } });
    }
    return 'done';
  },
}));

setUnauthorizedHandler(() => {
  const { status, signOut } = useSession.getState();
  if (status === 'signed-in') void signOut('expired');
});

export function serverNow() {
  return new Date(Date.now() + useSession.getState().clockOffsetMs);
}
