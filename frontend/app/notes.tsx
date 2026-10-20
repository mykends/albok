import { EmptyState } from '@/components/empty-state';
import { ErrorBanner, Page } from '@/components/layout';
import { LessonNoteEditor } from '@/components/lesson-note-editor';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { api, type ExportQuota, type Note } from '@/lib/api';
import { formatTime } from '@/lib/format';
import { errorMessage } from '@/lib/i18n';
import { useNoteSync } from '@/lib/note-sync';
import { cn } from '@/lib/utils';
import { useStudent } from '@/stores/student-store';
import Head from 'expo-router/head';
import { Mail, NotebookPen } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

export default function NotebookScreen() {
  const { t } = useTranslation();
  const now = useStudent((state) => state.now);
  const saved = useNoteSync((state) => state.saved);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [current, setCurrent] = useState<Note | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const lessonId = now?.lesson?.id ?? null;
  useEffect(() => {
    let cancelled = false;
    Promise.all([api.notes(), lessonId ? api.note(lessonId) : Promise.resolve(null)])
      .then(([list, note]) => {
        if (cancelled) return;
        setNotes(list.filter((n) => n.lesson_id !== lessonId));
        setCurrent(note);
        setError(null);
      })
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [lessonId, now?.mode]);

  const subjects = useMemo(() => {
    const seen = new Map<number, { id: number; name: string; color: string }>();
    for (const note of notes ?? []) seen.set(note.subject_id, { id: note.subject_id, name: note.subject_name, color: note.subject_color });
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'hr'));
  }, [notes]);
  const visible = (notes ?? []).filter((note) => subjectId === null || note.subject_id === subjectId);

  return (
    <Page>
      <Head>
        <title>{`${t('nav.notebook')} · Albok`}</title>
      </Head>
      <View className="flex-row flex-wrap items-center gap-4">
        <View className="min-w-48 flex-1">
          <Text className="text-3xl font-bold tracking-tight">{t('nav.notebook')}</Text>
          <Text className="text-muted-foreground">{now?.lesson ? t('notes.lessonModeHint') : t('notes.freeModeHint')}</Text>
        </View>
        {!now?.lesson && (
          <Button variant="outline" onPress={() => setExportOpen(true)}>
            <Icon as={Mail} />
            <Text>{t('export.button')}</Text>
          </Button>
        )}
      </View>

      {error && <ErrorBanner message={error} />}

      {current && (
        <View className="gap-3 rounded-2xl border border-border bg-card p-5">
          <Text className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('notes.thisLesson')}</Text>
          <Text className="text-lg font-semibold">{current.title}</Text>
          <LessonNoteEditor note={saved[current.lesson_id] ?? current} autoFocus />
        </View>
      )}

      {subjects.length > 1 && (
        <View className="flex-row flex-wrap gap-2">
          <Chip label={t('notes.allSubjects')} active={subjectId === null} onPress={() => setSubjectId(null)} />
          {subjects.map((subject) => (
            <Chip
              key={subject.id}
              label={subject.name}
              color={subject.color}
              active={subjectId === subject.id}
              onPress={() => setSubjectId(subject.id)}
            />
          ))}
        </View>
      )}

      {!notes ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : visible.length === 0 && !current ? (
        <EmptyState icon={NotebookPen} title={t('notes.emptyTitle')} description={t('notes.emptyDescription')} />
      ) : (
        <View className="gap-4">
          {visible.map((note) => (
            <View key={note.lesson_id} className="gap-2 rounded-xl border border-border bg-card p-4">
              <View className="flex-row items-center gap-2">
                <View className="size-2.5 rounded-full" style={{ backgroundColor: note.subject_color }} />
                <Text className="flex-1 font-semibold">{note.title}</Text>
                <Text className="text-xs text-muted-foreground">{formatTime(note.starts_at)}</Text>
              </View>
              <LessonNoteEditor note={saved[note.lesson_id] ?? note} minHeight="min-h-28" />
            </View>
          ))}
        </View>
      )}

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        subjects={now?.subjects.map((s) => ({ id: s.id, name: s.name })) ?? subjects}
        defaultSubjectId={subjectId}
      />
    </Page>
  );
}

function Chip({ label, color, active, onPress }: { label: string; color?: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className={cn(
        'flex-row items-center gap-1.5 rounded-full border border-border px-3 py-1 web:hover:bg-accent',
        active && 'border-primary bg-primary'
      )}>
      {color && <View className="size-2 rounded-full" style={{ backgroundColor: color }} />}
      <Text className={cn('text-sm', active && 'text-primary-foreground')}>{label}</Text>
    </Pressable>
  );
}

function ExportDialog({
  open,
  onOpenChange,
  subjects,
  defaultSubjectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subjects: { id: number; name: string }[];
  defaultSubjectId: number | null;
}) {
  const { t } = useTranslation();
  const [quota, setQuota] = useState<ExportQuota | null>(null);
  const [kind, setKind] = useState<'subject' | 'all'>('all');
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setError(null);
    setKind(defaultSubjectId ? 'subject' : 'all');
    setSubjectId(defaultSubjectId ?? subjects[0]?.id ?? null);
    api.exportQuota().then(setQuota).catch((e) => setError(errorMessage(e)));
  }, [open, defaultSubjectId, subjects]);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const accepted = await api.requestExport(kind, kind === 'subject' ? (subjectId ?? undefined) : undefined);
      setResult(t('export.sent', { email: accepted.email }));
      setQuota(await api.exportQuota());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const available = quota ? (kind === 'subject' ? quota.subject_available : quota.all_available) : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('export.title')}</DialogTitle>
          <DialogDescription>{t('export.description', { email: quota?.email ?? '…' })}</DialogDescription>
        </DialogHeader>
        <View className="gap-2">
          <Option
            active={kind === 'all'}
            title={t('export.all')}
            detail={quota && !quota.all_available ? t('export.usedToday') : t('export.allDetail')}
            onPress={() => setKind('all')}
          />
          <Option
            active={kind === 'subject'}
            title={t('export.subject')}
            detail={quota && !quota.subject_available ? t('export.usedToday') : t('export.subjectDetail')}
            onPress={() => setKind('subject')}
          />
          {kind === 'subject' && (
            <View className="flex-row flex-wrap gap-2 pl-2 pt-1">
              {subjects.map((subject) => (
                <Chip key={subject.id} label={subject.name} active={subjectId === subject.id} onPress={() => setSubjectId(subject.id)} />
              ))}
            </View>
          )}
        </View>
        <Text className="text-xs text-muted-foreground">{t('export.limitNote')}</Text>
        {result && <Text className="text-sm text-green-700 dark:text-green-400">{result}</Text>}
        {error && <Text className="text-sm text-destructive">{error}</Text>}
        <DialogFooter>
          <Button variant="outline" onPress={() => onOpenChange(false)}>
            <Text>{t('common.close')}</Text>
          </Button>
          <Button disabled={!available || busy || (kind === 'subject' && !subjectId)} onPress={send}>
            <Icon as={Mail} />
            <Text>{busy ? t('export.sending') : t('export.send')}</Text>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Option({ active, title, detail, onPress }: { active: boolean; title: string; detail: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className={cn('gap-0.5 rounded-lg border border-border p-3 web:hover:bg-accent', active && 'border-primary bg-accent')}>
      <Text className="font-medium">{title}</Text>
      <Text className="text-sm text-muted-foreground">{detail}</Text>
    </Pressable>
  );
}
