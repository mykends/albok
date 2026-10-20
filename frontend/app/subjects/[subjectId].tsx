import { EmptyState } from '@/components/empty-state';
import { ErrorBanner, Page } from '@/components/layout';
import { BooksTab } from '@/components/professor/books-tab';
import { PresetsTab } from '@/components/professor/presets-tab';
import { PreviewTab } from '@/components/professor/preview-tab';
import { SettingsTab } from '@/components/professor/settings-tab';
import { useBooks } from '@/components/professor/use-books';
import { SubjectIcon } from '@/components/subject-icon';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Text } from '@/components/ui/text';
import { api, type ProfessorSubject } from '@/lib/api';
import { errorMessage } from '@/lib/i18n';
import { useProfessor } from '@/stores/professor-store';
import { useLocalSearchParams } from 'expo-router';
import Head from 'expo-router/head';
import { CircleAlert, Eye, Library, ListChecks, Settings } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

type Tab = 'books' | 'presets' | 'preview' | 'settings';

export default function SubjectScreen() {
  const { t } = useTranslation();
  const subjectId = Number(useLocalSearchParams<{ subjectId: string }>().subjectId);
  const replaceSubject = useProfessor((state) => state.replaceSubject);
  const [subject, setSubject] = useState<ProfessorSubject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('books');
  const books = useBooks(subjectId);

  useEffect(() => {
    setSubject(null);
    setError(null);
    setTab('books');
    api
      .subject(subjectId)
      .then(setSubject)
      .catch((e) => setError(errorMessage(e)));
  }, [subjectId]);

  if (error) {
    return (
      <Page>
        <EmptyState icon={CircleAlert} title={t('professor.subjectUnavailable')} description={error} />
      </Page>
    );
  }
  if (!subject) {
    return (
      <Page>
        <Skeleton className="h-16 w-80 rounded-xl" />
      </Page>
    );
  }

  return (
    <Page>
      <Head>
        <title>{`${subject.name} · Albok`}</title>
      </Head>
      <View className="flex-row flex-wrap items-center gap-4">
        <SubjectIcon subject={subject} size="lg" />
        <View className="min-w-48 flex-1">
          <Text className="text-3xl font-bold tracking-tight">{subject.name}</Text>
          <Text className="text-muted-foreground">
            {subject.classes.length ? subject.classes.map((c) => c.name).join(', ') : t('professor.noClassesThisYear')}
          </Text>
        </View>
      </View>
      {books.error && <ErrorBanner message={books.error} onRetry={books.refresh} />}

      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)} className="gap-6">
        <TabsList>
          <TabsTrigger value="books" className="px-3">
            <Icon as={Library} size={14} />
            <Text>{t('professor.tabs.books')}</Text>
          </TabsTrigger>
          <TabsTrigger value="presets" className="px-3">
            <Icon as={ListChecks} size={14} />
            <Text>{t('professor.tabs.presets')}</Text>
          </TabsTrigger>
          <TabsTrigger value="preview" className="px-3">
            <Icon as={Eye} size={14} />
            <Text>{t('professor.tabs.preview')}</Text>
          </TabsTrigger>
          <TabsTrigger value="settings" className="px-3">
            <Icon as={Settings} size={14} />
            <Text>{t('professor.tabs.settings')}</Text>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="books" className="gap-4">
          <BooksTab subject={subject} books={books} />
        </TabsContent>
        <TabsContent value="presets" className="gap-4">
          {tab === 'presets' && <PresetsTab subject={subject} books={books.books ?? []} onApplied={books.replaceAll} />}
        </TabsContent>
        <TabsContent value="preview" className="gap-4">
          {tab === 'preview' && <PreviewTab subject={subject} />}
        </TabsContent>
        <TabsContent value="settings" className="gap-4">
          <SettingsTab
            subject={subject}
            onSaved={(updated) => {
              setSubject(updated);
              replaceSubject(updated);
            }}
          />
        </TabsContent>
      </Tabs>
    </Page>
  );
}
