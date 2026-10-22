import { SignOutButton } from '@/components/sign-out-button';
import { SectionList } from '@/components/student-home';
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
  ChevronDown,
  ChevronRight,
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
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';

const COMPACT_BELOW = 900;
// Lessons change on the bell; polling this often keeps the time rule visible within seconds.
const STUDENT_POLL_MS = 20_000;
// During a lesson the open web tools are polled faster, so opening or closing one reaches students in seconds.
const WEB_TOOLS_POLL_MS = 5_000;
// The pointer has to rest on the left edge this long, so passing by on the way to a button doesn't open the menu.
const MENU_OPEN_DELAY_MS = 150;
// Leaving the menu briefly (overshooting it, or crossing to it from the edge) doesn't close it yet.
const MENU_CLOSE_DELAY_MS = 300;
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
  const now = useStudent((state) => state.now);
  const refresh = useStudent((state) => state.refresh);
  const pollWebTools = useWebTools((state) => state.poll);
  const clearWebTools = useWebTools((state) => state.clear);
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

  // No bars: the material gets the whole screen, and navigation waits behind the left edge.
  return (
    <View className="flex-1 bg-background">
      <View className="flex-1">{children}</View>
      <WebToolLayer />
      <WebToolNotice />
      {/* After the tool layer, so the edge still opens the menu while a tool fills the screen. */}
      <StudentMenu />
    </View>
  );
}

/** Students' navigation, floating over the material. Resting the pointer on the left edge (or pressing
 * the handle there) opens it; leaving it, Escape, or opening a screen closes it. */
function StudentMenu() {
  const { t } = useTranslation();
  const me = useSession((state) => state.me)!;
  const now = useStudent((state) => state.now);
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const subjects = now?.subjects ?? [];
  const onlySubjectId = subjects.length === 1 ? subjects[0].id : null;

  const later = (next: boolean, delay: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(next), delay);
  };
  const close = useCallback(() => {
    clearTimeout(timer.current);
    setOpen(false);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => close(), [pathname, close]);

  // During a lesson there is only the lesson's subject, so its sections are shown straight away.
  useEffect(() => {
    if (onlySubjectId !== null) setExpanded(onlySubjectId);
  }, [onlySubjectId]);

  useEffect(() => {
    if (!open || Platform.OS !== 'web') return;
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && close();
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  return (
    <View
      className="absolute inset-y-0 left-0 z-50 w-2"
      onPointerEnter={() => (open ? clearTimeout(timer.current) : later(true, MENU_OPEN_DELAY_MS))}
      onPointerLeave={() => later(false, MENU_CLOSE_DELAY_MS)}>
      <Pressable
        role="button"
        accessibilityLabel={t('nav.menu')}
        onPress={() => later(true, 0)}
        className={cn(
          'absolute left-0 top-1/2 -mt-6 h-12 w-4 items-center justify-center rounded-r-md border border-l-0 border-border bg-muted web:transition-opacity',
          open && 'opacity-0'
        )}>
        <Icon as={ChevronRight} size={12} className="text-muted-foreground" />
      </Pressable>
      {open && (
        <View className="absolute bottom-2 left-2 top-2 w-80 rounded-xl border border-border bg-popover shadow-xl shadow-black/10 web:animate-in web:fade-in-0 web:slide-in-from-left-2">
          <View className="gap-3 border-b border-border p-4">
            <Logo />
            {now && (
              <View
                className={cn(
                  'flex-row items-center gap-2 self-start rounded-full px-3 py-1',
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
          <ScrollView className="flex-1" contentContainerClassName="gap-1 p-3">
            <NavItem
              href="/"
              label={t('nav.material')}
              compact={false}
              active={pathname === '/' || pathname.startsWith('/read') || pathname === '/lesson'}
              leading={<NavIcon icon={BookOpen} />}
            />
            <NavItem
              href="/notes"
              label={t('nav.notebook')}
              compact={false}
              active={pathname === '/notes'}
              leading={<NavIcon icon={NotebookPen} />}
            />
            {subjects.length > 0 && <SectionLabel compact={false} label={t('nav.subjects')} />}
            {subjects.map((subject) => (
              <View key={subject.id}>
                <Pressable
                  role="button"
                  aria-expanded={expanded === subject.id}
                  onPress={() => setExpanded(expanded === subject.id ? null : subject.id)}
                  className="flex-row items-center gap-3 rounded-md px-2 py-1.5 web:transition-colors web:hover:bg-accent">
                  <SubjectIcon subject={subject} size="sm" />
                  <Text className="flex-1 text-sm text-foreground/80" numberOfLines={1}>
                    {subject.name}
                  </Text>
                  <Icon
                    as={expanded === subject.id ? ChevronDown : ChevronRight}
                    size={16}
                    className="text-muted-foreground"
                  />
                </Pressable>
                {expanded === subject.id && (
                  <View className="pb-2 pl-4 pt-2">
                    {subject.sections.length ? (
                      <SectionList sections={subject.sections} />
                    ) : (
                      <Text className="px-2 text-sm text-muted-foreground">{t('student.nothingPublished')}</Text>
                    )}
                  </View>
                )}
              </View>
            ))}
          </ScrollView>
          <View className="gap-1 border-t border-border p-3">
            <Text className="px-3 pb-1 text-sm text-muted-foreground" numberOfLines={1}>
              {me.display_name}
              {me.class_names.length ? ` · ${me.class_names.join(', ')}` : ''}
            </Text>
            <SignOutButton />
          </View>
        </View>
      )}
    </View>
  );
}

function NavIcon({ icon }: { icon: LucideIcon }) {
  return (
    <View className="size-7 items-center justify-center">
      <Icon as={icon} size={16} />
    </View>
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
                  leading={<NavIcon icon={icon} />}
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
