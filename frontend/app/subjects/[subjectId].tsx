import { BookCard } from '@/components/book-card';
import { EmptyState } from '@/components/empty-state';
import { ImportBookDialog } from '@/components/import-book-dialog';
import { ErrorBanner, Grid, Page } from '@/components/layout';
import { NoteCard } from '@/components/note-card';
import { NoteEditorDialog } from '@/components/note-editor-dialog';
import { SubjectIcon } from '@/components/subject-icon';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Text } from '@/components/ui/text';
import type { Note } from '@/lib/api';
import { useBooksStore } from '@/stores/books-store';
import { useNotesStore } from '@/stores/notes-store';
import { useSubject, useSubjectsStore } from '@/stores/subjects-store';
import { useLocalSearchParams } from 'expo-router';
import Head from 'expo-router/head';
import { CircleAlert, Library, NotebookPen, Search, StickyNote, Upload } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

type Tab = 'books' | 'notes';
type NoteDialogState = { open: false } | { open: true; note: Note | null };

export default function SubjectScreen() {
  const params = useLocalSearchParams<{ subjectId: string; tab?: string }>();
  const subjectId = Number(params.subjectId);
  const subject = useSubject(subjectId);
  const subjectsStatus = useSubjectsStore((state) => state.status);

  const books = useBooksStore((state) => state.booksBySubject[subjectId]);
  const booksError = useBooksStore((state) => state.booksErrors[subjectId]);
  const fetchBooks = useBooksStore((state) => state.fetchBooks);
  const notes = useNotesStore((state) => state.notesBySubject[subjectId]);
  const notesError = useNotesStore((state) => state.notesErrors[subjectId]);
  const fetchNotes = useNotesStore((state) => state.fetchNotes);

  const [tab, setTab] = useState<Tab>('books');
  const [importOpen, setImportOpen] = useState(false);
  const [noteDialog, setNoteDialog] = useState<NoteDialogState>({ open: false });
  const [query, setQuery] = useState('');

  useEffect(() => {
    fetchBooks(subjectId);
    fetchNotes(subjectId);
    setQuery('');
  }, [subjectId, fetchBooks, fetchNotes]);

  useEffect(() => {
    setTab(params.tab === 'notes' ? 'notes' : 'books');
  }, [subjectId, params.tab]);

  const filteredNotes = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!notes || !term) return notes;
    return notes.filter((note) =>
      [note.title, note.content, note.section_title ?? ''].some((field) => field.toLowerCase().includes(term))
    );
  }, [notes, query]);

  if (!subject) {
    return (
      <Page>
        {subjectsStatus === 'loading' || subjectsStatus === 'idle' ? (
          <Skeleton className="h-16 w-80 rounded-xl" />
        ) : (
          <EmptyState icon={CircleAlert} title="Subject not found" description="It may have been removed." />
        )}
      </Page>
    );
  }

  return (
    <Page>
      <Head>
        <title>{`${subject.name} · Albok`}</title>
      </Head>

      <View className="flex-row flex-wrap items-center gap-4">
        <SubjectIcon subject={subject} size="lg" />
        <View className="min-w-48 flex-1">
          <Text className="text-3xl font-bold tracking-tight">{subject.name}</Text>
          <Text className="text-muted-foreground">{subject.description}</Text>
        </View>
        <View className="flex-row gap-2">
          <Button variant="outline" onPress={() => setNoteDialog({ open: true, note: null })}>
            <Icon as={NotebookPen} />
            <Text>New note</Text>
          </Button>
          <Button onPress={() => setImportOpen(true)}>
            <Icon as={Upload} />
            <Text>Import book</Text>
          </Button>
        </View>
      </View>

      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)} className="gap-6">
        <TabsList>
          <TabsTrigger value="books" className="px-3">
            <Icon as={Library} size={14} />
            <Text>Book sections</Text>
          </TabsTrigger>
          <TabsTrigger value="notes" className="px-3">
            <Icon as={StickyNote} size={14} />
            <Text>Notes{notes ? ` (${notes.length})` : ''}</Text>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="books" className="gap-4">
          {booksError ? (
            <ErrorBanner message={booksError} onRetry={() => fetchBooks(subjectId)} />
          ) : !books ? (
            [0, 1].map((n) => <Skeleton key={n} className="h-48 rounded-xl" />)
          ) : books.length === 0 ? (
            <EmptyState
              icon={Library}
              title="No books yet"
              description={`Import the ${subject.name.toLowerCase()} book or handout you use in class. PDF, Word, text and Markdown files work.`}>
              <Button onPress={() => setImportOpen(true)} className="mt-2">
                <Icon as={Upload} />
                <Text>Import book</Text>
              </Button>
            </EmptyState>
          ) : (
            books.map((book) => <BookCard key={book.id} book={book} subject={subject} />)
          )}
        </TabsContent>

        <TabsContent value="notes" className="gap-4">
          {notesError ? (
            <ErrorBanner message={notesError} onRetry={() => fetchNotes(subjectId)} />
          ) : !filteredNotes ? (
            <Skeleton className="h-32 rounded-xl" />
          ) : notes?.length === 0 ? (
            <EmptyState
              icon={StickyNote}
              title="No notes yet"
              description="Write notes here, or take them while reading a section in class. They stay organised by subject.">
              <Button onPress={() => setNoteDialog({ open: true, note: null })} className="mt-2">
                <Icon as={NotebookPen} />
                <Text>New note</Text>
              </Button>
            </EmptyState>
          ) : (
            <>
              <View className="max-w-md justify-center">
                <Input placeholder="Search notes…" value={query} onChangeText={setQuery} className="pl-9" />
                <View className="absolute left-3" pointerEvents="none">
                  <Icon as={Search} size={16} className="text-muted-foreground" />
                </View>
              </View>
              {filteredNotes.length === 0 ? (
                <Text className="text-muted-foreground">No notes match “{query.trim()}”.</Text>
              ) : (
                <Grid minItemWidth={280}>
                  {filteredNotes.map((note) => (
                    <NoteCard
                      key={note.id}
                      note={note}
                      onPress={() => setNoteDialog({ open: true, note })}
                      className="h-full"
                    />
                  ))}
                </Grid>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      <ImportBookDialog open={importOpen} onOpenChange={setImportOpen} subject={subject} />
      <NoteEditorDialog
        open={noteDialog.open}
        onOpenChange={(open) => !open && setNoteDialog({ open: false })}
        subjectId={subjectId}
        note={noteDialog.open ? noteDialog.note : null}
      />
    </Page>
  );
}
