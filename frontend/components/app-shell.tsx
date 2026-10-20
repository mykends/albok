import { SubjectIcon } from '@/components/subject-icon';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { useBooksStore } from '@/stores/books-store';
import { useSubjectsStore } from '@/stores/subjects-store';
import { Link, usePathname, type Href } from 'expo-router';
import { GraduationCap, LayoutDashboard, RefreshCw, WifiOff } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';

const COMPACT_BELOW = 900;

export function AppShell({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  return (
    <View className="flex-1 flex-row bg-background">
      <Sidebar compact={width < COMPACT_BELOW} />
      <View className="flex-1">{children}</View>
    </View>
  );
}

function Sidebar({ compact }: { compact: boolean }) {
  const pathname = usePathname();
  const subjects = useSubjectsStore((state) => state.subjects);
  const error = useSubjectsStore((state) => state.error);
  const fetchSubjects = useSubjectsStore((state) => state.fetchSubjects);
  // While reading a section, keep its subject highlighted.
  const readingSubjectId = useBooksStore((state) => {
    const match = /^\/sections\/(\d+)/.exec(pathname);
    return match ? state.sections[Number(match[1])]?.subject_id : undefined;
  });

  return (
    <View className={cn('border-r border-border bg-muted/40', compact ? 'w-16 items-center' : 'w-64')}>
      <View className={cn('flex-row items-center gap-2.5 py-5', compact ? 'justify-center' : 'px-5')}>
        <View className="size-9 items-center justify-center rounded-lg bg-primary">
          <Icon as={GraduationCap} size={20} className="text-primary-foreground" />
        </View>
        {!compact && (
          <View>
            <Text className="text-base font-bold leading-5">Albok</Text>
            <Text className="text-xs text-muted-foreground">Class companion</Text>
          </View>
        )}
      </View>

      <ScrollView className="flex-1" contentContainerClassName={cn('gap-1 pb-4', compact ? 'items-center' : 'px-3')}>
        <NavItem
          href="/"
          label="Dashboard"
          compact={compact}
          active={pathname === '/'}
          leading={
            <View className="size-7 items-center justify-center">
              <Icon as={LayoutDashboard} size={16} />
            </View>
          }
        />
        {compact ? (
          <View className="my-2 h-px w-8 bg-border" />
        ) : (
          <Text className="px-3 pb-1 pt-5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Subjects
          </Text>
        )}
        {subjects.map((subject) => (
          <NavItem
            key={subject.id}
            href={{ pathname: '/subjects/[subjectId]', params: { subjectId: String(subject.id) } }}
            label={subject.name}
            compact={compact}
            active={pathname === `/subjects/${subject.id}` || readingSubjectId === subject.id}
            leading={<SubjectIcon subject={subject} size="sm" />}
            trailing={
              subject.note_count > 0 ? (
                <Text className="text-xs tabular-nums text-muted-foreground">{subject.note_count}</Text>
              ) : null
            }
          />
        ))}
      </ScrollView>

      <View className={cn('gap-2 border-t border-border py-3', compact ? 'items-center' : 'px-3')}>
        {error && (
          <Button
            variant="ghost"
            size={compact ? 'icon' : 'default'}
            className="justify-start"
            accessibilityLabel="Server offline, retry"
            onPress={fetchSubjects}>
            <Icon as={WifiOff} size={16} className="text-destructive" />
            {!compact && (
              <>
                <Text className="flex-1 text-destructive">Server offline</Text>
                <Icon as={RefreshCw} size={14} className="text-muted-foreground" />
              </>
            )}
          </Button>
        )}
        <ThemeToggle compact={compact} />
      </View>
    </View>
  );
}

function NavItem({
  href,
  label,
  active,
  compact,
  leading,
  trailing,
}: {
  href: Href;
  label: string;
  active: boolean;
  compact: boolean;
  leading: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <Link href={href} asChild>
      <Pressable
        accessibilityLabel={label}
        className={cn(
          'flex-row items-center rounded-md web:transition-colors web:hover:bg-accent',
          compact ? 'size-11 justify-center' : 'gap-3 px-2 py-1.5',
          active && 'bg-accent'
        )}>
        {leading}
        {!compact && (
          <>
            <Text className={cn('flex-1 text-sm', active ? 'font-semibold' : 'text-foreground/80')} numberOfLines={1}>
              {label}
            </Text>
            {trailing}
          </>
        )}
      </Pressable>
    </Link>
  );
}
