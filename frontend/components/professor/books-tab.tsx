import { Checkbox } from '@/components/checkbox';
import { EmptyState } from '@/components/empty-state';
import { UploadDialog } from '@/components/professor/upload-dialog';
import type { useBooks } from '@/components/professor/use-books';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { api, type Book, type ProfessorSection, type ProfessorSubject } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { errorMessage } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useProfessor } from '@/stores/professor-store';
import { router } from 'expo-router';
import {
  ChevronDown,
  ChevronUp,
  Ellipsis,
  Eye,
  EyeOff,
  FileWarning,
  Library,
  Loader,
  Pencil,
  Trash2,
  Upload,
} from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

type BooksState = ReturnType<typeof useBooks>;

export function BooksTab({ subject, books }: { subject: ProfessorSubject; books: BooksState }) {
  const { t } = useTranslation();
  const refreshSubjects = useProfessor((state) => state.refresh);
  const [classId, setClassId] = useState<number | null>(subject.classes[0]?.id ?? null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<Book>) {
    setError(null);
    try {
      books.replace(await action());
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <>
      <View className="flex-row flex-wrap items-center gap-3">
        <Text className="text-sm text-muted-foreground">{t('professor.publishFor')}</Text>
        {subject.classes.length ? (
          subject.classes.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => setClassId(c.id)}
              className={cn(
                'rounded-full border border-border px-3 py-1 web:hover:bg-accent',
                classId === c.id && 'border-primary bg-primary'
              )}>
              <Text className={cn('text-sm font-medium', classId === c.id && 'text-primary-foreground')}>{c.name}</Text>
            </Pressable>
          ))
        ) : (
          <Text className="text-sm">{t('professor.noClassesThisYear')}</Text>
        )}
        <View className="flex-1" />
        <Button onPress={() => setUploadOpen(true)}>
          <Icon as={Upload} />
          <Text>{t('professor.upload')}</Text>
        </Button>
      </View>
      <Text className="-mt-2 text-sm text-muted-foreground">{t('professor.publishHint')}</Text>
      {error && <Text className="text-sm text-destructive">{error}</Text>}

      {!books.books ? (
        <Skeleton className="h-48 rounded-xl" />
      ) : books.books.length === 0 ? (
        <EmptyState icon={Library} title={t('professor.noBooksTitle')} description={t('professor.noBooks')}>
          <Button className="mt-2" onPress={() => setUploadOpen(true)}>
            <Icon as={Upload} />
            <Text>{t('professor.upload')}</Text>
          </Button>
        </EmptyState>
      ) : (
        books.books.map((book) => (
          <BookPanel
            key={book.id}
            book={book}
            classId={classId}
            className={subject.classes.find((c) => c.id === classId)?.name ?? ''}
            run={run}
            onDeleted={() => {
              books.remove(book.id);
              refreshSubjects();
            }}
          />
        ))
      )}

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        subjectName={subject.name}
        onUploadFile={async (file, title) => {
          books.replace(await api.uploadBook(subject.id, file, title));
          refreshSubjects();
        }}
        onPasteText={async (title, text) => {
          books.replace(await api.pasteBook(subject.id, title, text));
          refreshSubjects();
        }}
      />
    </>
  );
}

const COLLAPSED = 10;

