import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import type { Note, Subject } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { BookOpen, Pin } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

export function NoteCard({
  note,
  subject,
  onPress,
  showSection = true,
  className,
}: {
  note: Note;
  /** Show which subject the note belongs to (used on the dashboard). */
  subject?: Subject;
  onPress: () => void;
  showSection?: boolean;
  className?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={cn(
        'gap-2 rounded-xl border border-border bg-card p-4 web:transition-colors web:hover:border-ring/60',
        className
      )}>
      <View className="flex-row items-start gap-2">
        <Text className="flex-1 font-semibold" numberOfLines={1}>
          {note.title || 'Untitled note'}
        </Text>
        {note.pinned && <Icon as={Pin} size={14} className="text-muted-foreground" />}
      </View>
      {!!note.content && (
        <Text className="text-sm leading-5 text-muted-foreground" numberOfLines={4}>
          {note.content}
        </Text>
      )}
      <View className="mt-auto flex-row flex-wrap items-center gap-2 pt-1">
        {subject && (
          <Badge variant="outline">
            <View className="size-2 rounded-full" style={{ backgroundColor: subject.color }} />
            <Text>{subject.name}</Text>
          </Badge>
        )}
        {showSection && note.section_title && (
          <Badge variant="secondary" className="max-w-56">
            <Icon as={BookOpen} size={12} />
            <Text numberOfLines={1}>{note.section_title}</Text>
          </Badge>
        )}
        <Text className="text-xs text-muted-foreground">{formatRelative(note.updated_at)}</Text>
      </View>
    </Pressable>
  );
}
