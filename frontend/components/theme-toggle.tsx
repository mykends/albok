import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { usePreferencesStore } from '@/stores/preferences-store';
import { Monitor, MoonStar, Sun } from 'lucide-react-native';

const NEXT = { system: 'light', light: 'dark', dark: 'system' } as const;
const OPTIONS = {
  system: { icon: Monitor, label: 'System theme' },
  light: { icon: Sun, label: 'Light theme' },
  dark: { icon: MoonStar, label: 'Dark theme' },
};

/** Cycles system -> light -> dark. The root layout applies the stored choice. */
export function ThemeToggle({ compact }: { compact?: boolean }) {
  const colorScheme = usePreferencesStore((state) => state.colorScheme);
  const setColorScheme = usePreferencesStore((state) => state.setColorScheme);
  const { icon, label } = OPTIONS[colorScheme];

  return (
    <Button
      variant="ghost"
      size={compact ? 'icon' : 'default'}
      className="justify-start"
      accessibilityLabel={label}
      onPress={() => setColorScheme(NEXT[colorScheme])}>
      <Icon as={icon} size={16} />
      {!compact && <Text>{label}</Text>}
    </Button>
  );
}
