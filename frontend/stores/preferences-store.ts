import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const READER_ZOOM = { min: 0.6, max: 2.4, step: 0.2, default: 1 };

/** How the lesson notes share the screen with the material: not at all, as a side panel, or half each. */
export type NotesLayout = 'hidden' | 'side' | 'half';

// Remembered on this device (not per user): zoom, theme and the notes layout.
type PreferencesState = {
  colorScheme: 'light' | 'dark' | 'system';
  readerZoom: number;
  notesLayout: NotesLayout;
  setColorScheme: (colorScheme: PreferencesState['colorScheme']) => void;
  changeReaderZoom: (direction: 1 | -1) => void;
  setNotesLayout: (notesLayout: NotesLayout) => void;
};

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      colorScheme: 'system',
      readerZoom: READER_ZOOM.default,
      notesLayout: 'side',
      setColorScheme: (colorScheme) => set({ colorScheme }),
      changeReaderZoom: (direction) =>
        set((state) => ({
          readerZoom:
            Math.round(
              Math.min(READER_ZOOM.max, Math.max(READER_ZOOM.min, state.readerZoom + direction * READER_ZOOM.step)) * 10
            ) / 10,
        })),
      setNotesLayout: (notesLayout) => set({ notesLayout }),
    }),
    {
      name: 'albok-preferences',
      version: 3,
      storage: createJSONStorage(() => AsyncStorage),
      // Version 2 only had an open or closed notes panel.
      migrate: (persisted, version) => {
        const { notesPanelOpen, ...state } = persisted as Partial<PreferencesState> & { notesPanelOpen?: boolean };
        if (version < 3 && notesPanelOpen !== undefined) state.notesLayout = notesPanelOpen ? 'side' : 'hidden';
        return state as PreferencesState;
      },
    }
  )
);
