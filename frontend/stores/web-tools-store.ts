import { api, type StudentWebTool } from '@/lib/api';
import { kioskBridge, webToolMode } from '@/lib/kiosk';
import { create } from 'zustand';

export type ToolStatus = 'loading' | 'ready' | 'unreachable' | 'wrong-site';
export type Frame = { x: number; y: number; width: number; height: number };

type WebToolsState = {
  lessonId: number | null;
  tools: StudentWebTool[];
  /** The tool tab being shown; null means the material. */
  active: number | null;
  /** Tools already announced this lesson, so the notice shows once per tool. */
  seen: number[];
  notice: StudentWebTool | null;
  status: Record<string, ToolStatus>;
  /** When a navigation was last refused in each tool, for the "not allowed" notice. */
  blockedAt: Record<string, number>;
  /** The section the student last read this lesson; tool buttons open the reader there. */
  lastSectionId: number | null;
  /** Tool areas by placeholder id (KTD10). Only the focused screen's area is registered. */
  frames: Record<string, Frame>;
  poll: () => Promise<void>;
  clear: () => Promise<void>;
  setActive: (toolId: number | null) => void;
  dismissNotice: () => void;
  setStatus: (tool: StudentWebTool, status: ToolStatus) => void;
  blocked: (tool: StudentWebTool) => void;
  setLastSection: (sectionId: number) => void;
  setFrame: (owner: string, frame: Frame | null) => void;
};

/** The visible tool area: the most recently measured one with a size. */
export function currentFrame(frames: Record<string, Frame>): Frame | null {
  return Object.values(frames).at(-1) ?? null;
}

/** Whether a tool tab (not the material) is being shown. */
export function isToolActive(state: Pick<WebToolsState, 'active' | 'tools'>): boolean {
  return state.active !== null && state.tools.some((tool) => tool.id === state.active);
}

function sameTools(a: StudentWebTool[], b: StudentWebTool[]) {
  return a.length === b.length && a.every((tool, i) => tool.id === b[i].id && tool.name === b[i].name && tool.url === b[i].url);
}

/** Status is kept per tool and link, so a link the professor edits starts over. */
export const toolKey = (tool: StudentWebTool) => `${tool.id}|${tool.url}`;

async function pushToShell(urls: string[], endsInMs: number) {
  if (webToolMode() !== 'tabs') return;
  try {
    await kioskBridge()?.setWebTools?.(urls, endsInMs);
  } catch {
    // The shell then keeps its previous list until the lesson's end.
  }
}

// Bumped by every poll and by clear(); a poll whose number is stale was overtaken and must not touch the shell or state.
let pollGeneration = 0;

export const useWebTools = create<WebToolsState>()((set, get) => ({
  lessonId: null,
  tools: [],
  active: null,
  seen: [],
  notice: null,
  status: {},
  blockedAt: {},
  lastSectionId: null,
  frames: {},

  poll: async () => {
    const generation = ++pollGeneration;
    let response;
    try {
      response = await api.studentWebTools();
    } catch {
      if (generation !== pollGeneration) return;
      // Without an answer nothing stays open; the next poll restores what the professor still has open.
      await pushToShell([], 0);
      if (generation !== pollGeneration) return;
      const state = get();
      if (state.tools.length || state.active !== null || state.notice) set({ tools: [], active: null, status: {}, notice: null });
      return;
    }
    if (generation !== pollGeneration) return;
    const tools = response.lesson_id === null ? [] : response.tools;
    const endsInMs =
      response.lesson_ends_at === null
        ? 0
        : Date.parse(response.lesson_ends_at) - Date.parse(response.server_time);
    // The shell must know a tool before its webview attaches, so it hears first.
    await pushToShell(
      tools.map((tool) => tool.url),
      endsInMs
    );
    if (generation !== pollGeneration) return;

    const state = get();
    const sameLesson = response.lesson_id === state.lessonId;
    // Most polls change nothing; keeping the state as it is spares every tab and webview a re-render.
    if (sameLesson && sameTools(tools, state.tools)) return;
    const seen = sameLesson ? state.seen : [];
    const fresh = tools.filter((tool) => !seen.includes(tool.id));
    const keys = new Set(tools.map(toolKey));
    const keep = <T>(record: Record<string, T>) =>
      Object.fromEntries(Object.entries(record).filter(([key]) => sameLesson && keys.has(key)));
    const active =
      sameLesson && tools.some((tool) => tool.id === state.active) ? state.active : null;
    set({
      lessonId: response.lesson_id,
      tools,
      active,
      seen: [...seen, ...fresh.map((tool) => tool.id)],
      notice:
        fresh.at(-1) ??
        (sameLesson && state.notice && tools.some((t) => t.id === state.notice!.id)
          ? state.notice
          : null),
      status: keep(state.status),
      blockedAt: keep(state.blockedAt),
      lastSectionId: sameLesson ? state.lastSectionId : null,
    });
  },

  clear: async () => {
    pollGeneration++;
    await pushToShell([], 0);
    set({
      lessonId: null,
      tools: [],
      active: null,
      seen: [],
      notice: null,
      status: {},
      blockedAt: {},
      lastSectionId: null,
    });
  },

  setActive: (toolId) =>
    set({
      active: toolId,
      notice: toolId !== null && get().notice?.id === toolId ? null : get().notice,
    }),
  dismissNotice: () => set({ notice: null }),
  setStatus: (tool, status) =>
    set((state) => ({ status: { ...state.status, [toolKey(tool)]: status } })),
  blocked: (tool) =>
    set((state) => {
      const key = toolKey(tool);
      // Refused before the first page loaded: the professor's link itself leads elsewhere.
      if (state.status[key] !== 'ready')
        return { status: { ...state.status, [key]: 'wrong-site' } };
      return { blockedAt: { ...state.blockedAt, [key]: Date.now() } };
    }),
  setLastSection: (sectionId) => set({ lastSectionId: sectionId }),
  setFrame: (owner, frame) =>
    set((state) => {
      const { [owner]: _previous, ...others } = state.frames;
      // Re-inserting moves this area to the end, so it becomes the current one.
      return {
        frames:
          frame && frame.width > 0 && frame.height > 0 ? { ...others, [owner]: frame } : others,
      };
    }),
}));
