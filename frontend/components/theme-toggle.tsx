import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { usePreferencesStore } from '@/stores/preferences-store';
import { Monitor, MoonStar, Sun } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

const NEXT = { system: 'light', light: 'dark', dark: 'system' } as const;
const ICONS = { system: Monitor, light: Sun, dark: MoonStar };

/** Cycles system -> light -> dark. The root layout applies the stored choice. */
export function ThemeToggle({ compact }: { compact?: boolean }) {
  const { t } = useTranslation();
  const colorScheme = usePreferencesStore((state) => state.colorScheme);
  const setColorScheme = usePreferencesStore((state) => state.setColorScheme);
  const label = t(`theme.${colorScheme}`);

  return (
    <Button
      variant="ghost"
      size={compact ? 'icon' : 'default'}
      className="justify-start"
      accessibilityLabel={label}
      onPress={() => setColorScheme(NEXT[colorScheme])}>
      <Icon as={ICONS[colorScheme]} size={16} />
      {!compact && <Text>{label}</Text>}
    </Button>
  );
}
