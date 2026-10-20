import { EmptyState } from '@/components/empty-state';
import { ErrorBanner, Grid, Page, PageSection } from '@/components/layout';
import { NoteCard } from '@/components/note-card';
import { NoteEditorDialog } from '@/components/note-editor-dialog';
import { SubjectIcon } from '@/components/subject-icon';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import type { Note, RecentSection, Subject } from '@/lib/api';
import { formatRelative, greeting, plural } from '@/lib/format';
import { useBooksStore } from '@/stores/books-store';
import { useNotesStore } from '@/stores/notes-store';
import { useSubjectsStore } from '@/stores/subjects-store';
import { router } from 'expo-router';
import Head from 'expo-router/head';
import { BookOpen, Library, StickyNote, type LucideIcon } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

export default function DashboardScreen() {
  const subjects = useSubjectsStore((state) => state.subjects);
  const status = useSubjectsStore((state) => state.status);
  const error = useSubjectsStore((state) => state.error);
  const fetchSubjects = useSubjectsStore((state) => state.fetchSubjects);
  const recentSections = useBooksStore((state) => state.recentSections);
  const fetchRecentSections = useBooksStore((state) => state.fetchRecentSections);
  const recentNotes = useNotesStore((state) => state.recentNotes);
  const fetchRecentNotes = useNotesStore((state) => state.fetchRecentNotes);
  const [editingNote, setEditingNote] = useState<Note | null>(null);

  const subjectsById = useMemo(() => new Map(subjects.map((subject) => [subject.id, subject])), [subjects]);

  useEffect(() => {
    fetchRecentSections();
    fetchRecentNotes();
  }, [fetchRecentSections, fetchRecentNotes, status]);

  return (
    <Page>
      <Head>
        <title>Dashboard · Albok</title>
      </Head>

      <View className="gap-1">
        <Text className="text-3xl font-bold tracking-tight">{greeting()}</Text>
        <Text className="text-muted-foreground">
          {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
        </Text>
      </View>

      {status === 'error' && error && <ErrorBanner message={error} onRetry={fetchSubjects} />}

      <PageSection title="Continue reading">
        {recentSections.length ? (
          <Grid minItemWidth={280}>
            {recentSections.slice(0, 3).map((section) => (
              <RecentSectionCard key={section.id} section={section} subject={subjectsById.get(section.subject_id)} />
            ))}
          </Grid>
        ) : (
          <EmptyState
            icon={BookOpen}
            title="Nothing opened yet"
            description="Pick a subject, import your class book and open a section. It will show up here so you can jump back in."
          />
        )}
      </PageSection>

      <PageSection title="Subjects">
        <Grid>
          {status === 'loading'
            ? [0, 1, 2, 3, 4].map((n) => <Skeleton key={n} className="h-44 rounded-xl" />)
            : subjects.map((subject) => <SubjectCard key={subject.id} subject={subject} />)}
        </Grid>
      </PageSection>

      {recentNotes.length > 0 && (
        <PageSection title="Recent notes">
          <Grid minItemWidth={300}>
            {recentNotes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                subject={subjectsById.get(note.subject_id)}
                onPress={() => setEditingNote(note)}
                className="h-full"
              />
            ))}
          </Grid>
        </PageSection>
      )}

      {editingNote && (
        <NoteEditorDialog
          open
          onOpenChange={(open) => !open && setEditingNote(null)}
          subjectId={editingNote.subject_id}
          note={editingNote}
        />
      )}
    </Page>
  );
}

function SubjectCard({ subject }: { subject: Subject }) {
  const progress = subject.section_count ? (subject.completed_section_count / subject.section_count) * 100 : 0;

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/subjects/[subjectId]', params: { subjectId: String(subject.id) } })}
      className="gap-5 rounded-xl border border-border bg-card p-5 web:transition-colors web:hover:border-ring/60">
      <View className="flex-row items-center gap-3">
        <SubjectIcon subject={subject} size="lg" />
        <View className="flex-1">
          <Text className="text-lg font-semibold">{subject.name}</Text>
          <Text className="text-sm text-muted-foreground" numberOfLines={1}>
            {subject.description}
          </Text>
        </View>
      </View>
      <View className="gap-1.5">
        <View className="flex-row justify-between">
          <Text className="text-xs text-muted-foreground">Sections done</Text>
          <Text className="text-xs tabular-nums text-muted-foreground">
            {subject.completed_section_count}/{subject.section_count}
          </Text>
        </View>
        <Progress value={progress} className="h-1.5" />
      </View>
      <View className="flex-row gap-5">
        <Stat icon={Library} label={plural(subject.book_count, 'book')} />
        <Stat icon={StickyNote} label={plural(subject.note_count, 'note')} />
      </View>
    </Pressable>
  );
}

function Stat({ icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <View className="flex-row items-center gap-1.5">
      <Icon as={icon} size={14} className="text-muted-foreground" />
      <Text className="text-sm text-muted-foreground">{label}</Text>
    </View>
  );
}

function RecentSectionCard({ section, subject }: { section: RecentSection; subject?: Subject }) {
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/sections/[sectionId]', params: { sectionId: String(section.id) } })}
      className="h-full gap-3 rounded-xl border border-border bg-card p-4 web:transition-colors web:hover:border-ring/60">
      <View className="flex-row items-center gap-2">
        {subject && <SubjectIcon subject={subject} size="sm" />}
        <Text className="flex-1 text-xs text-muted-foreground" numberOfLines={1}>
          {subject ? `${subject.name} · ` : ''}
          {section.book_title}
        </Text>
      </View>
      <Text className="font-semibold" numberOfLines={2}>
        {section.title}
      </Text>
      <View className="mt-auto flex-row items-center justify-between">
        <Text className="text-xs text-muted-foreground">
          Opened {section.last_opened_at ? formatRelative(section.last_opened_at) : ''}
        </Text>
        {section.completed && (
          <Badge variant="secondary">
            <Text>Done</Text>
          </Badge>
        )}
      </View>
    </Pressable>
  );
}
