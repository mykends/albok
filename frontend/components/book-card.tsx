import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Icon } from '@/components/ui/icon';
import { Progress } from '@/components/ui/progress';
import { Text } from '@/components/ui/text';
import type { Book, SectionSummary, Subject } from '@/lib/api';
import { plural } from '@/lib/format';
import { readingMinutes } from '@/lib/subjects';
import { useBooksStore } from '@/stores/books-store';
import { router } from 'expo-router';
import { ChevronRight, Circle, CircleCheck, Ellipsis, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

const COLLAPSED_SECTIONS = 8;

export function BookCard({ book, subject }: { book: Book; subject: Subject }) {
  const deleteBook = useBooksStore((state) => state.deleteBook);
  const setSectionCompleted = useBooksStore((state) => state.setSectionCompleted);
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const completed = book.sections.filter((section) => section.completed).length;
  const total = book.sections.length;
  const visible = expanded ? book.sections : book.sections.slice(0, COLLAPSED_SECTIONS);

  return (
    <>
      <Card className="gap-4 py-5">
        <CardHeader className="flex-row items-start gap-3">
          <View className="flex-1 gap-1.5">
            <CardTitle className="text-lg">{book.title}</CardTitle>
            <CardDescription>
              {plural(total, 'section')} · {completed} completed
              {book.source_filename ? ` · ${book.source_filename}` : ''}
            </CardDescription>
            <Progress value={total ? (completed / total) * 100 : 0} className="mt-1 h-1.5 max-w-sm" />
          </View>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" accessibilityLabel="Book options">
                <Icon as={Ellipsis} size={18} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem variant="destructive" onPress={() => setConfirmDelete(true)}>
                <Icon as={Trash2} size={14} className="text-destructive" />
                <Text>Delete book</Text>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardHeader>

        <CardContent className="gap-0.5 px-3">
          {visible.map((section) => (
            <SectionRow
              key={section.id}
              section={section}
              color={subject.color}
              onToggle={() => setSectionCompleted(subject.id, section.id, !section.completed).catch(() => {})}
            />
          ))}
          {total > COLLAPSED_SECTIONS && (
            <Button variant="link" size="sm" className="self-start" onPress={() => setExpanded((value) => !value)}>
              <Text>{expanded ? 'Show fewer sections' : `Show all ${total} sections`}</Text>
            </Button>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{book.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Its sections and reading progress will be removed. Notes you took stay in {subject.name}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Text>Cancel</Text>
            </AlertDialogCancel>
            <AlertDialogAction className="bg-destructive" onPress={() => deleteBook(book)}>
              <Text className="text-white">Delete book</Text>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function SectionRow({ section, color, onToggle }: { section: SectionSummary; color: string; onToggle: () => void }) {
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/sections/[sectionId]', params: { sectionId: String(section.id) } })}
      className="flex-row items-center gap-3 rounded-md px-3 py-2.5 web:transition-colors web:hover:bg-accent">
      <Pressable
        onPress={onToggle}
        hitSlop={8}
        accessibilityLabel={section.completed ? 'Mark as not done' : 'Mark as done'}>
        {section.completed ? (
          <Icon as={CircleCheck} size={18} color={color} />
        ) : (
          <Icon as={Circle} size={18} className="text-muted-foreground/60" />
        )}
      </Pressable>
      <Text className="w-7 text-sm tabular-nums text-muted-foreground">{section.position + 1}.</Text>
      <Text className={section.completed ? 'flex-1 text-muted-foreground' : 'flex-1'} numberOfLines={1}>
        {section.title}
      </Text>
      <Text className="text-xs text-muted-foreground">{readingMinutes(section.word_count)} min</Text>
      <Icon as={ChevronRight} size={16} className="text-muted-foreground" />
    </Pressable>
  );
}
