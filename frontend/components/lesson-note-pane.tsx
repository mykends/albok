import { LessonNoteEditor } from '@/components/lesson-note-editor';
import { Text } from '@/components/ui/text';
import { api, type Note } from '@/lib/api';
import { errorMessage } from '@/lib/i18n';
import { useNoteSync } from '@/lib/note-sync';
import { cn } from '@/lib/utils';
import { useStudent } from '@/stores/student-store';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, useWindowDimensions, View } from 'react-native';

/** During a lesson: this lesson's note, then earlier notes of the subject (read-only).
 * Outside lessons: the subject's notes, all editable. Sits beside the material as a side panel,
 * or takes half the screen when `half`. */
export function LessonNotePane({ subjectId, half }: { subjectId: number; half?: boolean }) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const now = useStudent((state) => state.now);
  const saved = useNoteSync((state) => state.saved);
  const lessonId = now?.lesson?.subject_id === subjectId ? now.lesson.id : null;
  const [current, setCurrent] = useState<Note | null>(null);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([api.notes(subjectId), lessonId ? api.note(lessonId) : Promise.resolve(null)])
      .then(([list, note]) => {
        if (cancelled) return;
        setNotes(list.filter((n) => n.lesson_id !== lessonId));
        setCurrent(note);
      })
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [subjectId, lessonId, now?.mode]);

  const currentNote = current && (saved[current.lesson_id] ?? current);
  // A note being written fills the pane (less its p-4), like a notebook page; read-only notes stay compact.
  const sheet = viewport ? { height: viewport - 32 } : undefined;

  return (
    <View
      className={cn('border-l border-border bg-muted/30', half ? 'flex-1' : width < 1100 ? 'w-80' : 'w-[26rem]')}
      onLayout={(event) => setViewport(event.nativeEvent.layout.height)}>
      <ScrollView contentContainerClassName="gap-5 p-4">
        {error && <Text className="text-sm text-destructive">{error}</Text>}
        {currentNote && (
          <View className="gap-2" style={sheet}>
            <Text className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('notes.thisLesson')}</Text>
            <Text className="font-semibold">{currentNote.title}</Text>
            <LessonNoteEditor note={currentNote} autoFocus paged />
          </View>
        )}
        {!lessonId && now?.lesson && (
          <Text className="text-sm text-muted-foreground">{t('notes.otherSubjectLesson', { subject: now.lesson.subject_name })}</Text>
        )}
        {notes && notes.length > 0 && (
          <View className="gap-4">
            {notes.map((note, n) => (
              <View key={note.lesson_id} className="gap-1.5" style={note.editable ? sheet : undefined}>
                {/* Inside the first note, so the heading and a full-height note fit the pane together. */}
                {n === 0 && (
                  <Text className="pb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {lessonId ? t('notes.earlier') : t('notes.subjectNotes')}
                  </Text>
                )}
                <Text className="text-sm font-semibold">{note.title}</Text>
                <LessonNoteEditor note={saved[note.lesson_id] ?? note} minHeight="min-h-24" paged />
              </View>
            ))}
          </View>
        )}
        {notes && notes.length === 0 && !currentNote && (
          <Text className="text-sm text-muted-foreground">{t('notes.noneForSubject')}</Text>
        )}
      </ScrollView>
    </View>
  );
}
