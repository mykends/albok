import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import type { StudentWebTool } from '@/lib/api';
import { kioskBridge, webToolMode } from '@/lib/kiosk';
import { cn } from '@/lib/utils';
import { currentFrame, toolKey, useWebTools, type Frame } from '@/stores/web-tools-store';
import { useFocusEffect } from 'expo-router';
import { Ban, TriangleAlert, WifiOff } from 'lucide-react-native';
import { createElement, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Platform, View } from 'react-native';

// The kiosk shell checks and hardens every webview (desktop/main.js); this partition is forced there too.
const PARTITION = 'albok-webtools';
const BLOCKED_NOTICE_MS = 4000;

type WebviewElement = HTMLElement & { getWebContentsId(): number; reload(): void };
type FailEvent = Event & { errorCode?: number; isMainFrame?: boolean };

/** Where a screen shows the active tool. The tool itself lives in WebToolLayer, which covers this area,
 * so it keeps its page while the student moves between sections and screens. Only the focused screen's
 * area counts: screens below it in the navigation stack stay mounted, hidden. */
export function WebToolPlaceholder({ className }: { className?: string }) {
  const owner = useId();
  const ref = useRef<View>(null);
  const setFrame = useWebTools((state) => state.setFrame);

  const track = useCallback(() => {
    const node = ref.current as unknown as HTMLElement | null;
    if (Platform.OS !== 'web' || !node) return;
    let last = '';
    const measure = () => {
      const rect = node.getBoundingClientRect();
      const frame = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
      const key = JSON.stringify(frame);
      if (key === last) return;
      last = key;
      setFrame(owner, frame);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    observer.observe(document.body);
    if (node.parentElement) observer.observe(node.parentElement);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      setFrame(owner, null);
    };
  }, [owner, setFrame]);
  useFocusEffect(track);

  return <View ref={ref} className={cn('flex-1 bg-background', className)} />;
}

/** Every open tool's webview, mounted for the whole lesson and placed over the active screen's tool
 * area. It is ordinary DOM, so dialogs still stack above it (KTD4, KTD10). */
export function WebToolLayer() {
  const tools = useWebTools((state) => state.tools);
  const active = useWebTools((state) => state.active);
  const frame = useWebTools((state) => currentFrame(state.frames));
  const lastFrame = useRef<Frame>({ x: 0, y: 0, width: 0, height: 0 });

  useEffect(() => {
    // The shell names the guest by its webContents id; find which tool that is.
    return kioskBridge()?.onWebToolBlocked?.(({ webContentsId }) => {
      for (const view of document.querySelectorAll<WebviewElement>('webview[data-tool-key]')) {
        let id: number | null = null;
        try {
          id = view.getWebContentsId();
        } catch {
          continue; // not attached yet
        }
        if (id !== webContentsId) continue;
        const tool = useWebTools.getState().tools.find((t) => toolKey(t) === view.dataset.toolKey);
        if (tool) useWebTools.getState().blocked(tool);
      }
    });
  }, []);

  if (Platform.OS !== 'web' || webToolMode() !== 'tabs' || tools.length === 0) return null;
  const visible = active !== null && frame !== null && tools.some((tool) => tool.id === active);
  // While hidden, keep the last size so tool pages don't re-lay themselves out at zero width.
  if (frame) lastFrame.current = frame;
  const { x, y, width, height } = lastFrame.current;

  return (
    <div
      aria-hidden={!visible}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        width,
        height,
        visibility: visible ? 'visible' : 'hidden',
        pointerEvents: visible ? 'auto' : 'none',
      }}>
      {tools.map((tool) => (
        <ToolView key={toolKey(tool)} tool={tool} shown={visible && tool.id === active} />
      ))}
    </div>
  );
}

function ToolView({ tool, shown }: { tool: StudentWebTool; shown: boolean }) {
  const { t } = useTranslation();
  const key = toolKey(tool);
  const ref = useRef<WebviewElement>(null);
  const status = useWebTools((state) => state.status[key] ?? 'loading');
  const blockedAt = useWebTools((state) => state.blockedAt[key]);
  const setStatus = useWebTools((state) => state.setStatus);
  const [showBlocked, setShowBlocked] = useState(false);

  useEffect(() => {
    const view = ref.current;
    if (!view) return;
    const current = () => useWebTools.getState().status[key] ?? 'loading';
    // A failed load still commits Chromium's error page, whose dom-ready must not count as loaded.
    const onReady = () => {
      if (current() === 'loading') setStatus(tool, 'ready');
    };
    const onFail = (event: FailEvent) => {
      // -3 is an aborted load, e.g. one the shell refused; that arrives as a blocked event instead.
      if (event.isMainFrame && event.errorCode !== -3 && current() === 'loading')
        setStatus(tool, 'unreachable');
    };
    view.addEventListener('dom-ready', onReady);
    view.addEventListener('did-fail-load', onFail);
    return () => {
      view.removeEventListener('dom-ready', onReady);
      view.removeEventListener('did-fail-load', onFail);
    };
    // `tool` changes identity on every poll; its key is what matters.
  }, [key, setStatus]);

  useEffect(() => {
    if (!blockedAt) return;
    setShowBlocked(true);
    const timer = setTimeout(() => setShowBlocked(false), BLOCKED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [blockedAt]);

  return (
    <div style={{ position: 'absolute', inset: 0, visibility: shown ? 'visible' : 'hidden' }}>
      {createElement('webview', {
        ref,
        src: tool.url,
        partition: PARTITION,
        'data-tool-key': key,
        style: { width: '100%', height: '100%' },
      })}
      {shown && status === 'loading' && (
        <Cover>
          <ActivityIndicator />
          <Text className="text-muted-foreground">{t('common.loading')}</Text>
        </Cover>
      )}
      {shown && status === 'unreachable' && (
        <Cover>
          <Icon as={WifiOff} size={28} className="text-muted-foreground" />
          <Text className="max-w-md text-center">{t('webTools.student.unreachable')}</Text>
          <Button
            variant="outline"
            onPress={() => {
              setStatus(tool, 'loading');
              ref.current?.reload();
            }}>
            <Text>{t('session.retry')}</Text>
          </Button>
        </Cover>
      )}
      {shown && status === 'wrong-site' && (
        <Cover>
          <Icon as={TriangleAlert} size={28} className="text-muted-foreground" />
          <Text className="max-w-md text-center">{t('webTools.student.wrongSite')}</Text>
        </Cover>
      )}
      {shown && status === 'ready' && showBlocked && (
        <View className="absolute inset-x-0 top-3 items-center" pointerEvents="none">
          <View className="flex-row items-center gap-2 rounded-full bg-foreground px-4 py-2 shadow-lg shadow-black/20">
            <Icon as={Ban} size={16} className="text-background" />
            <Text className="text-sm font-medium text-background">
              {t('webTools.student.notAllowed')}
            </Text>
          </View>
        </View>
      )}
    </div>
  );
}

function Cover({ children }: { children: React.ReactNode }) {
  return (
    <View className="absolute inset-0 items-center justify-center gap-3 bg-background p-6">
      {children}
    </View>
  );
}
