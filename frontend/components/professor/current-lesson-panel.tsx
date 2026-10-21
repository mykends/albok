import { PageSection } from '@/components/layout';
import { openInOwnBrowser, WebToolForm } from '@/components/professor/web-tools-tab';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { api, type TeachingLesson } from '@/lib/api';
import { formatTime } from '@/lib/format';
import { errorMessage } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useProfessor } from '@/stores/professor-store';
import { AppWindow, ExternalLink, Presentation } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

/** "Your lesson now": while a lesson runs, its professor opens and closes web tools for it. The
 * staff shell polls the lessons; this shows nothing outside lessons. */
export function CurrentLessonPanel() {
  const { t } = useTranslation();
  const teaching = useProfessor((state) => state.teaching);
  const refreshTeaching = useProfessor((state) => state.refreshTeaching);

  useEffect(() => {
    void refreshTeaching(false);
  }, [refreshTeaching]);

  if (!teaching.length) return null;
  return (
    <PageSection title={t('webTools.lesson.title')}>
      {teaching.map((lesson) => (
        <LessonCard key={lesson.lesson_id} lesson={lesson} />
      ))}
    </PageSection>
  );
}

function LessonCard({ lesson }: { lesson: TeachingLesson }) {
  const { t } = useTranslation();
  const replaceLesson = useProfessor((state) => state.replaceLesson);
  const refreshTeaching = useProfessor((state) => state.refreshTeaching);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(toolId: number, open: boolean) {
    setBusyId(toolId);
    setError(null);
    try {
      replaceLesson(await api.setLessonTool(lesson.lesson_id, toolId, open));
    } catch (e) {
      setError(errorMessage(e));
      // The lesson may just have ended.
      void refreshTeaching(false);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <View className="gap-4 rounded-xl border border-primary/40 bg-card p-5">
      <View className="flex-row flex-wrap items-center gap-3">
        <View className="size-9 items-center justify-center rounded-lg bg-primary">
          <Icon as={Presentation} size={18} className="text-primary-foreground" />
        </View>
        <Text className="text-lg font-semibold">
          {t('webTools.lesson.summary', {
            className: lesson.class_name,
            subject: lesson.subject_name,
            start: formatTime(lesson.starts_at),
            end: formatTime(lesson.ends_at),
          })}
        </Text>
        {lesson.substitute && (
          <Badge variant="secondary">
            <Text>{t('webTools.lesson.substitute')}</Text>
          </Badge>
        )}
      </View>
      <Text className="-mt-2 text-sm text-muted-foreground">{t('webTools.lesson.hint')}</Text>

      {lesson.tools.length === 0 ? (
        <Text className="text-sm text-muted-foreground">
          {lesson.can_edit_tools ? t('webTools.lesson.noTools') : t('webTools.lesson.noToolsSubstitute')}
        </Text>
      ) : (
        <View className="gap-1">
          {lesson.tools.map((tool) => (
            <View
              key={tool.id}
              className={cn('flex-row flex-wrap items-center gap-2 rounded-md px-2 py-1.5', tool.open ? 'bg-primary/10' : 'web:hover:bg-accent/60')}>
              <Icon as={AppWindow} size={16} className={tool.open ? 'text-primary' : 'text-muted-foreground'} />
              <View className="min-w-40 flex-1">
                <Text className="font-medium">{tool.name}</Text>
                <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                  {tool.url}
                </Text>
              </View>
              {tool.open && (
                <Badge>
                  <Text>{t('webTools.lesson.isOpen')}</Text>
                </Badge>
              )}
              <Button variant="ghost" size="icon" accessibilityLabel={t('webTools.try')} onPress={() => openInOwnBrowser(tool.url)}>
                <Icon as={ExternalLink} />
              </Button>
              <Button
                size="sm"
                variant={tool.open ? 'outline' : 'default'}
                disabled={busyId !== null}
                onPress={() => toggle(tool.id, !tool.open)}
                className="w-36">
                <Text>{tool.open ? t('webTools.lesson.close') : t('webTools.lesson.open')}</Text>
              </Button>
            </View>
          ))}
        </View>
      )}
      {error && <Text className="text-sm text-destructive">{error}</Text>}

      {lesson.can_edit_tools && (
        <View className="gap-3 border-t border-border pt-4">
          <Text className="text-sm font-semibold">{t('webTools.lesson.addTitle')}</Text>
          <WebToolForm
            submitLabel={t('webTools.lesson.addAndOpen')}
            onSubmit={async (name, url) => {
              replaceLesson(await api.addLessonTool(lesson.lesson_id, name, url));
            }}
          />
        </View>
      )}
    </View>
  );
}
