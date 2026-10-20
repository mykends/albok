import { Icon } from '@/components/ui/icon';
import type { Subject } from '@/lib/api';
import { subjectIcon, tint } from '@/lib/subjects';
import { cn } from '@/lib/utils';
import { View } from 'react-native';

const SIZES = {
  sm: { box: 'size-7 rounded-md', icon: 14 },
  md: { box: 'size-9 rounded-lg', icon: 18 },
  lg: { box: 'size-12 rounded-xl', icon: 24 },
};

export function SubjectIcon({
  subject,
  size = 'md',
}: {
  subject: Pick<Subject, 'color' | 'icon'>;
  size?: keyof typeof SIZES;
}) {
  return (
    <View
      className={cn('items-center justify-center', SIZES[size].box)}
      style={{ backgroundColor: tint(subject.color, 0.14) }}>
      <Icon as={subjectIcon(subject.icon)} size={SIZES[size].icon} color={subject.color} />
    </View>
  );
}
