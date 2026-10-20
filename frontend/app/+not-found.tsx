import { EmptyState } from '@/components/empty-state';
import { Page } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { Link } from 'expo-router';
import { CircleAlert } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

export default function NotFoundScreen() {
  const { t } = useTranslation();
  return (
    <Page>
      <EmptyState icon={CircleAlert} title={t('notFound.title')} description={t('notFound.description')}>
        <Link href="/" asChild>
          <Button>
            <Text>{t('notFound.back')}</Text>
            <Text>Back to dash</Text>
          </Button>
        </Link>
      </EmptyState>
    </Page>
  );
}
