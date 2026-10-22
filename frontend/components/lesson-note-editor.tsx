import { RichNoteEditor } from '@/components/rich-note-editor';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import type { Note } from '@/lib/api';
import { localDraft, useNoteSync, writeDraft } from '@/lib/note-sync';
import { cn } from '@/lib/utils';
import { openSection } from '@/components/student-home';
import { BookOpen, Check, CloudOff, Loader, TriangleAlert } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

/** One lesson's note, with formatting. Typing is saved to this device at once and synced in the
 * background. `paged` fills the parent's height and turns pages instead of growing. */
export function LessonNoteEditor({
  note,
  autoFocus,
  minHeight = 'min-h-64',
  paged,
}: {
  note: Note;
  autoFocus?: boolean;
  minHeight?: string;
  paged?: boolean;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(() => localDraft(note.lesson_id) ?? note.content);
  const status = useNoteSync((state) => state.status[note.lesson_id]);
  const error = useNoteSync((state) => state.errors[note.lesson_id]);
  const pages = paged && note.editable;
  const onChange = (value: string) => {
    setText(value);
    writeDraft(note.lesson_id, value);
  };

  // A different lesson (or a fresh server copy with no local edits) replaces the text.
  useEffect(() => {
    setText(localDraft(note.lesson_id) ?? note.content);
  }, [note.lesson_id, note.content]);

  return (
    <View className={cn('gap-2', pages && 'flex-1')}>
      {note.editable || text ? (
        <RichNoteEditor
          value={text}
          onChange={onChange}
          editable={note.editable}
          autoFocus={autoFocus}
          placeholder={t('notes.placeholder')}
          paged={pages}
          minHeight={note.editable ? minHeight : undefined}
          status={<SyncBadge status={status} error={error} />}
        />
      ) : (
        <View className="rounded-md border border-border bg-muted/40 px-3 py-2">
          <Text className="leading-6 text-muted-foreground">{t('notes.empty')}</Text>
        </View>
      )}
      {!pages && (
        <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
          {note.editable && <SyncBadge status={status} error={error} />}
          {!note.editable && <Text className="text-xs text-muted-foreground">{t('notes.readOnly')}</Text>}
        </View>
      )}
      {note.sections.length > 0 && (
        <View className="flex-row flex-wrap gap-1.5">
          {note.sections.map((section) => (
            <Pressable
              key={section.id}
              disabled={!section.available}
              onPress={() => openSection(section.id)}
              className={cn(
                'flex-row items-center gap-1 rounded-full border border-border px-2 py-0.5',
                section.available ? 'web:hover:bg-accent' : 'opacity-60'
              )}>
              <Icon as={BookOpen} size={12} className="text-muted-foreground" />
              <Text className="text-xs" numberOfLines={1}>
                {section.title}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function SyncBadge({ status, error }: { status?: string; error?: string }) {
  const { t } = useTranslation();
  const states = {
    saved: { icon: Check, label: t('notes.status.saved'), tone: 'text-muted-foreground' },
    pending: { icon: Loader, label: t('notes.status.pending'), tone: 'text-muted-foreground' },
    saving: { icon: Loader, label: t('notes.status.saving'), tone: 'text-muted-foreground' },
    offline: { icon: CloudOff, label: t('notes.status.offline'), tone: 'text-warning' },
    rejected: { icon: TriangleAlert, label: error ?? t('notes.status.rejected'), tone: 'text-destructive' },
  } as const;
  const state = states[(status as keyof typeof states) ?? 'saved'] ?? states.saved;
  if (!status) return null;
  return (
    <View className="flex-row items-center gap-1">
      <Icon as={state.icon} size={12} className={state.tone} />
      <Text className={cn('text-xs', state.tone)}>{state.label}</Text>
    </View>
  );
}
