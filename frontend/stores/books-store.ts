import { api, errorMessage, type Book, type PickedFile, type RecentSection, type Section } from '@/lib/api';
import { refreshSubjects } from '@/stores/subjects-store';
import { create } from 'zustand';

type BooksState = {
  booksBySubject: Record<number, Book[] | undefined>;
  booksErrors: Record<number, string | undefined>;
  sections: Record<number, Section | undefined>;
  recentSections: RecentSection[];
  fetchBooks: (subjectId: number) => Promise<void>;
  importFile: (subjectId: number, file: PickedFile, title?: string) => Promise<Book>;
  importText: (subjectId: number, title: string, text: string) => Promise<Book>;
  deleteBook: (book: Book) => Promise<void>;
  fetchSection: (sectionId: number) => Promise<Section>;
  setSectionCompleted: (subjectId: number, sectionId: number, completed: boolean) => Promise<void>;
  fetchRecentSections: () => Promise<void>;
};

export const useBooksStore = create<BooksState>()((set, get) => {
  function addBook(book: Book) {
    set((state) => ({
      booksBySubject: {
        ...state.booksBySubject,
        [book.subject_id]: [book, ...(state.booksBySubject[book.subject_id] ?? [])],
      },
    }));
    refreshSubjects();
    return book;
  }

  function applyCompleted(subjectId: number, sectionId: number, completed: boolean) {
    set((state) => {
      const section = state.sections[sectionId];
      return {
        sections: section ? { ...state.sections, [sectionId]: { ...section, completed } } : state.sections,
        booksBySubject: {
          ...state.booksBySubject,
          [subjectId]: state.booksBySubject[subjectId]?.map((book) => ({
            ...book,
            sections: book.sections.map((s) => (s.id === sectionId ? { ...s, completed } : s)),
          })),
        },
      };
    });
  }

  return {
    booksBySubject: {},
    booksErrors: {},
    sections: {},
    recentSections: [],

    fetchBooks: async (subjectId) => {
      try {
        const books = await api.books(subjectId);
        set((state) => ({
          booksBySubject: { ...state.booksBySubject, [subjectId]: books },
          booksErrors: { ...state.booksErrors, [subjectId]: undefined },
        }));
      } catch (error) {
        set((state) => ({ booksErrors: { ...state.booksErrors, [subjectId]: errorMessage(error) } }));
      }
    },

    importFile: async (subjectId, file, title) => addBook(await api.importBookFile(subjectId, file, title)),

    importText: async (subjectId, title, text) => addBook(await api.importBookText(subjectId, title, text)),

    deleteBook: async (book) => {
      await api.deleteBook(book.id);
      set((state) => ({
        booksBySubject: {
          ...state.booksBySubject,
          [book.subject_id]: state.booksBySubject[book.subject_id]?.filter((b) => b.id !== book.id),
        },
        recentSections: state.recentSections.filter((s) => s.book_id !== book.id),
      }));
      refreshSubjects();
    },

    fetchSection: async (sectionId) => {
      const section = await api.section(sectionId);
      set((state) => ({ sections: { ...state.sections, [sectionId]: section } }));
      return section;
    },

    setSectionCompleted: async (subjectId, sectionId, completed) => {
      applyCompleted(subjectId, sectionId, completed);
      try {
        await api.updateSection(sectionId, { completed });
      } catch (error) {
        applyCompleted(subjectId, sectionId, !completed);
        throw error;
      }
      refreshSubjects();
    },

    fetchRecentSections: async () => {
      try {
        set({ recentSections: await api.recentSections() });
      } catch {
        // The dashboard shows the connection error from the subjects store instead.
      }
    },
  };
});
