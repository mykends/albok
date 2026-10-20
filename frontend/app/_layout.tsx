import '@/global.css';

import { AppShell } from '@/components/app-shell';
import { NAV_THEME } from '@/lib/theme';
import { usePreferencesStore } from '@/stores/preferences-store';
import { useSubjectsStore } from '@/stores/subjects-store';
import { PortalHost } from '@rn-primitives/portal';
import { Slot } from 'expo-router';
import { ThemeProvider } from 'expo-router/react-navigation';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'nativewind';
import { useEffect } from 'react';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export default function RootLayout() {
  const { colorScheme, setColorScheme } = useColorScheme();
  const preferredScheme = usePreferencesStore((state) => state.colorScheme);
  const fetchSubjects = useSubjectsStore((state) => state.fetchSubjects);

  useEffect(() => {
    setColorScheme(preferredScheme);
  }, [preferredScheme, setColorScheme]);

  useEffect(() => {
    fetchSubjects();
  }, [fetchSubjects]);

  return (
    <ThemeProvider value={NAV_THEME[colorScheme ?? 'light']}>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      <AppShell>
        <Slot />
      </AppShell>
      <PortalHost />
    </ThemeProvider>
  );
}
