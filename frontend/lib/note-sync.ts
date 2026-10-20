/**
 * Offline-first lesson notes.
 *
 * Every keystroke is written to this device at once; a background loop sends the latest text to the
 * server every few seconds and clears the local copy once the server confirms it. Pending writes are
 * flushed before any sign-out and the local store is wiped afterwards, so nothing is left on a shared PC.
 */
import { ApiError, api, type Note } from '@/lib/api';
import { errorMessage } from '@/lib/i18n';
import { create } from 'zustand';

const PREFIX = 'albok-note:';
const SYNC_DELAY_MS = 2500;
const RETRY_DELAY_MS = 5000;

type Pending = { userId: number; lessonId: number; content: string; at: number };
export type SyncStatus = 'saved' | 'pending' | 'saving' | 'offline' | 'rejected';

type SyncState = {
  status: Record<number, SyncStatus | undefined>;
  errors: Record<number, string | undefined>;
  /** Latest server copy per lesson, so open editors can update their "saved" metadata. */
  saved: Record<number, Note | undefined>;
};

export const useNoteSync = create<SyncState>()(() => ({ status: {}, errors: {}, saved: {} }));

const memory = new Map<string, string>();

const storage = {
  get(key: string): string | null {
    try {
      return globalThis.localStorage?.getItem(key) ?? memory.get(key) ?? null;
    } catch {
      return memory.get(key) ?? null;
    }
  },
  set(key: string, value: string) {
    memory.set(key, value);
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // Private mode or full storage: the in-memory copy still syncs.
    }
  },
  remove(key: string) {
    memory.delete(key);
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {}
  },
  keys(): string[] {
    const keys = new Set(memory.keys());
    try {
      const local = globalThis.localStorage;
      for (let i = 0; local && i < local.length; i++) {
        const key = local.key(i);
        if (key) keys.add(key);
      }
    } catch {}
    return [...keys].filter((key) => key.startsWith(PREFIX));
  },
};

function read(key: string): Pending | null {
  try {
    const value = storage.get(key);
    return value ? (JSON.parse(value) as Pending) : null;
  } catch {
    return null;
  }
}

function setStatus(lessonId: number, status: SyncStatus, error?: string) {
  useNoteSync.setState((state) => ({
    status: { ...state.status, [lessonId]: status },
    errors: { ...state.errors, [lessonId]: error },
  }));
}

let currentUserId: number | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let running: Promise<boolean> | null = null;

function schedule(delay = SYNC_DELAY_MS) {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void syncNotes();
  }, delay);
}

/** Call after sign-in. Unsynced notes from someone else's crashed session can't be sent with this
 * account, so they are discarded; the user's own are synced. */
export function startNoteSync(userId: number) {
  currentUserId = userId;
  for (const key of storage.keys()) {
    const pending = read(key);
    if (!pending || pending.userId !== userId) storage.remove(key);
  }
  if (storage.keys().length) schedule(0);
}

export function writeDraft(lessonId: number, content: string) {
  if (currentUserId === null) return;
  storage.set(`${PREFIX}${lessonId}`, JSON.stringify({ userId: currentUserId, lessonId, content, at: Date.now() }));
  setStatus(lessonId, 'pending');
  schedule();
}

/** Text typed on this device that the server hasn't confirmed yet (it is newer than the server copy). */
export function localDraft(lessonId: number): string | null {
  const pending = read(`${PREFIX}${lessonId}`);
  return pending && pending.userId === currentUserId ? pending.content : null;
}

export function syncNotes(): Promise<boolean> {
  if (running) return running.then(() => syncNotes());
  running = (async () => {
    let allSynced = true;
    for (const key of storage.keys()) {
      const sent = read(key);
      if (!sent || sent.userId !== currentUserId) continue;
      setStatus(sent.lessonId, 'saving');
      try {
        const note = await api.saveNote(sent.lessonId, sent.content);
        // Only clear the local copy if nothing was typed while the request was in flight.
        if (read(key)?.at === sent.at) {
          storage.remove(key);
          setStatus(sent.lessonId, 'saved');
        } else {
          allSynced = false;
          schedule();
        }
        useNoteSync.setState((state) => ({ saved: { ...state.saved, [sent.lessonId]: note } }));
      } catch (error) {
        allSynced = false;
        if (error instanceof ApiError && error.status === 0) {
          setStatus(sent.lessonId, 'offline');
          schedule(RETRY_DELAY_MS);
        } else if (error instanceof ApiError && error.status === 401) {
          setStatus(sent.lessonId, 'pending');
        } else {
          // e.g. the server refuses edits to another subject's note during a lesson; keep the text.
          setStatus(sent.lessonId, 'rejected', errorMessage(error));
        }
      }
    }
    return allSynced;
  })();
  return running.finally(() => {
    running = null;
  });
}

/** Push every pending note to the server; resolves false if something couldn't be saved in time. */
export async function flushNotes(timeoutMs = 5000): Promise<boolean> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!storage.keys().length) return true;
  const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs));
  return Promise.race([syncNotes(), timeout]);
}

export function hasUnsyncedNotes() {
  return storage.keys().some((key) => read(key)?.userId === currentUserId);
}

/** Remove every local note. Called at every sign-out, whether or not the flush succeeded. */
export function wipeLocalNotes() {
  if (timer) clearTimeout(timer);
  timer = null;
  for (const key of storage.keys()) storage.remove(key);
  currentUserId = null;
  useNoteSync.setState({ status: {}, errors: {}, saved: {} });
}
