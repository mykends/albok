import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { api } from '@/lib/api';
import { kioskBridge } from '@/lib/kiosk';
import { serverNow, useSession } from '@/stores/session-store';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';

const PING_INTERVAL_MS = 60_000;
const WARN_BEFORE_MS = 60_000;
// Sign out a little before the server's end-of-day cut-off so the final note flush is still accepted.
const DAY_END_MARGIN_MS = 30_000;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/**
 * Signs students out after the idle timeout and at the end of the school day, and tells the server
 * about activity (scrolling a PDF makes no API calls on its own).
 */
export function SessionWatch() {
  const { t } = useTranslation();
  const me = useSession((state) => state.me);
  const signOut = useSession((state) => state.signOut);
  const lastActivity = useRef(Date.now());
  const lastPing = useRef(Date.now());
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || !me) return;
    const onActivity = () => {
      lastActivity.current = Date.now();
    };
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, onActivity, { capture: true, passive: true });
    window.addEventListener('scroll', onActivity, { capture: true, passive: true });
    // Input inside a web tool goes to the tool, not this page; the kiosk shell passes it on.
    const stopToolActivity = kioskBridge()?.onWebToolActivity?.(onActivity);

    const isStudent = me.is_student && !me.is_professor && !me.is_admin;
    const idleMs = me.idle_minutes * 60_000;
    const expiresAt = me.session_expires_at ? new Date(me.session_expires_at).getTime() : null;
    let signingOut = false;

    const tick = setInterval(() => {
      const now = Date.now();
      if (lastActivity.current > lastPing.current && now - lastPing.current >= PING_INTERVAL_MS) {
        lastPing.current = now;
        api.ping().catch(() => {});
      }
      if (!isStudent || signingOut) return;
      const idleFor = now - lastActivity.current;
      if (idleFor >= idleMs) {
        signingOut = true;
        void signOut('idle');
        return;
      }
      if (expiresAt && serverNow().getTime() >= expiresAt - DAY_END_MARGIN_MS) {
        signingOut = true;
        void signOut('day-end');
        return;
      }
      setSecondsLeft(idleMs - idleFor <= WARN_BEFORE_MS ? Math.ceil((idleMs - idleFor) / 1000) : null);
    }, 1000);

    return () => {
      clearInterval(tick);
      stopToolActivity?.();
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, onActivity, { capture: true });
      window.removeEventListener('scroll', onActivity, { capture: true });
    };
  }, [me, signOut]);

  if (secondsLeft === null) return null;
  return (
    <View className="absolute inset-x-0 bottom-6 items-center" pointerEvents="box-none">
      <View className="flex-row items-center gap-4 rounded-xl border border-border bg-card px-5 py-3 shadow-lg shadow-black/10">
        <Text>{t('session.idleWarning', { seconds: secondsLeft })}</Text>
        <Button size="sm" onPress={() => setSecondsLeft(null)}>
          <Text>{t('session.stay')}</Text>
        </Button>
      </View>
    </View>
  );
}
