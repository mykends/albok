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
import { api, ApiError, type ReaderSection } from '@/lib/api';
import { errorMessage } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { READER_ZOOM, usePreferencesStore } from '@/stores/preferences-store';
import { useSession } from '@/stores/session-store';
import { useStudent } from '@/stores/student-store';
import { useWebTools } from '@/stores/web-tools-store';
import { router, useLocalSearchParams } from 'expo-router';
import Head from 'expo-router/head';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Eye,
  PanelRight,
  PanelRightClose,
  ZoomIn,
  ZoomOut,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, useWindowDimensions, View } from 'react-native';

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
  if (!section || section.id !== sectionId) {
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
  const notesPanelOpen = usePreferencesStore((state) => state.notesPanelOpen);
  const toggleNotesPanel = usePreferencesStore((state) => state.toggleNotesPanel);
  const toolOpen = useWebTools((state) => state.active !== null && state.tools.some((tool) => tool.id === state.active));
  const { width } = useWindowDimensions();

  const go = (id: number | null) => {
    if (id === null) return;
    router.replace({
      pathname: '/read/[sectionId]',
      params: previewClassId ? { sectionId: String(id), preview: String(previewClassId) } : { sectionId: String(id) },
    });
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
          {showNotes && (
            <Button
              variant="ghost"
              size="icon"
              accessibilityLabel={notesPanelOpen ? t('reader.hideNotes') : t('reader.showNotes')}
              onPress={toggleNotesPanel}>
              <Icon as={notesPanelOpen ? PanelRightClose : PanelRight} size={18} />
            </Button>
          )}
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
        {showNotes && notesPanelOpen && (
          <LessonNotePane subjectId={section.subject.id} className={width < 1100 ? 'w-80' : 'w-[26rem]'} />
        )}
      </View>
    </View>
  );
}
