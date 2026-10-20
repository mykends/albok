import { EmptyState } from '@/components/empty-state';
import { PdfViewer } from '@/components/pdf-viewer';
import { ReplacePanel } from '@/components/professor/replace-panel';
import { pickFile } from '@/components/professor/upload-dialog';
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
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { api, type Book, type ProfessorSection } from '@/lib/api';
import { errorMessage } from '@/lib/i18n';
import { usePreferencesStore } from '@/stores/preferences-store';
import { router, useLocalSearchParams } from 'expo-router';
import Head from 'expo-router/head';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CircleAlert,
  FileUp,
  Merge,
  Plus,
  Scissors,
  Trash2,
} from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

const POLL_MS = 2000;

export default function BookEditorScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ bookId: string; replace?: string }>();
  const bookId = Number(params.bookId);
  const [book, setBook] = useState<Book | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [targetPage, setTargetPage] = useState<number | undefined>(undefined);
  const zoom = usePreferencesStore((state) => state.readerZoom);

  const load = useCallback(() => {
    api
      .book(bookId)
      .then(setBook)
      .catch((e) => setError(errorMessage(e)));
  }, [bookId]);

  useEffect(load, [load]);

  const pendingProcessing = book?.pending_file?.status === 'processing';
  useEffect(() => {
    if (!pendingProcessing) return;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [pendingProcessing, load]);

  async function run(action: () => Promise<Book>) {
    setActionError(null);
    try {
      setBook(await action());
    } catch (e) {
      setActionError(errorMessage(e));
    }
  }

  async function startReplace() {
    const file = await pickFile();
    if (file) await run(() => api.replaceFile(bookId, file));
  }

  if (error) {
    return (
      <View className="flex-1 p-10">
        <EmptyState icon={CircleAlert} title={t('editor.unavailable')} description={error} />
      </View>
    );
  }
  if (!book || !book.file) {
    return (
      <View className="flex-1 gap-4 p-10">
        <Skeleton className="h-8 w-96 rounded-lg" />
      </View>
    );
  }

  const replacing = !!book.pending_file;
  const pageCount = (replacing ? book.pending_file : book.file)?.page_count ?? 0;

  return (
    <View className="flex-1">
      <Head>
        <title>{`${book.title} · Albok`}</title>
      </Head>
      <View className="flex-row items-center gap-3 border-b border-border px-4 py-2">
        <Button
          variant="ghost"
          size="icon"
          accessibilityLabel={t('common.back')}
          onPress={() =>
            router.canGoBack()
              ? router.back()
              : router.replace({ pathname: '/subjects/[subjectId]', params: { subjectId: String(book.subject_id) } })
          }>
          <Icon as={ArrowLeft} size={18} />
        </Button>
        <View className="flex-1">
          <Text className="text-xs text-muted-foreground">{replacing ? t('editor.replacing') : t('editor.title')}</Text>
          <Text className="font-semibold" numberOfLines={1}>
            {book.title}
          </Text>
        </View>
        {!replacing && (
          <Button variant="outline" size="sm" onPress={startReplace}>
            <Icon as={FileUp} />
            <Text>{t('editor.replaceFile')}</Text>
          </Button>
        )}
      </View>

      <View className="flex-1 flex-row">
        <View className="w-[32rem] border-r border-border">
          {actionError && <Text className="px-4 pt-3 text-sm text-destructive">{actionError}</Text>}
          {replacing ? (
            <ReplacePanel book={book} onDone={setBook} onPreviewPage={setTargetPage} />
          ) : (
            <SectionEditor book={book} pageCount={pageCount} run={run} onPreviewPage={setTargetPage} />
          )}
        </View>
        <PdfViewer
          key={replacing ? `pending-${book.pending_file?.id}-${book.pending_file?.status}` : `current-${book.file.id}`}
          url={api.bookPdfUrl(book.id, replacing)}
          zoom={zoom * 0.8}
          pageLabels
          targetPage={targetPage}
        />
      </View>
    </View>
  );
}