function BookPanel({
  book,
  classId,
  className,
  run,
  onDeleted,
}: {
  book: Book;
  classId: number | null;
  className: string;
  run: (action: () => Promise<Book>) => Promise<void>;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const file = book.file;
  const published = classId ? book.sections.filter((s) => s.published_class_ids.includes(classId)).length : 0;
  const visible = expanded ? book.sections : book.sections.slice(0, COLLAPSED);

  return (
    <View className="gap-3 rounded-xl border border-border bg-card p-5">
      <View className="flex-row flex-wrap items-start gap-3">
        <View className="min-w-48 flex-1 gap-1">
          <Text className="text-lg font-semibold">{book.title}</Text>
          {file && (
            <Text className="text-sm text-muted-foreground">
              {file.original_filename} · {formatBytes(file.original_size + file.pdf_size)}
              {file.status === 'ready' ? ` · ${t('common.pages', { count: file.page_count })}` : ''}
            </Text>
          )}
        </View>
        {file?.status === 'ready' && (
          <Button
            variant="outline"
            size="sm"
            onPress={() => router.push({ pathname: '/books/[bookId]', params: { bookId: String(book.id) } })}>
            <Icon as={Pencil} />
            <Text>{t('professor.editSections')}</Text>
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" accessibilityLabel={t('professor.bookOptions')}>
              <Icon as={Ellipsis} size={18} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem variant="destructive" onPress={() => setConfirmDelete(true)}>
              <Icon as={Trash2} size={14} className="text-destructive" />
              <Text>{t('professor.deleteBook')}</Text>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </View>

      {file?.status === 'processing' && (
        <View className="flex-row items-center gap-2">
          <Icon as={Loader} size={16} className="text-muted-foreground" />
          <Text className="text-sm text-muted-foreground">{t('professor.processing')}</Text>
        </View>
      )}
      {file?.status === 'failed' && (
        <View className="flex-row items-center gap-2 rounded-md bg-destructive/10 p-3">
          <Icon as={FileWarning} size={16} className="text-destructive" />
          <Text className="flex-1 text-sm">{file.error ?? t('professor.processingFailed')}</Text>
        </View>
      )}
      {book.pending_file && (
        <View className="flex-row items-center gap-2 rounded-md bg-secondary p-3">
          <Text className="flex-1 text-sm">{t('professor.replacementWaiting')}</Text>
          <Button
            size="sm"
            variant="outline"
            onPress={() => router.push({ pathname: '/books/[bookId]', params: { bookId: String(book.id), replace: '1' } })}>
            <Text>{t('professor.reviewReplacement')}</Text>
          </Button>
        </View>
      )}

      {file?.status === 'ready' && (
        <>
          <View className="flex-row flex-wrap items-center gap-x-6 gap-y-2 border-y border-border py-2">
            <Checkbox
              checked={book.exportable}
              onChange={(exportable) => run(() => api.updateBook(book.id, { exportable }))}
              label={t('professor.exportable')}
            />
            {classId && (
              <>
                <Text className="text-sm text-muted-foreground">
                  {t('professor.publishedCount', { published, total: book.sections.length, className })}
                </Text>
                <View className="flex-1" />
                <Button size="sm" variant="outline" onPress={() => run(() => api.publishBook(book.id, classId, true))}>
                  <Icon as={Eye} />
                  <Text>{t('professor.publishAll')}</Text>
                </Button>
                <Button size="sm" variant="ghost" onPress={() => run(() => api.publishBook(book.id, classId, false))}>
                  <Icon as={EyeOff} />
                  <Text>{t('professor.hideAll')}</Text>
                </Button>
              </>
            )}
          </View>
          <View className="gap-0.5">
            {visible.map((section) => (
              <SectionRow key={section.id} section={section} classId={classId} run={run} />
            ))}
          </View>
          {book.sections.length > COLLAPSED && (
            <Button variant="link" size="sm" className="self-start" onPress={() => setExpanded((value) => !value)}>
              <Icon as={expanded ? ChevronUp : ChevronDown} />
              <Text>{expanded ? t('common.showLess') : t('professor.showAllSections', { count: book.sections.length })}</Text>
            </Button>
          )}
        </>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('professor.deleteBookTitle', { title: book.title })}</AlertDialogTitle>
            <AlertDialogDescription>{t('professor.deleteBookDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Text>{t('common.cancel')}</Text>
            </AlertDialogCancel>
            <AlertDialogAction className="bg-destructive" onPress={() => api.deleteBook(book.id).then(onDeleted)}>
              <Text className="text-white">{t('professor.deleteBook')}</Text>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </View>
  );
}

function SectionRow({
  section,
  classId,
  run,
}: {
  section: ProfessorSection;
  classId: number | null;
  run: (action: () => Promise<Book>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const published = classId !== null && section.published_class_ids.includes(classId);
  const included = classId !== null && section.included_class_ids.includes(classId);
  return (
    <View className="flex-row items-center gap-3 rounded-md px-2 py-1.5 web:hover:bg-accent/60">
      <Button
        variant={published ? 'secondary' : 'ghost'}
        size="sm"
        disabled={classId === null}
        accessibilityLabel={published ? t('professor.hide') : t('professor.publish')}
        onPress={() => classId !== null && run(() => api.publishSection(section.id, classId, !published))}
        className="w-28 justify-start">
        <Icon as={published ? Eye : EyeOff} className={published ? 'text-primary' : 'text-muted-foreground'} />
        <Text className={cn('text-xs', !published && 'text-muted-foreground')}>
          {published ? t('professor.published') : t('professor.hidden')}
        </Text>
      </Button>
      <Pressable
        className="flex-1"
        onPress={() => router.push({ pathname: '/read/[sectionId]', params: { sectionId: String(section.id) } })}>
        <Text numberOfLines={1}>{section.title}</Text>
      </Pressable>
      {included && !published && (
        <Badge variant="outline">
          <Text>{t('professor.inPlan')}</Text>
        </Badge>
      )}
      <Text className="w-24 text-right text-xs tabular-nums text-muted-foreground">
        {t('common.pageRange', { start: section.page_start, end: section.page_end })}
      </Text>
    </View>
  );
}
