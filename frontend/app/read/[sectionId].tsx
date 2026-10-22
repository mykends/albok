import { EmptyState } from '@/components/empty-state';
import { LessonNotePane } from '@/components/lesson-note-pane';
import { PdfViewer } from '@/components/pdf-viewer';
import { SubjectIcon } from '@/components/subject-icon';
import { LessonTabs } from '@/components/web-tools/lesson-tabs';
import { WebToolPlaceholder } from '@/components/web-tools/web-tool-layer';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { api, ApiError, type ReaderSection } from '@/lib/api';
import { errorMessage } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { READER_ZOOM, usePreferencesStore, type NotesLayout } from '@/stores/preferences-store';
import { useSession } from '@/stores/session-store';
import { useStudent } from '@/stores/student-store';
import { isToolActive, useWebTools } from '@/stores/web-tools-store';
import { router, useLocalSearchParams } from 'expo-router';
import Head from 'expo-router/head';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Columns2,
  Eye,
  PanelRight,
  Square,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';

export default function ReaderScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ sectionId: string; preview?: string }>();
  const sectionId = Number(params.sectionId);
  const previewClassId = params.preview ? Number(params.preview) : undefined;
  const me = useSession((state) => state.me)!;
  const isStudent = me.is_student && !me.is_professor;
  // Re-check access whenever the lesson changes (e.g. the bell rings while reading).
  const lessonKey = useStudent((state) => (state.now ? `${state.now.mode}:${state.now.lesson?.id ?? ''}` : ''));
  const [section, setSection] = useState<ReaderSection | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .section(sectionId, previewClassId)
      .then((loaded) => !cancelled && setSection(loaded))
      .catch((e) => {
        if (cancelled) return;
        setSection(null);
        setError({ status: e instanceof ApiError ? e.status : 0, message: errorMessage(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [sectionId, previewClassId, lessonKey]);

  // Sections opened during a lesson are linked to that lesson's note, and web tool buttons return here.
  useEffect(() => {
    if (!isStudent || !section || !lessonKey.startsWith('lesson')) return;
    api.sectionOpened(section.id).catch(() => {});
    useWebTools.getState().setLastSection(section.id);
  }, [isStudent, section, lessonKey]);

  if (error) {
    return (
      <View className="flex-1 p-10">
        <EmptyState icon={CircleAlert} title={t('reader.unavailableTitle')} description={error.message}>
          <Button variant="outline" onPress={() => router.replace('/')}>
            <Text>{t('reader.backHome')}</Text>
          </Button>
        </EmptyState>
      </View>
    );
  }
  // While the next section loads the open one stays up, so paging swaps only the material.
  if (!section) {
    return (
      <View className="flex-1 gap-4 p-10">
        <Skeleton className="h-8 w-96 rounded-lg" />
        <Skeleton className="h-96 w-full max-w-3xl rounded-lg" />
      </View>
    );
  }
  return <Reader section={section} previewClassId={previewClassId} showNotes={isStudent} />;
}

function Reader({
  section,
  previewClassId,
  showNotes,
}: {
  section: ReaderSection;
  previewClassId?: number;
  showNotes: boolean;
}) {
  const { t } = useTranslation();
  const zoom = usePreferencesStore((state) => state.readerZoom);
  const changeZoom = usePreferencesStore((state) => state.changeReaderZoom);
  const notesLayout = usePreferencesStore((state) => state.notesLayout);
  const toolOpen = useWebTools(isToolActive);

  // New params on the same screen (keeping `preview`): replacing the route would remount the header and notes too.
  const go = (id: number | null) => {
    if (id === null) return;
    router.setParams({ sectionId: String(id) });
  };

  // ← / → move between sections while not typing.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target?.tagName ?? '')) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key === 'ArrowRight') go(section.next_id);
      if (event.key === 'ArrowLeft') go(section.prev_id);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  return (
    <View className="flex-1">
      <Head>
        <title>{`${section.title} · Albok`}</title>
      </Head>

      <View className="flex-row items-center gap-3 border-b border-border px-4 py-2">
        <Button
          variant="ghost"
          size="icon"
          accessibilityLabel={t('common.back')}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
          <Icon as={ArrowLeft} size={18} />
        </Button>
        <SubjectIcon subject={section.subject} size="sm" />
        <View className="flex-1">
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {section.subject.name} · {section.book_title}
          </Text>
          <Text className="text-sm font-semibold" numberOfLines={1}>
            {section.title}
          </Text>
        </View>
        {previewClassId && (
          <View className="flex-row items-center gap-1.5 rounded-full bg-secondary px-3 py-1">
            <Icon as={Eye} size={14} />
            <Text className="text-xs">{t('reader.previewBadge')}</Text>
          </View>
        )}
        <View className="flex-row items-center">
          <Button
            variant="ghost"
            size="icon"
            accessibilityLabel={t('reader.zoomOut')}
            disabled={zoom <= READER_ZOOM.min}
            onPress={() => changeZoom(-1)}>
            <Icon as={ZoomOut} size={18} />
          </Button>
          <Text className="w-12 text-center text-xs tabular-nums text-muted-foreground">{Math.round(zoom * 100)} %</Text>
          <Button
            variant="ghost"
            size="icon"
            accessibilityLabel={t('reader.zoomIn')}
            disabled={zoom >= READER_ZOOM.max}
            onPress={() => changeZoom(1)}>
            <Icon as={ZoomIn} size={18} />
          </Button>
          {showNotes && <NotesLayoutPicker />}
        </View>
      </View>

      <View className="flex-1 flex-row">
        <View className="flex-1">
          {!previewClassId && <LessonTabs />}
          {toolOpen && !previewClassId && <WebToolPlaceholder />}
          {/* Stays mounted under a tool tab, so the material keeps its place. */}
          <View className={cn('flex-1', toolOpen && !previewClassId && 'hidden')}>
            <PdfViewer key={section.id} url={api.sectionPdfUrl(section.id, previewClassId)} zoom={zoom} />
            <View className="flex-row items-center gap-3 border-t border-border px-4 py-2">
              <View className="flex-1 items-start">
                <Button variant="outline" size="sm" disabled={!section.prev_id} onPress={() => go(section.prev_id)}>
                  <Icon as={ChevronLeft} />
                  <Text>{t('reader.previous')}</Text>
                </Button>
              </View>
              <Text className="text-xs tabular-nums text-muted-foreground">
                {t('reader.position', { index: section.index + 1, total: section.total, pages: section.page_count })}
              </Text>
              <View className="flex-1 items-end">
                <Button size="sm" disabled={!section.next_id} onPress={() => go(section.next_id)}>
                  <Text>{t('reader.next')}</Text>
                  <Icon as={ChevronRight} />
                </Button>
              </View>
            </View>
          </View>
        </View>
        {showNotes && notesLayout !== 'hidden' && (
          <LessonNotePane subjectId={section.subject.id} half={notesLayout === 'half'} />
        )}
      </View>
    </View>
  );
}

const NOTES_LAYOUTS: { value: NotesLayout; icon: LucideIcon; label: string }[] = [
  { value: 'hidden', icon: Square, label: 'reader.layout.hidden' },
  { value: 'side', icon: PanelRight, label: 'reader.layout.side' },
  { value: 'half', icon: Columns2, label: 'reader.layout.half' },
];

/** The student chooses what gets the screen: only the material, the material with notes beside it, or half each. */
function NotesLayoutPicker() {
  const { t } = useTranslation();
  const notesLayout = usePreferencesStore((state) => state.notesLayout);
  const setNotesLayout = usePreferencesStore((state) => state.setNotesLayout);
  return (
    <View role="radiogroup" aria-label={t('reader.layout.title')} className="ml-1 flex-row gap-0.5 rounded-lg bg-muted p-0.5">
      {NOTES_LAYOUTS.map(({ value, icon, label }) => (
        <Tooltip key={value}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              role="radio"
              aria-checked={notesLayout === value}
              accessibilityLabel={t(label)}
              className={cn('h-8 w-8 sm:h-8 sm:w-8', notesLayout === value && 'bg-background shadow-sm shadow-black/5')}
              onPress={() => setNotesLayout(value)}>
              <Icon as={icon} size={16} className={notesLayout === value ? 'text-foreground' : 'text-muted-foreground'} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <Text>{t(label)}</Text>
          </TooltipContent>
        </Tooltip>
      ))}
    </View>
  );
}
