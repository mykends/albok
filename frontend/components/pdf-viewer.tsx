import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, View } from 'react-native';

// pdf.js is loaded from /pdfjs/loader.mjs (see app/+html.tsx), not bundled by Metro.
type PdfViewport = { width: number; height: number };
type PdfPage = {
  getViewport: (options: { scale: number }) => PdfViewport;
  render: (options: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }) => { promise: Promise<void>; cancel: () => void };
  cleanup: () => void;
};
type PdfDocument = { numPages: number; getPage: (n: number) => Promise<PdfPage>; destroy: () => Promise<void> };
type PdfjsLib = {
  getDocument: (source: object) => { promise: Promise<PdfDocument>; destroy: () => Promise<void> };
};

const MAX_PAGE_WIDTH = 920;

function loadPdfjs(): Promise<PdfjsLib> {
  const existing = (globalThis as { pdfjsLib?: PdfjsLib }).pdfjsLib;
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('pdf.js did not load')), 15000);
    if (!window.document.querySelector('script[data-albok-pdfjs]')) {
      const script = window.document.createElement('script');
      script.type = 'module';
      script.src = '/pdfjs/loader.mjs';
      script.dataset.albokPdfjs = '';
      window.document.head.appendChild(script);
    }
    window.addEventListener(
      'albok-pdfjs-ready',
      () => {
        clearTimeout(timeout);
        resolve((globalThis as { pdfjsLib?: PdfjsLib }).pdfjsLib!);
      },
      { once: true }
    );
  });
}

/** Renders a PDF (fetched with the session cookie) as canvases. There are no download or print controls.
 * `pageLabels` and `targetPage` are for professors choosing page ranges. */
export function PdfViewer({
  url,
  zoom,
  className,
  pageLabels,
  targetPage,
}: {
  url: string;
  zoom: number;
  className?: string;
  pageLabels?: boolean;
  targetPage?: number;
}) {
  const { t } = useTranslation();
  const hostRef = useRef<View>(null);
  const documentRef = useRef<PdfDocument | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<PdfjsLib['getDocument']> | null = null;
    setStatus('loading');
    loadPdfjs()
      .then((pdfjs) => {
        task = pdfjs.getDocument({
          url,
          withCredentials: true,
          isEvalSupported: false,
          enableScripting: false,
          wasmUrl: '/pdfjs/wasm/',
          standardFontDataUrl: '/pdfjs/standard_fonts/',
          cMapUrl: '/pdfjs/cmaps/',
          cMapPacked: true,
          iccUrl: '/pdfjs/iccs/',
        });
        return task.promise;
      })
      .then((document) => {
        if (cancelled) return void document.destroy();
        documentRef.current = document;
        setStatus('ready');
      })
      .catch(() => !cancelled && setStatus('error'));
    return () => {
      cancelled = true;
      documentRef.current = null;
      void task?.destroy();
    };
  }, [url]);

  useEffect(() => {
    const host = hostRef.current as unknown as HTMLElement | null;
    const document = documentRef.current;
    if (status !== 'ready' || !host || !document || !width) return;

    let cancelled = false;
    const pageWidth = Math.min(width - 32, MAX_PAGE_WIDTH) * zoom;
    const ratio = window.devicePixelRatio || 1;
    const renders: { cancel: () => void }[] = [];
    host.replaceChildren();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          const slot = entry.target as HTMLElement & { albokPage?: PdfPage };
          const page = slot.albokPage;
          if (!page || cancelled) continue;
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (pageWidth / base.width) * ratio });
          const canvas = window.document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = '100%';
          canvas.style.height = '100%';
          canvas.style.display = 'block';
          canvas.addEventListener('contextmenu', (event) => event.preventDefault());
          slot.replaceChildren(canvas);
          const render = page.render({ canvasContext: canvas.getContext('2d')!, viewport });
          renders.push(render);
          render.promise.catch(() => {});
        }
      },
      { rootMargin: '800px 0px' }
    );

    (async () => {
      for (let n = 1; n <= document.numPages && !cancelled; n++) {
        const page = await document.getPage(n);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const slot = window.document.createElement('div') as HTMLDivElement & { albokPage?: PdfPage };
        slot.albokPage = page;
        Object.assign(slot.style, {
          width: `${pageWidth}px`,
          height: `${(pageWidth * base.height) / base.width}px`,
          margin: '0 auto 16px',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,.15)',
          borderRadius: '2px',
          overflow: 'hidden',
          userSelect: 'none',
        });
        if (pageLabels) {
          const label = window.document.createElement('div');
          label.textContent = String(n);
          label.dataset.albokPageLabel = String(n);
          Object.assign(label.style, { width: `${pageWidth}px`, margin: '0 auto 4px', font: '12px system-ui', color: '#888' });
          host.appendChild(label);
        }
        host.appendChild(slot);
        observer.observe(slot);
      }
    })();

    return () => {
      cancelled = true;
      observer.disconnect();
      renders.forEach((render) => render.cancel());
    };
  }, [status, width, zoom, pageLabels]);

  useEffect(() => {
    const host = hostRef.current as unknown as HTMLElement | null;
    if (!host || !targetPage || status !== 'ready') return;
    // Pages are added asynchronously; retry briefly until the target exists.
    let tries = 0;
    const timer = setInterval(() => {
      const label = host.querySelector(`[data-albok-page-label="${targetPage}"]`);
      if (label || ++tries > 20) {
        clearInterval(timer);
        label?.scrollIntoView({ block: 'start' });
      }
    }, 100);
    return () => clearInterval(timer);
  }, [targetPage, status, width, zoom]);

  return (
    <ScrollView
      className={cn('flex-1 bg-muted/50', className)}
      contentContainerClassName="py-4"
      horizontal={false}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {status === 'loading' && (
        <View className="items-center py-16">
          <ActivityIndicator />
        </View>
      )}
      {status === 'error' && (
        <View className="items-center px-6 py-16">
          <Text className="text-muted-foreground">{t('reader.pdfError')}</Text>
        </View>
      )}
      <ScrollView horizontal contentContainerClassName="min-w-full">
        <View ref={hostRef} className="min-w-full px-4" />
      </ScrollView>
    </ScrollView>
  );
}
