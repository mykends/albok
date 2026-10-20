import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { Square, SquareCheckBig } from 'lucide-react-native';
import { Pressable } from 'react-native';

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Pressable
      role="checkbox"
      aria-checked={checked}
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={6}
      onPress={() => onChange(!checked)}
      className={cn('flex-row items-center gap-2', disabled && 'opacity-50', className)}>
      <Icon as={checked ? SquareCheckBig : Square} size={18} className={checked ? 'text-primary' : 'text-muted-foreground'} />
      {label && <Text className="text-sm">{label}</Text>}
    </Pressable>
  );
}
