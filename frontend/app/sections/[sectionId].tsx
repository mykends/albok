import { EmptyState } from '@/components/empty-state';
import { ErrorBanner } from '@/components/layout';
import { NoteCard } from '@/components/note-card';
import { NoteEditorDialog } from '@/components/note-editor-dialog';
import { SectionContent } from '@/components/section-content';
import { SubjectIcon } from '@/components/subject-icon';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage, type Note, type Section } from '@/lib/api';
import { readingMinutes } from '@/lib/subjects';
import { cn } from '@/lib/utils';
import { useBooksStore } from '@/stores/books-store';
import { useNotesStore } from '@/stores/notes-store';
import { READER_FONT_SIZES, usePreferencesStore } from '@/stores/preferences-store';
import { useSubject } from '@/stores/subjects-store';
import { router, useLocalSearchParams } from 'expo-router';
import Head from 'expo-router/head';
import {
  AArrowDown,
  AArrowUp,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleAlert,
  CircleCheck,
  PanelRight,
  PanelRightClose,
} from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, useWindowDimensions, View } from 'react-native';

function goToSection(sectionId: number) {
  router.replace({ pathname: '/sections/[sectionId]', params: { sectionId: String(sectionId) } });
}

export default function SectionScreen() {
  const sectionId = Number(useLocalSearchParams<{ sectionId: string }>().sectionId);
  const section = useBooksStore((state) => state.sections[sectionId]);
  const fetchSection = useBooksStore((state) => state.fetchSection);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    setError(null);
    fetchSection(sectionId)
      .then(() => scrollRef.current?.scrollTo({ y: 0, animated: false }))
      .catch((e) => setError(errorMessage(e)));
  }, [sectionId, fetchSection]);

  if (error && !section) {
    return (
      <View className="flex-1 p-10">
        <EmptyState icon={CircleAlert} title="Couldn't open this section" description={error}>
          <Button variant="outline" onPress={() => router.back()}>
            <Text>Go back</Text>
          </Button>
        </EmptyState>
      </View>
    );
  }
  if (!section) {
    return (
      <View className="flex-1 gap-4 p-10">
        <Skeleton className="h-8 w-96 rounded-lg" />
        <Skeleton className="h-64 w-full max-w-3xl rounded-lg" />
      </View>
    );
  }
  return <Reader section={section} scrollRef={scrollRef} error={error} />;
}