function SectionEditor({
  book,
  pageCount,
  run,
  onPreviewPage,
}: {
  book: Book;
  pageCount: number;
  run: (action: () => Promise<Book>) => Promise<void>;
  onPreviewPage: (page: number) => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  async function add() {
    await run(() => api.createSection(book.id, { title: title.trim(), page_start: Number(start), page_end: Number(end) }));
    setTitle('');
    setStart('');
    setEnd('');
  }

  return (
    <ScrollView contentContainerClassName="gap-3 p-4">
      <Text className="text-sm text-muted-foreground">{t('editor.hint', { count: pageCount })}</Text>
      {book.sections.map((section, index) => (
        <SectionCard
          key={section.id}
          section={section}
          next={book.sections[index + 1]}
          isFirst={index === 0}
          isLast={index === book.sections.length - 1}
          order={book.sections.map((s) => s.id)}
          bookId={book.id}
          run={run}
          onPreviewPage={onPreviewPage}
        />
      ))}
      <View className="gap-2 rounded-lg border border-dashed border-border p-3">
        <Text className="text-sm font-medium">{t('editor.addSection')}</Text>
        <Input placeholder={t('editor.sectionTitle')} value={title} onChangeText={setTitle} />
        <View className="flex-row items-center gap-2">
          <Input className="w-20" placeholder={t('editor.from')} inputMode="numeric" value={start} onChangeText={setStart} />
          <Text>–</Text>
          <Input className="w-20" placeholder={t('editor.to')} inputMode="numeric" value={end} onChangeText={setEnd} />
          <View className="flex-1" />
          <Button size="sm" disabled={!title.trim() || !Number(start) || !Number(end)} onPress={add}>
            <Icon as={Plus} />
            <Text>{t('common.add')}</Text>
          </Button>
        </View>
      </View>
    </ScrollView>
  );
}

function SectionCard({
  section,
  next,
  isFirst,
  isLast,
  order,
  bookId,
  run,
  onPreviewPage,
}: {
  section: ProfessorSection;
  next?: ProfessorSection;
  isFirst: boolean;
  isLast: boolean;
  order: number[];
  bookId: number;
  run: (action: () => Promise<Book>) => Promise<void>;
  onPreviewPage: (page: number) => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(section.title);
  const [start, setStart] = useState(String(section.page_start));
  const [end, setEnd] = useState(String(section.page_end));
  const [splitAt, setSplitAt] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setTitle(section.title);
    setStart(String(section.page_start));
    setEnd(String(section.page_end));
  }, [section]);

  const saveTitle = () => title.trim() && title !== section.title && run(() => api.updateSection(section.id, { title: title.trim() }));
  const saveRange = () => {
    const page_start = Number(start);
    const page_end = Number(end);
    if (!page_start || !page_end || (page_start === section.page_start && page_end === section.page_end)) return;
    run(() => api.updateSection(section.id, { page_start, page_end }));
  };
  const move = (delta: -1 | 1) => {
    const ids = [...order];
    const index = ids.indexOf(section.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    run(() => api.reorderSections(bookId, ids));
  };
  const published = section.published_class_ids.length > 0;

  return (
    <View className="gap-2 rounded-lg border border-border bg-card p-3">
      <View className="flex-row items-center gap-2">
        <Text className="w-6 text-sm tabular-nums text-muted-foreground">{section.position + 1}.</Text>
        <Input className="flex-1" value={title} onChangeText={setTitle} onBlur={saveTitle} onSubmitEditing={saveTitle} />
      </View>
      <View className="flex-row flex-wrap items-center gap-1.5">
        <Text className="text-sm text-muted-foreground">{t('editor.pages')}</Text>
        <Input
          className="w-14"
          inputMode="numeric"
          value={start}
          onChangeText={setStart}
          onFocus={() => onPreviewPage(section.page_start)}
          onBlur={saveRange}
          onSubmitEditing={saveRange}
        />
        <Text>–</Text>
        <Input
          className="w-14"
          inputMode="numeric"
          value={end}
          onChangeText={setEnd}
          onFocus={() => onPreviewPage(section.page_end)}
          onBlur={saveRange}
          onSubmitEditing={saveRange}
        />
        {published && <Text className="text-xs text-muted-foreground">{t('editor.livePublished')}</Text>}
        <View className="flex-1" />
        <Button variant="ghost" size="icon" disabled={isFirst} className="size-8" accessibilityLabel={t('editor.moveUp')} onPress={() => move(-1)}>
          <Icon as={ArrowUp} size={16} />
        </Button>
        <Button variant="ghost" size="icon" disabled={isLast} className="size-8" accessibilityLabel={t('editor.moveDown')} onPress={() => move(1)}>
          <Icon as={ArrowDown} size={16} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          disabled={section.page_end <= section.page_start}
          className="size-8" accessibilityLabel={t('editor.split')}
          onPress={() => setSplitAt(splitAt === null ? String(section.page_start + 1) : null)}>
          <Icon as={Scissors} size={16} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          disabled={!next}
          className="size-8" accessibilityLabel={t('editor.mergeWithNext')}
          onPress={() => next && run(() => api.mergeSections(bookId, [section.id, next.id]))}>
          <Icon as={Merge} size={16} />
        </Button>
        <Button variant="ghost" size="icon" className="size-8" accessibilityLabel={t('common.delete')} onPress={() => setConfirmDelete(true)}>
          <Icon as={Trash2} size={16} className="text-destructive" />
        </Button>
      </View>
      {splitAt !== null && (
        <View className="flex-row items-center gap-2 rounded-md bg-muted/60 p-2">
          <Text className="text-sm">{t('editor.splitAt')}</Text>
          <Input className="w-16" inputMode="numeric" value={splitAt} onChangeText={setSplitAt} />
          <Button
            size="sm"
            onPress={() => {
              run(() => api.splitSection(section.id, Number(splitAt)));
              setSplitAt(null);
            }}>
            <Text>{t('editor.split')}</Text>
          </Button>
        </View>
      )}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('editor.deleteTitle', { title: section.title })}</AlertDialogTitle>
            <AlertDialogDescription>{t('editor.deleteDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Text>{t('common.cancel')}</Text>
            </AlertDialogCancel>
            <AlertDialogAction className="bg-destructive" onPress={() => run(() => api.deleteSection(section.id))}>
              <Text className="text-white">{t('common.delete')}</Text>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </View>
  );
}
