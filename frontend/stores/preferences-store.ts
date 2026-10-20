import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const READER_ZOOM = { min: 0.6, max: 2.4, step: 0.2, default: 1 };

// Remembered on this device (not per user): zoom, theme and the notes panel.
type PreferencesState = {
  colorScheme: 'light' | 'dark' | 'system';
  readerZoom: number;
  notesPanelOpen: boolean;
  setColorScheme: (colorScheme: PreferencesState['colorScheme']) => void;
  changeReaderZoom: (direction: 1 | -1) => void;
  toggleNotesPanel: () => void;
};

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      colorScheme: 'system',
      readerZoom: READER_ZOOM.default,
      notesPanelOpen: true,
      setColorScheme: (colorScheme) => set({ colorScheme }),
      changeReaderZoom: (direction) =>
        set((state) => ({
          readerZoom:
            Math.round(
              Math.min(READER_ZOOM.max, Math.max(READER_ZOOM.min, state.readerZoom + direction * READER_ZOOM.step)) * 10
            ) / 10,
        })),
      toggleNotesPanel: () => set((state) => ({ notesPanelOpen: !state.notesPanelOpen })),
    }),
    { name: 'albok-preferences', version: 2, storage: createJSONStorage(() => AsyncStorage) }
  )
);
