import { EmptyState } from '@/components/empty-state';
import { LessonNotePane } from '@/components/lesson-note-pane';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { LessonTabs } from '@/components/web-tools/lesson-tabs';
import { WebToolPlaceholder } from '@/components/web-tools/web-tool-layer';
import { webToolMode } from '@/lib/kiosk';
import { usePreferencesStore } from '@/stores/preferences-store';
import { useStudent } from '@/stores/student-store';
import { isToolActive, useWebTools } from '@/stores/web-tools-store';
import { router } from 'expo-router';
import Head from 'expo-router/head';
import { AppWindow } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useWindowDimensions, View } from 'react-native';

/** The lesson's web tools when no section is open in the reader, with the lesson note beside them. */
export default function LessonScreen() {
  const { t } = useTranslation();
  const lesson = useStudent((state) => state.now?.lesson ?? null);
  const tools = useWebTools((state) => state.tools);
  const toolActive = useWebTools(isToolActive);
  const setActive = useWebTools((state) => state.setActive);
  const notesPanelOpen = usePreferencesStore((state) => state.notesPanelOpen);
  const { width } = useWindowDimensions();
  const available = webToolMode() === 'tabs' && lesson !== null && tools.length > 0;
  // Set when the student picks the material tab, so the tool isn't chosen again on the way out.
  const leaving = useRef(false);

  // This screen is only for tools: keep one selected, e.g. after the professor closes the shown one.
  useEffect(() => {
    if (available && !toolActive && !leaving.current) setActive(tools[0].id);
  }, [available, toolActive, tools, setActive]);

  if (!available) {
    return (
      <View className="flex-1 p-10">
        <EmptyState
          icon={AppWindow}
          title={t('webTools.student.noneTitle')}
          description={t('webTools.student.none')}>
          <Button variant="outline" onPress={() => router.replace('/')}>
            <Text>{t('reader.backHome')}</Text>
          </Button>
        </EmptyState>
      </View>
    );
  }

  return (
    <View className="flex-1">
      <Head>
        <title>{`${lesson.subject_name} · Albok`}</title>
      </Head>
      <View className="flex-1 flex-row">
        <View className="flex-1">
          <LessonTabs
            onMaterial={() => {
              leaving.current = true;
              router.replace('/');
            }}
          />
          <WebToolPlaceholder />
        </View>
        {notesPanelOpen && (
          <LessonNotePane
            subjectId={lesson.subject_id}
            className={width < 1100 ? 'w-80' : 'w-[26rem]'}
          />
        )}
      </View>
    </View>
  );
}
