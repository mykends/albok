import { ClassesTab } from '@/components/admin/classes-tab';
import { ImportTab } from '@/components/admin/import-tab';
import { OverridesTab } from '@/components/admin/overrides-tab';
import { StorageTab } from '@/components/admin/storage-tab';
import { TimetableTab } from '@/components/admin/timetable-tab';
import { UsersTab } from '@/components/admin/users-tab';
import { YearTab } from '@/components/admin/year-tab';
import { Page } from '@/components/layout';
import { Text } from '@/components/ui/text';
import { useLocalSearchParams } from 'expo-router';
import Head from 'expo-router/head';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

const TABS = {
  year: YearTab,
  classes: ClassesTab,
  import: ImportTab,
  timetable: TimetableTab,
  overrides: OverridesTab,
  users: UsersTab,
  storage: StorageTab,
} as const;

export default function AdminScreen() {
  const { t } = useTranslation();
  const tab = (useLocalSearchParams<{ tab?: string }>().tab ?? 'year') as keyof typeof TABS;
  const Tab = TABS[tab] ?? YearTab;

  return (
    <Page>
      <Head>
        <title>{`${t(`admin.tabs.${tab}`)} · Albok`}</title>
      </Head>
      <View className="gap-1">
        <Text className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('nav.administration')}</Text>
        <Text className="text-3xl font-bold tracking-tight">{t(`admin.tabs.${tab}`)}</Text>
        <Text className="text-muted-foreground">{t(`admin.descriptions.${tab}`)}</Text>
      </View>
      <Tab />
    </Page>
  );
}
