import { EmptyState } from '@/components/empty-state';
import { SectionList } from '@/components/student-home';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { api, type ProfessorSubject, type StudentSubject } from '@/lib/api';
import { errorMessage } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { router } from 'expo-router';
import { EyeOff } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

/** What students of one class see for this subject outside lessons. */
export function PreviewTab({ subject }: { subject: ProfessorSubject }) {
  const { t } = useTranslation();
  const [classId, setClassId] = useState<number | null>(subject.classes[0]?.id ?? null);
  const [preview, setPreview] = useState<StudentSubject[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (classId === null) return;
    setPreview(null);
    api
      .preview(classId, subject.id)
      .then(setPreview)
      .catch((e) => setError(errorMessage(e)));
  }, [classId, subject.id]);

  if (!subject.classes.length) return <Text className="text-muted-foreground">{t('professor.noClassesThisYear')}</Text>;
  const sections = preview?.[0]?.sections ?? [];

  return (
    <View className="gap-4">
      <View className="flex-row flex-wrap items-center gap-2">
        <Text className="text-sm text-muted-foreground">{t('preview.asClass')}</Text>
        {subject.classes.map((c) => (
          <Pressable
            key={c.id}
            onPress={() => setClassId(c.id)}
            className={cn('rounded-full border border-border px-3 py-1 web:hover:bg-accent', classId === c.id && 'border-primary bg-primary')}>
            <Text className={cn('text-sm', classId === c.id && 'text-primary-foreground')}>{c.name}</Text>
          </Pressable>
        ))}
      </View>
      <Text className="text-sm text-muted-foreground">{t('preview.hint')}</Text>
      {error && <Text className="text-sm text-destructive">{error}</Text>}
      {!preview ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : sections.length === 0 ? (
        <EmptyState icon={EyeOff} title={t('preview.emptyTitle')} description={t('preview.empty')} />
      ) : (
        <View className="max-w-2xl rounded-xl border border-border bg-card p-5">
          <SectionList
            sections={sections}
            onOpen={(id) =>
              router.push({ pathname: '/read/[sectionId]', params: { sectionId: String(id), preview: String(classId) } })
            }
          />
        </View>
      )}
    </View>
  );
}
