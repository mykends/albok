import { EmptyState } from '@/components/empty-state';
import { ErrorBanner, Grid, Page, PageSection } from '@/components/layout';
import { SubjectIcon } from '@/components/subject-icon';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { useOpenWebTool } from '@/components/web-tools/lesson-tabs';
import type { SectionRef, StudentSubject } from '@/lib/api';
import { formatDateLong, formatTime } from '@/lib/format';
import { webToolMode } from '@/lib/kiosk';
import { tint } from '@/lib/subjects';
import { serverNow, useSession } from '@/stores/session-store';
import { useStudent } from '@/stores/student-store';
import { useWebTools } from '@/stores/web-tools-store';
import { router } from 'expo-router';
import Head from 'expo-router/head';
import { AppWindow, BookOpen, ChevronRight, ExternalLink, Library, NotebookPen } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, View } from 'react-native';

export function openSection(sectionId: number) {
  router.push({ pathname: '/read/[sectionId]', params: { sectionId: String(sectionId) } });
}

export function StudentHome() {
  const { t } = useTranslation();
  const me = useSession((state) => state.me)!;
  const now = useStudent((state) => state.now);
  const error = useStudent((state) => state.error);
  const refresh = useStudent((state) => state.refresh);

  return (
    <Page>
      <Head>
        <title>{`${t('nav.material')} · Albok`}</title>
      </Head>
      <View className="gap-1">
        <Text className="text-3xl font-bold tracking-tight">{t('student.hello', { name: me.display_name.split(' ')[0] })}</Text>
        <Text className="text-muted-foreground">{formatDateLong(serverNow())}</Text>
      </View>

      {error && <ErrorBanner message={error} onRetry={() => refresh(false)} />}
      {!now ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : now.lesson ? (
        <LessonCard subject={now.subjects[0]} title={now.lesson.subject_name} time={`${formatTime(now.lesson.starts_at)}–${formatTime(now.lesson.ends_at)}`} />
      ) : now.subjects.length === 0 ? (
        <EmptyState icon={Library} title={t('student.noSubjectsTitle')} description={t('student.noSubjects')} />
      ) : (
        <PageSection title={t('student.allMaterial')}>
          <Text className="-mt-2 text-sm text-muted-foreground">{t('student.freeHint')}</Text>
          <Grid minItemWidth={320}>
            {now.subjects.map((subject) => (
              <SubjectCard key={subject.id} subject={subject} />
            ))}
          </Grid>
        </PageSection>
      )}
    </Page>
  );
}

function LessonCard({ subject, title, time }: { subject?: StudentSubject; title: string; time: string }) {
  const { t } = useTranslation();
  return (
    <View className="gap-5 rounded-2xl border border-border bg-card p-6" style={subject && { borderColor: tint(subject.color, 0.5) }}>
      <View className="flex-row items-center gap-4">
        {subject && <SubjectIcon subject={subject} size="lg" />}
        <View className="flex-1">
          <Text className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('student.nowInClass')}</Text>
          <Text className="text-2xl font-bold">{title}</Text>
          <Text className="text-muted-foreground">
            {time}
            {subject?.professor_name ? ` · ${subject.professor_name}` : ''}
          </Text>
        </View>
        <Button variant="outline" onPress={() => router.push('/notes')}>
          <Icon as={NotebookPen} />
          <Text>{t('student.lessonNotes')}</Text>
        </Button>
      </View>
      {subject && subject.sections.length > 0 ? (
        <SectionList sections={subject.sections} />
      ) : (
        <Text className="text-muted-foreground">{t('student.nothingPublished')}</Text>
      )}
      <WebToolsRow />
    </View>
  );
}

/** The lesson's web tools: the lasting way in once the notice is gone. In the kiosk they open as tabs;
 * elsewhere they are plain links to a new browser tab; an older kiosk shows none (KTD8). */
function WebToolsRow() {
  const { t } = useTranslation();
  const tools = useWebTools((state) => state.tools);
  const openTool = useOpenWebTool();
  const mode = webToolMode();
  if (mode === 'hidden' || tools.length === 0) return null;
  return (
    <View className="gap-2 border-t border-border pt-4">
      <Text className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('webTools.student.row')}</Text>
      <View className="flex-row flex-wrap gap-2">
        {tools.map((tool) =>
          mode === 'tabs' ? (
            <Button key={tool.id} variant="outline" onPress={() => openTool(tool.id)}>
              <Icon as={AppWindow} />
              <Text>{tool.name}</Text>
            </Button>
          ) : (
            <Button key={tool.id} variant="outline" role="link" onPress={() => Linking.openURL(tool.url)}>
              <Icon as={ExternalLink} />
              <Text>{tool.name}</Text>
            </Button>
          )
        )}
      </View>
    </View>
  );
}

function SubjectCard({ subject }: { subject: StudentSubject }) {
  const { t } = useTranslation();
  return (
    <View className="h-full gap-4 rounded-xl border border-border bg-card p-5">
      <View className="flex-row items-center gap-3">
        <SubjectIcon subject={subject} />
        <View className="flex-1">
          <Text className="font-semibold">{subject.name}</Text>
          <Text className="text-sm text-muted-foreground" numberOfLines={1}>
            {subject.professor_name}
          </Text>
        </View>
      </View>
      {subject.sections.length ? (
        <SectionList sections={subject.sections} />
      ) : (
        <Text className="text-sm text-muted-foreground">{t('student.nothingPublished')}</Text>
      )}
    </View>
  );
}

/** Sections grouped under their book titles. */
export function SectionList({ sections, onOpen = openSection }: { sections: SectionRef[]; onOpen?: (id: number) => void }) {
  const { t } = useTranslation();
  const books: { title: string; sections: SectionRef[] }[] = [];
  for (const section of sections) {
    const last = books[books.length - 1];
    if (last && last.title === section.book_title) last.sections.push(section);
    else books.push({ title: section.book_title, sections: [section] });
  }
  return (
    <View className="gap-3">
      {books.map((book, n) => (
        <View key={`${book.title}-${n}`} className="gap-0.5">
          <View className="flex-row items-center gap-1.5 px-2 pb-1">
            <Icon as={BookOpen} size={13} className="text-muted-foreground" />
            <Text className="text-xs font-medium text-muted-foreground">{book.title}</Text>
          </View>
          {book.sections.map((section) => (
            <Pressable
              key={section.id}
              onPress={() => onOpen(section.id)}
              className="flex-row items-center gap-3 rounded-md px-2 py-2 web:transition-colors web:hover:bg-accent">
              <Text className="flex-1" numberOfLines={1}>
                {section.title}
              </Text>
              <Text className="text-xs text-muted-foreground">{t('common.pages', { count: section.page_count })}</Text>
              <Icon as={ChevronRight} size={16} className="text-muted-foreground" />
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}
