import '@/global.css';
import '@/lib/i18n';

import { AppShell } from '@/components/app-shell';
import { SessionWatch } from '@/components/session-watch';
import { NAV_THEME } from '@/lib/theme';
import { usePreferencesStore } from '@/stores/preferences-store';
import { useSession } from '@/stores/session-store';
import { PortalHost } from '@rn-primitives/portal';
import { Stack } from 'expo-router';
import { ThemeProvider } from 'expo-router/react-navigation';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'nativewind';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export default function RootLayout() {
  const { colorScheme, setColorScheme } = useColorScheme();
  const preferredScheme = usePreferencesStore((state) => state.colorScheme);
  const status = useSession((state) => state.status);
  const me = useSession((state) => state.me);
  const load = useSession((state) => state.load);

  useEffect(() => {
    setColorScheme(preferredScheme);
  }, [preferredScheme, setColorScheme]);

  useEffect(() => {
    load();
  }, [load]);

  // Wait for /api/me before routing, so a deep link (e.g. after sign-in) isn't bounced to the login screen.
  if (status === 'loading') {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  const signedIn = status === 'signed-in' && !!me;
  const student = signedIn && me.is_student && !me.is_professor && !me.is_admin;

  return (
    <ThemeProvider value={NAV_THEME[colorScheme ?? 'light']}>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      <AppShell>
        <Stack screenOptions={{ headerShown: false, animation: 'none' }}>
          <Stack.Protected guard={signedIn}>
            <Stack.Screen name="index" />
            <Stack.Screen name="read/[sectionId]" />
            <Stack.Protected guard={student}>
              <Stack.Screen name="notes" />
            </Stack.Protected>
            <Stack.Protected guard={!!me?.is_professor}>
              <Stack.Screen name="subjects/[subjectId]" />
              <Stack.Screen name="books/[bookId]" />
            </Stack.Protected>
            <Stack.Protected guard={!!me?.is_admin}>
              <Stack.Screen name="admin" />
            </Stack.Protected>
          </Stack.Protected>
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="login" />
          </Stack.Protected>
        </Stack>
      </AppShell>
      {signedIn && <SessionWatch />}
      <PortalHost />
    </ThemeProvider>
  );
}
