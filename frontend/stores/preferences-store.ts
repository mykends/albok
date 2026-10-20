import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const READER_FONT_SIZES = { min: 14, max: 28, default: 18 };

type PreferencesState = {
  colorScheme: 'light' | 'dark' | 'system';
  readerFontSize: number;
  notesPanelOpen: boolean;
  setColorScheme: (colorScheme: PreferencesState['colorScheme']) => void;
  changeReaderFontSize: (delta: number) => void;
  toggleNotesPanel: () => void;
};

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      colorScheme: 'system',
      readerFontSize: READER_FONT_SIZES.default,
      notesPanelOpen: true,
      setColorScheme: (colorScheme) => set({ colorScheme }),
      changeReaderFontSize: (delta) =>
        set((state) => ({
          readerFontSize: Math.min(
            READER_FONT_SIZES.max,
            Math.max(READER_FONT_SIZES.min, state.readerFontSize + delta)
          ),
        })),
      toggleNotesPanel: () => set((state) => ({ notesPanelOpen: !state.notesPanelOpen })),
    }),
    { name: 'albok-preferences', storage: createJSONStorage(() => AsyncStorage) }
  )
);
