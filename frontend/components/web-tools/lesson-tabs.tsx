import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { webToolMode } from '@/lib/kiosk';
import { cn } from '@/lib/utils';
import { useWebTools } from '@/stores/web-tools-store';
import { router, usePathname } from 'expo-router';
import { AppWindow, BookOpen, type LucideIcon } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

/** Shows a tool's tab: in place on a screen that has the tool area, otherwise in the reader at the
 * section last read this lesson, or on /lesson when none was. The student is never moved there unasked. */
export function useOpenWebTool() {
  const pathname = usePathname();
  return (toolId: number) => {
    const { setActive, lastSectionId } = useWebTools.getState();
    setActive(toolId);
    if (pathname.startsWith('/read') || pathname === '/lesson') return;
    if (lastSectionId !== null)
      router.push({ pathname: '/read/[sectionId]', params: { sectionId: String(lastSectionId) } });
    else router.push('/lesson');
  };
}

/** "Material" plus one tab per web tool open for the lesson (kiosk only). */
export function LessonTabs({ onMaterial }: { onMaterial?: () => void }) {
  const { t } = useTranslation();
  const tools = useWebTools((state) => state.tools);
  const active = useWebTools((state) => state.active);
  const setActive = useWebTools((state) => state.setActive);

  if (webToolMode() !== 'tabs' || tools.length === 0) return null;
  return (
    <View
      role="tablist"
      className="flex-row flex-wrap items-center gap-1 border-b border-border bg-muted/40 px-3 py-1.5">
      <Tab
        label={t('webTools.student.material')}
        icon={BookOpen}
        selected={active === null}
        onPress={() => {
          setActive(null);
          onMaterial?.();
        }}
      />
      {tools.map((tool) => (
        <Tab
          key={tool.id}
          label={tool.name}
          icon={AppWindow}
          selected={active === tool.id}
          onPress={() => setActive(tool.id)}
        />
      ))}
    </View>
  );
}

function Tab({
  label,
  icon,
  selected,
  onPress,
}: {
  label: string;
  icon: LucideIcon;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      role="tab"
      aria-selected={selected}
      onPress={onPress}
      className={cn(
        'max-w-56 flex-row items-center gap-2 rounded-md px-3 py-1.5 web:transition-colors web:hover:bg-accent',
        selected && 'bg-background shadow-sm shadow-black/5'
      )}>
      <Icon as={icon} size={15} className={selected ? 'text-primary' : 'text-muted-foreground'} />
      <Text
        className={cn('text-sm', selected ? 'font-semibold' : 'text-foreground/80')}
        numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}
