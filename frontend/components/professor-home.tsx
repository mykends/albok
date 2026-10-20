import { EmptyState } from '@/components/empty-state';
import { ErrorBanner, Grid, Page, PageSection } from '@/components/layout';
import { SubjectIcon } from '@/components/subject-icon';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import type { ProfessorSubject } from '@/lib/api';
import { formatDateLong } from '@/lib/format';
import { useProfessor } from '@/stores/professor-store';
import { serverNow, useSession } from '@/stores/session-store';
import { router } from 'expo-router';
import Head from 'expo-router/head';
import { CalendarX } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

export function ProfessorHome() {
  const { t } = useTranslation();
  const me = useSession((state) => state.me)!;
  const subjects = useProfessor((state) => state.subjects);
  const status = useProfessor((state) => state.status);
  const error = useProfessor((state) => state.error);
  const refresh = useProfessor((state) => state.refresh);

  return (
    <Page>
      <Head>
        <title>{`${t('nav.mySubjects')} · Albok`}</title>
      </Head>
      <View className="gap-1">
        <Text className="text-3xl font-bold tracking-tight">{t('professor.hello', { name: me.display_name.split(' ')[0] })}</Text>
        <Text className="text-muted-foreground">{formatDateLong(serverNow())}</Text>
      </View>
      {error && <ErrorBanner message={error} onRetry={refresh} />}
      <PageSection title={t('nav.mySubjects')}>
        {status === 'loading' || status === 'idle' ? (
          <Grid>{[0, 1].map((n) => <Skeleton key={n} className="h-40 rounded-xl" />)}</Grid>
        ) : subjects.length === 0 ? (
          <EmptyState icon={CalendarX} title={t('professor.noSubjectsTitle')} description={t('professor.noSubjects')} />
        ) : (
          <Grid minItemWidth={300}>
            {subjects.map((subject) => (
              <SubjectCard key={subject.id} subject={subject} />
            ))}
          </Grid>
        )}
      </PageSection>
    </Page>
  );
}

function SubjectCard({ subject }: { subject: ProfessorSubject }) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/subjects/[subjectId]', params: { subjectId: String(subject.id) } })}
      className="h-full gap-4 rounded-xl border border-border bg-card p-5 web:transition-colors web:hover:border-ring/60">
      <View className="flex-row items-center gap-3">
        <SubjectIcon subject={subject} size="lg" />
        <View className="flex-1">
          <Text className="text-lg font-semibold">{subject.name}</Text>
          <Text className="text-sm text-muted-foreground" numberOfLines={1}>
            {subject.description || t('professor.booksAndSections', { books: subject.book_count, sections: subject.section_count })}
          </Text>
        </View>
      </View>
      <View className="flex-row flex-wrap gap-1.5">
        {subject.classes.length ? (
          subject.classes.map((c) => (
            <Badge key={c.id} variant="secondary">
              <Text>{c.name}</Text>
            </Badge>
          ))
        ) : (
          <Text className="text-sm text-muted-foreground">{t('professor.noClassesThisYear')}</Text>
        )}
      </View>
    </Pressable>
  );
}
