import { useOpenWebTool } from '@/components/web-tools/lesson-tabs';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { webToolMode } from '@/lib/kiosk';
import { useWebTools } from '@/stores/web-tools-store';
import { AppWindow, X } from 'lucide-react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

const NOTICE_MS = 15_000;

/** A short notice when the professor opens a tool. The student stays where they are (R12). */
export function WebToolNotice() {
  const { t } = useTranslation();
  const notice = useWebTools((state) => state.notice);
  const dismiss = useWebTools((state) => state.dismissNotice);
  const openTool = useOpenWebTool();

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(dismiss, NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice, dismiss]);

  if (!notice || webToolMode() === 'hidden') return null;
  const inKiosk = webToolMode() === 'tabs';
  return (
    <View className="absolute bottom-6 right-6 max-w-sm" pointerEvents="box-none">
      <View
        role="status"
        className="gap-3 rounded-xl border border-border bg-card p-4 shadow-lg shadow-black/10">
        <View className="flex-row items-start gap-3">
          <View className="size-9 items-center justify-center rounded-lg bg-primary">
            <Icon as={AppWindow} size={18} className="text-primary-foreground" />
          </View>
          <View className="flex-1">
            <Text className="text-sm text-muted-foreground">
              {t('webTools.student.noticeTitle')}
            </Text>
            <Text className="font-semibold">{notice.name}</Text>
          </View>
          <Button
            variant="ghost"
            size="icon"
            accessibilityLabel={t('common.close')}
            onPress={dismiss}>
            <Icon as={X} size={16} />
          </Button>
        </View>
        <Text className="text-sm text-muted-foreground">
          {inKiosk ? t('webTools.student.noticeHint') : t('webTools.student.noticeHintLinks')}
        </Text>
        {inKiosk && (
          <Button size="sm" className="self-start" onPress={() => openTool(notice.id)}>
            <Text>{t('webTools.student.open')}</Text>
          </Button>
        )}
      </View>
    </View>
  );
}
