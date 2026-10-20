import { Panel } from '@/components/admin/panel';
import { Grid } from '@/components/layout';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { api, type Storage } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { errorMessage } from '@/lib/i18n';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

export function StorageTab() {
  const { t } = useTranslation();
  const [storage, setStorage] = useState<Storage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.storage().then(setStorage).catch((e) => setError(errorMessage(e)));
  }, []);

  if (error) return <Text className="text-destructive">{error}</Text>;
  if (!storage) return <Skeleton className="h-40 rounded-xl" />;

  const stats = [
    { label: t('admin.storage.total'), value: storage.total_bytes },
    { label: t('admin.storage.originals'), value: storage.originals_bytes },
    { label: t('admin.storage.pdfs'), value: storage.pdf_bytes },
    { label: t('admin.storage.cache'), value: storage.cache_bytes },
  ];
  return (
    <View className="gap-6">
      <Grid minItemWidth={200}>
        {stats.map((stat) => (
          <View key={stat.label} className="gap-1 rounded-xl border border-border bg-card p-4">
            <Text className="text-sm text-muted-foreground">{stat.label}</Text>
            <Text className="text-2xl font-semibold tabular-nums">{formatBytes(stat.value)}</Text>
          </View>
        ))}
      </Grid>
      {storage.free_bytes !== null && (
        <Text className="text-muted-foreground">{t('admin.storage.free', { free: formatBytes(storage.free_bytes) })}</Text>
      )}
      <Panel title={t('admin.storage.byProfessor')}>
        {storage.by_professor.length === 0 && <Text className="text-sm text-muted-foreground">{t('admin.storage.empty')}</Text>}
        {storage.by_professor.map((row) => (
          <View key={row.professor_id} className="flex-row items-center gap-3">
            <Text className="flex-1">{row.professor_name}</Text>
            <Text className="text-sm text-muted-foreground">{t('admin.storage.books', { count: row.book_count })}</Text>
            <Text className="w-24 text-right tabular-nums">{formatBytes(row.bytes)}</Text>
          </View>
        ))}
      </Panel>
    </View>
  );
}
