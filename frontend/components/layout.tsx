import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { CircleAlert } from 'lucide-react-native';
import { Children, useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <ScrollView className="flex-1" contentContainerClassName={cn('mx-auto w-full max-w-6xl gap-8 px-6 py-8 md:px-10', className)}>
      {children}
    </ScrollView>
  );
}

export function PageSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <View className="gap-4">
      <View className="flex-row items-center justify-between gap-4">
        <Text className="text-lg font-semibold">{title}</Text>
        {action}
      </View>
      {children}
    </View>
  );
}

/** Responsive grid: as many columns of at least `minItemWidth` as fit the measured width. */
export function Grid({ children, minItemWidth = 260, gap = 16 }: { children: ReactNode; minItemWidth?: number; gap?: number }) {
  const [width, setWidth] = useState(0);
  const columns = Math.max(1, Math.floor((width + gap) / (minItemWidth + gap)));
  const itemWidth = width ? Math.floor((width - gap * (columns - 1)) / columns) : undefined;

  return (
    <View className="flex-row flex-wrap" style={{ gap }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {Children.map(children, (child) => (
        <View style={{ width: itemWidth ?? '100%' }}>{child}</View>
      ))}
    </View>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View className="flex-row items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3">
      <Icon as={CircleAlert} size={18} className="text-destructive" />
      <Text className="flex-1 text-sm">{message}</Text>
      {onRetry && (
        <Button variant="outline" size="sm" onPress={onRetry}>
          <Text>Retry</Text>
        </Button>
      )}
    </View>
  );
}
