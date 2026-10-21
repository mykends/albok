import { SignOutButton } from '@/components/sign-out-button';
import { SubjectIcon } from '@/components/subject-icon';
import { ThemeToggle } from '@/components/theme-toggle';
import { WebToolLayer } from '@/components/web-tools/web-tool-layer';
import { WebToolNotice } from '@/components/web-tools/web-tool-notice';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { formatTime } from '@/lib/format';
import { webToolMode } from '@/lib/kiosk';
import { cn } from '@/lib/utils';
import { useProfessor } from '@/stores/professor-store';
import { useSession } from '@/stores/session-store';
import { useStudent } from '@/stores/student-store';
import { useWebTools } from '@/stores/web-tools-store';
import { Link, useGlobalSearchParams, usePathname, type Href } from 'expo-router';
import {
  BookOpen,
  CalendarDays,
  Clock,
  GraduationCap,
  HardDrive,
  NotebookPen,
  Presentation,
  School,
  Shuffle,
  Upload,
  Users,
  type LucideIcon,
} from 'lucide-react-native';
import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';

const COMPACT_BELOW = 900;
// Lessons change on the bell; polling this often keeps the time rule visible within seconds.
const STUDENT_POLL_MS = 20_000;
// During a lesson the open web tools are polled faster, so opening or closing one reaches students in seconds.
const WEB_TOOLS_POLL_MS = 5_000;
// Shows the "Current lesson" entry and keeps the home panel's lessons fresh.
const PROFESSOR_POLL_MS = 20_000;

export function AppShell({ children }: { children: ReactNode }) {
  const me = useSession((state) => state.me);
  if (!me) return <>{children}</>;
  if (me.is_student && !me.is_professor && !me.is_admin) return <StudentShell>{children}</StudentShell>;
  return <StaffShell>{children}</StaffShell>;
}

function Logo({ subtitle }: { subtitle?: string }) {
  return (
    <View className="flex-row items-center gap-2.5">
      <View className="size-9 items-center justify-center rounded-lg bg-primary">
        <Icon as={GraduationCap} size={20} className="text-primary-foreground" />
      </View>
      <View>
        <Text className="text-base font-bold leading-5">Albok</Text>
        {subtitle && <Text className="text-xs text-muted-foreground">{subtitle}</Text>}
      </View>
    </View>
  );
}

// --- Students ---------------------------------------------------------------------------------

function StudentShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const me = useSession((state) => state.me)!;
  const now = useStudent((state) => state.now);
  const refresh = useStudent((state) => state.refresh);
  const pollWebTools = useWebTools((state) => state.poll);
  const clearWebTools = useWebTools((state) => state.clear);
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const lessonId = now?.lesson?.id ?? null;

  useEffect(() => {
    refresh();
    const timer = setInterval(() => refresh(), STUDENT_POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // Web tools exist only during a lesson; a new lesson (or signing out) starts with none.
  useEffect(() => {
    if (lessonId === null || webToolMode() === 'hidden') return;
    void pollWebTools();
    const timer = setInterval(() => pollWebTools(), WEB_TOOLS_POLL_MS);
    return () => {
      clearInterval(timer);
      void clearWebTools();
    };
  }, [lessonId, pollWebTools, clearWebTools]);

  return (
    <View className="flex-1 bg-background">
      <View className="flex-row items-center gap-4 border-b border-border bg-muted/40 px-4 py-2.5">
        <Logo />
        <View className="flex-row gap-1">
          <TopLink
            href="/"
            icon={BookOpen}
            label={t('nav.material')}
            active={pathname === '/' || pathname.startsWith('/read') || pathname === '/lesson'}
          />
          <TopLink href="/notes" icon={NotebookPen} label={t('nav.notebook')} active={pathname === '/notes'} />
        </View>
        <View className="flex-1 items-center">
          {now && (
            <View
              className={cn(
                'flex-row items-center gap-2 rounded-full px-3 py-1',
                now.lesson ? 'bg-primary' : 'bg-secondary'
              )}>
              <Icon as={Clock} size={14} className={now.lesson ? 'text-primary-foreground' : 'text-muted-foreground'} />
              <Text className={cn('text-sm', now.lesson ? 'font-medium text-primary-foreground' : 'text-muted-foreground')}>
                {now.lesson
                  ? t('lesson.now', {
                      subject: now.lesson.subject_name,
                      start: formatTime(now.lesson.starts_at),
                      end: formatTime(now.lesson.ends_at),
                    })
                  : t('lesson.free')}
              </Text>
            </View>
          )}
        </View>
        {width >= COMPACT_BELOW && (
          <Text className="text-sm text-muted-foreground" numberOfLines={1}>
            {me.display_name}
            {me.class_names.length ? ` · ${me.class_names.join(', ')}` : ''}
          </Text>
        )}
        <SignOutButton compact={width < COMPACT_BELOW} />
      </View>
      <View className="flex-1">{children}</View>
      <WebToolLayer />
      <WebToolNotice />
    </View>
  );
}

function TopLink({ href, icon, label, active }: { href: Href; icon: LucideIcon; label: string; active: boolean }) {
  return (
    <Link href={href} asChild>
      <Pressable
        className={cn(
          'flex-row items-center gap-2 rounded-md px-3 py-1.5 web:transition-colors web:hover:bg-accent',
          active && 'bg-accent'
        )}>
        <Icon as={icon} size={16} />
        <Text className={cn('text-sm', active ? 'font-semibold' : 'text-foreground/80')}>{label}</Text>
      </Pressable>
    </Link>
  );
}

// --- Professors and admins -----------------------------------------------------------------------

const ADMIN_LINKS: { tab: string; icon: LucideIcon; label: string }[] = [
  { tab: 'year', icon: CalendarDays, label: 'admin.tabs.year' },
  { tab: 'classes', icon: School, label: 'admin.tabs.classes' },
  { tab: 'import', icon: Upload, label: 'admin.tabs.import' },
  { tab: 'timetable', icon: Clock, label: 'admin.tabs.timetable' },
  { tab: 'overrides', icon: Shuffle, label: 'admin.tabs.overrides' },
  { tab: 'users', icon: Users, label: 'admin.tabs.users' },
  { tab: 'storage', icon: HardDrive, label: 'admin.tabs.storage' },
];

function StaffShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const me = useSession((state) => state.me)!;
  const subjects = useProfessor((state) => state.subjects);
  const refresh = useProfessor((state) => state.refresh);
  const teaching = useProfessor((state) => state.teaching);
  const refreshTeaching = useProfessor((state) => state.refreshTeaching);
  const pathname = usePathname();
  const adminTab = useGlobalSearchParams<{ tab?: string }>().tab ?? 'year';
  const { width } = useWindowDimensions();
  const compact = width < COMPACT_BELOW;

  useEffect(() => {
    if (me.is_professor) refresh();
  }, [me.is_professor, refresh]);

  useEffect(() => {
    if (!me.is_professor) return;
    void refreshTeaching();
    const timer = setInterval(() => refreshTeaching(), PROFESSOR_POLL_MS);
    return () => clearInterval(timer);
  }, [me.is_professor, refreshTeaching]);

  return (
    <View className="flex-1 flex-row bg-background">
      <View className={cn('border-r border-border bg-muted/40', compact ? 'w-16 items-center' : 'w-64')}>
        <View className={cn('py-5', compact ? 'items-center' : 'px-5')}>
          {compact ? <Logo /> : <Logo subtitle={me.is_professor ? t('nav.forProfessors') : t('nav.forAdmins')} />}
        </View>
        <ScrollView className="flex-1" contentContainerClassName={cn('gap-1 pb-4', compact ? 'items-center' : 'px-3')}>
          {me.is_professor && (
            <>
              {teaching.length > 0 && (
                // The home screen holds the panel that opens web tools; without this, a professor
                // publishing on a subject screen has no way back to it.
                <View className={compact ? 'pt-1' : 'pt-3'}>
                  <NavItem
                    href="/"
                    label={t('nav.currentLesson')}
                    compact={compact}
                    active={pathname === '/'}
                    leading={
                      <View className="size-7 items-center justify-center rounded-md bg-primary">
                        <Icon as={Presentation} size={16} className="text-primary-foreground" />
                      </View>
                    }
                  />
                </View>
              )}
              <SectionLabel compact={compact} label={t('nav.mySubjects')} />
              {subjects.map((subject) => (
                <NavItem
                  key={subject.id}
                  href={{ pathname: '/subjects/[subjectId]', params: { subjectId: String(subject.id) } }}
                  label={subject.name}
                  compact={compact}
                  active={pathname === `/subjects/${subject.id}`}
                  leading={<SubjectIcon subject={subject} size="sm" />}
                />
              ))}
              {subjects.length === 0 && !compact && (
                <Text className="px-3 text-sm text-muted-foreground">{t('professor.noSubjectsShort')}</Text>
              )}
            </>
          )}
          {me.is_admin && (
            <>
              <SectionLabel compact={compact} label={t('nav.administration')} />
              {ADMIN_LINKS.map(({ tab, icon, label }) => (
                <NavItem
                  key={tab}
                  href={{ pathname: '/admin', params: { tab } }}
                  label={t(label)}
                  compact={compact}
                  active={pathname === '/admin' && adminTab === tab}
                  leading={
                    <View className="size-7 items-center justify-center">
                      <Icon as={icon} size={16} />
                    </View>
                  }
                />
              ))}
            </>
          )}
        </ScrollView>
        <View className={cn('gap-1 border-t border-border py-3', compact ? 'items-center' : 'px-3')}>
          {!compact && (
            <Text className="px-3 pb-1 text-sm font-medium" numberOfLines={1}>
              {me.display_name}
            </Text>
          )}
          <ThemeToggle compact={compact} />
          <SignOutButton compact={compact} />
        </View>
      </View>
      <View className="flex-1">{children}</View>
    </View>
  );
}

function SectionLabel({ compact, label }: { compact: boolean; label: string }) {
  return compact ? (
    <View className="my-2 h-px w-8 bg-border" />
  ) : (
    <Text className="px-3 pb-1 pt-5 text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</Text>
  );
}

function NavItem({
  href,
  label,
  active,
  compact,
  leading,
}: {
  href: Href;
  label: string;
  active: boolean;
  compact: boolean;
  leading: ReactNode;
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
          <Text className={cn('flex-1 text-sm', active ? 'font-semibold' : 'text-foreground/80')} numberOfLines={1}>
            {label}
          </Text>
        )}
      </Pressable>
    </Link>
  );
}
