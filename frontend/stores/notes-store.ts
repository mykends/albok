import { api, errorMessage, type Note, type NoteInput } from '@/lib/api';
import { refreshSubjects } from '@/stores/subjects-store';
import { create } from 'zustand';

type NotesState = {
  notesBySubject: Record<number, Note[] | undefined>;
  notesErrors: Record<number, string | undefined>;
  recentNotes: Note[];
  fetchNotes: (subjectId: number) => Promise<void>;
  fetchRecentNotes: () => Promise<void>;
  createNote: (subjectId: number, input: NoteInput) => Promise<Note>;
  updateNote: (note: Note, input: NoteInput) => Promise<Note>;
  deleteNote: (note: Note) => Promise<void>;
};

// Same order as the API: pinned first, then most recently edited.
function sortNotes(notes: Note[]) {
  return [...notes].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at)
  );
}

export const useNotesStore = create<NotesState>()((set) => {
  function replaceNotes(subjectId: number, update: (notes: Note[]) => Note[]) {
    set((state) => ({
      notesBySubject: {
        ...state.notesBySubject,
        [subjectId]: sortNotes(update(state.notesBySubject[subjectId] ?? [])),
      },
    }));
  }

  return {
    notesBySubject: {},
    notesErrors: {},
    recentNotes: [],

    fetchNotes: async (subjectId) => {
      try {
        const notes = await api.notes(subjectId);
        set((state) => ({
          notesBySubject: { ...state.notesBySubject, [subjectId]: notes },
          notesErrors: { ...state.notesErrors, [subjectId]: undefined },
        }));
      } catch (error) {
        set((state) => ({ notesErrors: { ...state.notesErrors, [subjectId]: errorMessage(error) } }));
      }
    },

    fetchRecentNotes: async () => {
      try {
        set({ recentNotes: await api.recentNotes() });
      } catch {
        // The dashboard shows the connection error from the subjects store instead.
      }
    },

    createNote: async (subjectId, input) => {
      const note = await api.createNote(subjectId, input);
      replaceNotes(subjectId, (notes) => [note, ...notes]);
      set((state) => ({ recentNotes: [note, ...state.recentNotes].slice(0, 5) }));
      refreshSubjects();
      return note;
    },

    updateNote: async (note, input) => {
      const updated = await api.updateNote(note.id, input);
      replaceNotes(note.subject_id, (notes) => notes.map((n) => (n.id === note.id ? updated : n)));
      set((state) => ({ recentNotes: state.recentNotes.map((n) => (n.id === note.id ? updated : n)) }));
      return updated;
    },

    deleteNote: async (note) => {
      await api.deleteNote(note.id);
      replaceNotes(note.subject_id, (notes) => notes.filter((n) => n.id !== note.id));
      set((state) => ({ recentNotes: state.recentNotes.filter((n) => n.id !== note.id) }));
      refreshSubjects();
    },
  };
});
