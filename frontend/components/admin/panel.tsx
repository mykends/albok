import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';
import { View } from 'react-native';

export function Panel({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <View className={cn('gap-4 rounded-xl border border-border bg-card p-5', className)}>
      <View className="gap-1">
        <Text className="text-lg font-semibold">{title}</Text>
        {description && <Text className="text-sm text-muted-foreground">{description}</Text>}
      </View>
      {children}
    </View>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View className="gap-1.5">
      <Text className="text-sm font-medium">{label}</Text>
      {children}
    </View>
  );
}