function Reader({
  section,
  scrollRef,
  error,
}: {
  section: Section;
  scrollRef: React.RefObject<ScrollView | null>;
  error: string | null;
}) {
  const subject = useSubject(section.subject_id);
  const book = useBooksStore((state) =>
    state.booksBySubject[section.subject_id]?.find((candidate) => candidate.id === section.book_id)
  );
  const setSectionCompleted = useBooksStore((state) => state.setSectionCompleted);
  const fontSize = usePreferencesStore((state) => state.readerFontSize);
  const changeFontSize = usePreferencesStore((state) => state.changeReaderFontSize);
  const notesPanelOpen = usePreferencesStore((state) => state.notesPanelOpen);
  const toggleNotesPanel = usePreferencesStore((state) => state.toggleNotesPanel);
  const { width } = useWindowDimensions();

  // Book (for neighbour titles) and notes are loaded per subject; fetch them if we came straight here.
  useEffect(() => {
    if (!useBooksStore.getState().booksBySubject[section.subject_id]) {
      useBooksStore.getState().fetchBooks(section.subject_id);
    }
    if (!useNotesStore.getState().notesBySubject[section.subject_id]) {
      useNotesStore.getState().fetchNotes(section.subject_id);
    }
  }, [section.subject_id]);

  // Arrow keys move between sections while not typing.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target?.tagName ?? '')) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key === 'ArrowRight' && section.next_id) goToSection(section.next_id);
      if (event.key === 'ArrowLeft' && section.prev_id) goToSection(section.prev_id);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [section.next_id, section.prev_id]);

  const neighbourTitle = (id: number | null) => book?.sections.find((s) => s.id === id)?.title;
  const toggleCompleted = () =>
    setSectionCompleted(section.subject_id, section.id, !section.completed).catch(() => {});

  return (
    <View className="flex-1">
      <Head>
        <title>{`${section.title} · Albok`}</title>
      </Head>

      <View className="flex-row items-center gap-3 border-b border-border px-4 py-2.5">
        <Button
          variant="ghost"
          size="icon"
          accessibilityLabel="Back to subject"
          onPress={() =>
            router.navigate({ pathname: '/subjects/[subjectId]', params: { subjectId: String(section.subject_id) } })
          }>
          <Icon as={ArrowLeft} size={18} />
        </Button>
        {subject && <SubjectIcon subject={subject} size="sm" />}
        <View className="flex-1">
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {subject?.name} · {section.book_title}
          </Text>
          <Text className="text-sm font-medium" numberOfLines={1}>
            Section {section.position + 1} of {section.total_sections}
          </Text>
        </View>
        <View className="flex-row items-center">
          <Button
            variant="ghost"
            size="icon"
            accessibilityLabel="Smaller text"
            disabled={fontSize <= READER_FONT_SIZES.min}
            onPress={() => changeFontSize(-2)}>
            <Icon as={AArrowDown} size={18} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            accessibilityLabel="Larger text"
            disabled={fontSize >= READER_FONT_SIZES.max}
            onPress={() => changeFontSize(2)}>
            <Icon as={AArrowUp} size={18} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            accessibilityLabel={notesPanelOpen ? 'Hide notes' : 'Show notes'}
            onPress={toggleNotesPanel}>
            <Icon as={notesPanelOpen ? PanelRightClose : PanelRight} size={18} />
          </Button>
        </View>
      </View>
      <Progress value={((section.position + 1) / section.total_sections) * 100} className="h-0.5 rounded-none" />

      <View className="flex-1 flex-row">
        <ScrollView ref={scrollRef} className="flex-1" contentContainerClassName="mx-auto w-full max-w-3xl gap-6 px-8 py-10">
          {error && <ErrorBanner message={error} />}
          <View className="gap-2">
            <Text className="text-3xl font-bold tracking-tight">{section.title}</Text>
            <Text className="text-sm text-muted-foreground">
              {readingMinutes(section.word_count)} min read · {section.word_count} words
            </Text>
          </View>

          <SectionContent content={section.content} fontSize={fontSize} />

          <View className="mt-6 flex-row items-center gap-3 border-t border-border pt-6">
            <View className="flex-1 items-start">
              <Button
                variant="outline"
                className="max-w-full"
                disabled={!section.prev_id}
                onPress={() => section.prev_id && goToSection(section.prev_id)}>
                <Icon as={ChevronLeft} />
                <Text className="shrink" numberOfLines={1}>
                  {neighbourTitle(section.prev_id) ?? 'Previous'}
                </Text>
              </Button>
            </View>
            <Button variant={section.completed ? 'secondary' : 'outline'} onPress={toggleCompleted}>
              {section.completed ? <Icon as={CircleCheck} color={subject?.color} /> : <Icon as={Circle} />}
              <Text>{section.completed ? 'Done' : 'Mark as done'}</Text>
            </Button>
            <View className="flex-1 items-end">
              <Button
                className="max-w-full"
                disabled={!section.next_id}
                onPress={() => section.next_id && goToSection(section.next_id)}>
                <Text className="shrink" numberOfLines={1}>
                  {neighbourTitle(section.next_id) ?? 'Next'}
                </Text>
                <Icon as={ChevronRight} />
              </Button>
            </View>
          </View>
          {Platform.OS === 'web' && (
            <Text className="text-center text-xs text-muted-foreground">Tip: use ← and → to move between sections.</Text>
          )}
        </ScrollView>

        {notesPanelOpen && (
          <SectionNotesPanel section={section} className={width < 1100 ? 'w-72' : 'w-96'} />
        )}
      </View>
    </View>
  );
}

function SectionNotesPanel({ section, className }: { section: Section; className?: string }) {
  const notes = useNotesStore((state) => state.notesBySubject[section.subject_id]);
  const createNote = useNotesStore((state) => state.createNote);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Note | null>(null);

  const sectionNotes = notes?.filter((note) => note.section_id === section.id) ?? [];

  async function saveDraft() {
    const text = draft.trim();
    if (!text) return;
    // First line becomes the title; the rest is the body.
    const [firstLine, ...rest] = text.split('\n');
    const title = firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine;
    const content = firstLine.length > 80 ? text : rest.join('\n').trim();
    setSaving(true);
    setError(null);
    try {
      await createNote(section.subject_id, { title, content, section_id: section.id });
      setDraft('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className={cn('border-l border-border bg-muted/30', className)}>
      <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
        <Text className="font-semibold">Notes on this section</Text>
        <Text className="text-xs tabular-nums text-muted-foreground">{sectionNotes.length}</Text>
      </View>
      <ScrollView contentContainerClassName="gap-3 p-4">
        <View className="gap-2">
          <Textarea
            placeholder={'Jot down a note…\nThe first line becomes its title.'}
            value={draft}
            onChangeText={setDraft}
            numberOfLines={4}
            className="min-h-24 bg-background"
          />
          {error && <Text className="text-sm text-destructive">{error}</Text>}
          <Button size="sm" className="self-end" disabled={!draft.trim() || saving} onPress={saveDraft}>
            <Text>{saving ? 'Saving…' : 'Add note'}</Text>
          </Button>
        </View>
        {sectionNotes.map((note) => (
          <NoteCard key={note.id} note={note} showSection={false} onPress={() => setEditing(note)} />
        ))}
      </ScrollView>

      <NoteEditorDialog
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(null)}
        subjectId={section.subject_id}
        note={editing}
      />
    </View>
  );
}
