import { EmptyState } from '@/components/empty-state';
import { Page } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { Link } from 'expo-router';
import { CircleAlert } from 'lucide-react-native';

export default function NotFoundScreen() {
  return (
    <Page>
      <EmptyState icon={CircleAlert} title="Page not found" description="This page doesn't exist.">
        <Link href="/" asChild>
          <Button>
            <Text>Back to dashboard</Text>
          </Button>
        </Link>
      </EmptyState>
    </Page>
  );
}
