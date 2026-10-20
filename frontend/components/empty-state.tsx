import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import type { LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { View } from 'react-native';

export function EmptyState({
  icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <View className="items-center justify-center gap-3 rounded-xl border border-dashed border-border px-6 py-12">
      <View className="size-12 items-center justify-center rounded-full bg-muted">
        <Icon as={icon} size={22} className="text-muted-foreground" />
      </View>
      <Text className="text-lg font-semibold">{title}</Text>
      <Text className="max-w-md text-center text-muted-foreground">{description}</Text>
      {children}
    </View>
  );
}
