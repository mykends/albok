import { LessonNoteEditor } from '@/components/lesson-note-editor';
import { Text } from '@/components/ui/text';
import { api, type Note } from '@/lib/api';
import { errorMessage } from '@/lib/i18n';
import { useNoteSync } from '@/lib/note-sync';
import { cn } from '@/lib/utils';
import { useStudent } from '@/stores/student-store';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

/** During a lesson: this lesson's note, then earlier notes of the subject (read-only).
 * Outside lessons: the subject's notes, all editable. */
export function LessonNotePane({ subjectId, className }: { subjectId: number; className?: string }) {
  const { t } = useTranslation();
  const now = useStudent((state) => state.now);
  const saved = useNoteSync((state) => state.saved);
  const lessonId = now?.lesson?.subject_id === subjectId ? now.lesson.id : null;
  const [current, setCurrent] = useState<Note | null>(null);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <View className={cn('border-l border-border bg-muted/30', className)}>
      <ScrollView contentContainerClassName="gap-5 p-4">
        {error && <Text className="text-sm text-destructive">{error}</Text>}
        {currentNote && (
          <View className="gap-2">
            <Text className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('notes.thisLesson')}</Text>
            <Text className="font-semibold">{currentNote.title}</Text>
            <LessonNoteEditor note={currentNote} autoFocus />
          </View>
        )}
        {!lessonId && now?.lesson && (
          <Text className="text-sm text-muted-foreground">{t('notes.otherSubjectLesson', { subject: now.lesson.subject_name })}</Text>
        )}
        {notes && notes.length > 0 && (
          <View className="gap-4">
            <Text className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {lessonId ? t('notes.earlier') : t('notes.subjectNotes')}
            </Text>
            {notes.map((note) => (
              <View key={note.lesson_id} className="gap-1.5">
                <Text className="text-sm font-semibold">{note.title}</Text>
                <LessonNoteEditor note={saved[note.lesson_id] ?? note} minHeight="min-h-24" />
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
