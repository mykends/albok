import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { Check, ChevronDown } from 'lucide-react-native';
import { ScrollView } from 'react-native';

export type Option<T> = { value: T; label: string };

export function Select<T extends string | number | null>({
  value,
  options,
  onChange,
  placeholder,
  className,
}: {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  className?: string;
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className={cn('justify-between', className)}>
          <Text className={cn('shrink', !selected && 'text-muted-foreground')} numberOfLines={1}>
            {selected?.label ?? placeholder ?? ''}
          </Text>
          <Icon as={ChevronDown} className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <ScrollView className="max-h-80">
          {options.map((option) => (
            <DropdownMenuItem key={String(option.value)} onPress={() => onChange(option.value)}>
              <Text className="flex-1" numberOfLines={1}>
                {option.label}
              </Text>
              {option.value === value && <Icon as={Check} size={14} />}
            </DropdownMenuItem>
          ))}
        </ScrollView>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
