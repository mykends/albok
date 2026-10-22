import './note-content.css';

import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { noteHtml } from '@/lib/note-content';
import { cn } from '@/lib/utils';
import TextAlign from '@tiptap/extension-text-align';
import { Placeholder } from '@tiptap/extensions';
import { TextSelection } from '@tiptap/pm/state';
import { EditorContent, Extension, textInputRule, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  Bold,
  ChevronLeft,
  ChevronRight,
  Heading1,
  Heading2,
  Italic,
  List,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  Underline,
  type LucideIcon,
} from 'lucide-react-native';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View, type ViewProps } from 'react-native';

/** The formatting a note may have: a title and a subtitle, bold/italic/underline, bullet lists and
 * alignment. There is deliberately nothing for fonts, sizes or colours, and pasted text loses them,
 * because nothing in the editor can hold them. The server keeps the same set (note_html.py). */
function noteExtensions(placeholder: string) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2] },
      blockquote: false,
      code: false,
      codeBlock: false,
      horizontalRule: false,
      link: false,
      strike: false,
    }),
    // Left is no alignment at all, as the server stores it; otherwise saved notes would differ from the editor's.
    TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['center', 'right'] }),
    Placeholder.configure({ placeholder }),
    Symbols,
  ];
}

// What students type for a symbol, and the symbol. Each rule fires as its last character is typed, so
// <-> and <=> arrive as ← and ≤ first and the next character completes them.
const SYMBOL_RULES: [RegExp, string][] = [
  [/->$/, '→'],
  [/<-$/, '←'],
  [/←>$/, '↔'],
  [/=>$/, '⇒'],
  [/<=$/, '≤'],
  [/≤>$/, '⇔'],
  [/>=$/, '≥'],
  [/!=$/, '≠'],
  [/~=$/, '≈'],
  [/\+\/-$/, '±'],
  [/\^2$/, '²'],
  [/\^3$/, '³'],
];

/** Turns -> into → (and the rest of SYMBOL_RULES) while typing. Backspace straight after brings the
 * typed characters back, and pasted text is left as it is. */
const Symbols = Extension.create({
  name: 'symbols',
  addInputRules: () => SYMBOL_RULES.map(([find, replace]) => textInputRule({ find, replace })),
});

/** A lesson note with formatting (web only). `paged` fills the parent's height and shows one page at a
 * time, turning to the next when the writing reaches the bottom; otherwise the note grows with its text. */
export function RichNoteEditor({
  value,
  onChange,
  editable,
  autoFocus,
  placeholder = '',
  paged,
  minHeight,
  status,
}: {
  /** Editor HTML, or an old plain-text note. */
  value: string;
  onChange?: (html: string) => void;
  editable: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  paged?: boolean;
  /** Outside pages: a min-height class for the writing area. */
  minHeight?: string;
  /** In pages: shown before the page controls, e.g. whether the note is saved. */
  status?: ReactNode;
}) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // What the editor last reported, to tell its own changes from a different note arriving in `value`.
  const emitted = useRef(value);

  const editor = useEditor({
    extensions: noteExtensions(placeholder),
    content: noteHtml(value),
    editable,
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: { class: 'note-content' },
      // In pages, the page window follows the caret instead (see usePages).
      handleScrollToSelection: () => !!paged,
    },
    onUpdate: ({ editor }) => {
      const html = editor.isEmpty ? '' : editor.getHTML();
      emitted.current = html;
      onChangeRef.current?.(html);
    },
  });

  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    const { from, to } = editor.state.selection;
    editor.commands.setContent(noteHtml(value), { emitUpdate: false });
    const end = editor.state.doc.content.size;
    editor.commands.setTextSelection({ from: Math.min(from, end), to: Math.min(to, end) });
  }, [editor, value]);

  useEffect(() => {
    if (editor.isEditable !== editable) editor.setEditable(editable, false);
  }, [editor, editable]);

  const focused = useEditorState({ editor, selector: ({ editor }) => editor.isFocused });

  if (paged) return <PagedNote editor={editor} status={status} />;
  return (
    <View className="gap-2">
      {editable && focused && <Toolbar editor={editor} />}
      <View
        className={cn(
          'rounded-md border py-2',
          editable
            ? 'border-input bg-background shadow-sm shadow-black/5 dark:bg-input/30 web:focus-within:border-ring web:focus-within:ring-[3px] web:focus-within:ring-ring/50'
            : 'border-border bg-muted/40',
          minHeight
        )}>
        <EditorContent editor={editor} className="note-flow" />
      </View>
    </View>
  );
}

function PagedNote({ editor, status }: { editor: Editor; status?: ReactNode }) {
  const { t } = useTranslation();
  const { setArea, clipRef, page, pages, windowHeight, turnTo } = usePages(editor);
  return (
    <View className="flex-1 gap-2">
      <Toolbar editor={editor} />
      <View className="flex-1 rounded-md border border-input bg-background py-2 shadow-sm shadow-black/5 dark:bg-input/30 web:focus-within:border-ring web:focus-within:ring-[3px] web:focus-within:ring-ring/50">
        <View
          className="flex-1"
          onLayout={(event) => setArea({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}>
          <View ref={clipRef} className="overflow-hidden" style={{ height: windowHeight }}>
            <EditorContent editor={editor} />
          </View>
        </View>
      </View>
      <View className="h-5 flex-row items-center justify-between gap-3">
        <View className="flex-1">{status}</View>
        {pages > 1 && (
          <View className="flex-row items-center gap-1" {...keepEditorFocus}>
            <PageButton icon={ChevronLeft} label={t('notes.previousPage')} disabled={page === 0} onPress={() => turnTo(page - 1)} />
            <Text className="text-xs tabular-nums text-muted-foreground">{t('notes.page', { page: page + 1, pages })}</Text>
            <PageButton
              icon={ChevronRight}
              label={t('notes.nextPage')}
              disabled={page === pages - 1}
              onPress={() => turnTo(page + 1)}
            />
          </View>
        )}
      </View>
    </View>
  );
}

// --- Pages --------------------------------------------------------------------------------------

type Line = { top: number; bottom: number };

/** Splits the note into pages of whole lines that fit the available height, shows the page with the
 * caret, and keeps the window on that page when the browser would scroll it to the caret. */
function usePages(editor: Editor) {
  const clipRef = useRef<View>(null);
  const [area, setArea] = useState({ width: 0, height: 0 });
  const [pager, setPager] = useState({ starts: [0], page: 0 });
  const scrollTarget = useRef(0);

  const repaginate = useCallback(() => {
    if (!area.height) return;
    const root = editor.view.dom as HTMLElement;
    const starts = pageStarts(lineBoxes(root), area.height);
    setPager((current) => {
      const page = editor.isFocused ? pageAt(starts, caretTop(editor)) : Math.min(current.page, starts.length - 1);
      const same = page === current.page && starts.length === current.starts.length && starts.every((s, n) => s === current.starts[n]);
      return same ? current : { starts, page };
    });
  }, [editor, area.height]);

  useEffect(() => {
    editor.on('update', repaginate);
    editor.on('selectionUpdate', repaginate);
    editor.on('focus', repaginate);
    return () => {
      editor.off('update', repaginate);
      editor.off('selectionUpdate', repaginate);
      editor.off('focus', repaginate);
    };
  }, [editor, repaginate]);

  // Room below the text, so the last page can start at the top of the window too.
  useLayoutEffect(() => {
    (editor.view.dom as HTMLElement).style.paddingBottom = `${area.height}px`;
    repaginate();
  }, [editor, area.width, area.height, repaginate]);

  useLayoutEffect(() => {
    scrollTarget.current = pager.starts[pager.page];
    const clip = clipRef.current as unknown as HTMLElement | null;
    if (clip) clip.scrollTop = scrollTarget.current;
  }, [pager]);

  useEffect(() => {
    const clip = clipRef.current as unknown as HTMLElement | null;
    if (!clip) return;
    const onScroll = () => {
      if (clip.scrollTop !== scrollTarget.current) clip.scrollTop = scrollTarget.current;
    };
    clip.addEventListener('scroll', onScroll);
    return () => clip.removeEventListener('scroll', onScroll);
  }, []);

  // Turning a page puts the caret on its first line, so writing continues there.
  const turnTo = (target: number) => {
    const top = pager.starts[target];
    const origin = (editor.view.dom as HTMLElement).getBoundingClientRect().top;
    let low = 0;
    let high = editor.state.doc.content.size;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (editor.view.coordsAtPos(mid).top - origin >= top) high = mid;
      else low = mid + 1;
    }
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.setSelection(TextSelection.near(tr.doc.resolve(low)));
        return true;
      })
      .run();
  };

  const { starts, page } = pager;
  const windowHeight = page < starts.length - 1 ? starts[page + 1] - starts[page] : area.height;
  return { setArea, clipRef, page, pages: starts.length, windowHeight, turnTo };
}

/** Every line of text in the note, measured from the top of the note. */
function lineBoxes(root: HTMLElement): Line[] {
  const origin = root.getBoundingClientRect().top;
  const range = document.createRange();
  const boxes: Line[] = [];
  for (const block of root.querySelectorAll('p, h1, h2')) {
    range.selectNodeContents(block);
    const fragments = [...range.getClientRects()].filter((rect) => rect.height > 0);
    for (const rect of fragments.length ? fragments : [block.getBoundingClientRect()])
      boxes.push({ top: rect.top - origin, bottom: rect.bottom - origin });
  }
  boxes.sort((a, b) => a.top - b.top);
  // Pieces of the same line (a bold word, the text beside a bullet) overlap: they are one line.
  const lines: Line[] = [];
  for (const box of boxes) {
    const last = lines[lines.length - 1];
    if (last && box.top < last.bottom - 1) last.bottom = Math.max(last.bottom, box.bottom);
    else lines.push({ ...box });
  }
  return lines;
}

/** Where each page starts: a page takes as many whole lines as fit in `height`, and the next page
 * starts in the gap before the first line that does not. */
function pageStarts(lines: Line[], height: number) {
  const starts = [0];
  let previous = 0;
  for (const line of lines) {
    const start = starts[starts.length - 1];
    if (line.bottom - start > height && line.top > start) {
      const gap = line.top >= previous ? (previous + line.top) / 2 : line.top;
      starts.push(Math.min(gap, start + height));
    }
    previous = line.bottom;
  }
  return starts;
}

function pageAt(starts: number[], y: number) {
  let page = 0;
  while (page + 1 < starts.length && starts[page + 1] <= y + 0.5) page++;
  return page;
}

function caretTop(editor: Editor) {
  const origin = (editor.view.dom as HTMLElement).getBoundingClientRect().top;
  return editor.view.coordsAtPos(editor.state.selection.head).top - origin;
}

// --- Toolbar ------------------------------------------------------------------------------------

/** Pressing a button must not take the caret out of the note, so its mousedown does nothing. React Native
 * Web passes mouse events through to the element; React Native's types just don't list them. */
const keepEditorFocus = {
  onMouseDown: (event: { preventDefault: () => void }) => event.preventDefault(),
} as unknown as ViewProps;

function Toolbar({ editor }: { editor: Editor }) {
  const { t } = useTranslation();
  const active = useEditorState({
    editor,
    selector: ({ editor }) => ({
      title: editor.isActive('heading', { level: 1 }),
      subtitle: editor.isActive('heading', { level: 2 }),
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      underline: editor.isActive('underline'),
      center: editor.isActive({ textAlign: 'center' }),
      right: editor.isActive({ textAlign: 'right' }),
      list: editor.isActive('bulletList'),
    }),
  });
  const run = () => editor.chain().focus();

  return (
    <View
      role="toolbar"
      aria-label={t('notes.format.toolbar')}
      className="flex-row flex-wrap items-center gap-0.5"
      {...keepEditorFocus}>
      <ToolButton icon={Heading1} label={t('notes.format.title')} active={active.title} onPress={() => run().toggleHeading({ level: 1 }).run()} />
      <ToolButton
        icon={Heading2}
        label={t('notes.format.subtitle')}
        active={active.subtitle}
        onPress={() => run().toggleHeading({ level: 2 }).run()}
      />
      <Divider />
      <ToolButton icon={Bold} label={t('notes.format.bold')} active={active.bold} onPress={() => run().toggleBold().run()} />
      <ToolButton icon={Italic} label={t('notes.format.italic')} active={active.italic} onPress={() => run().toggleItalic().run()} />
      <ToolButton
        icon={Underline}
        label={t('notes.format.underline')}
        active={active.underline}
        onPress={() => run().toggleUnderline().run()}
      />
      <Divider />
      <ToolButton
        icon={TextAlignStart}
        label={t('notes.format.alignLeft')}
        active={!active.center && !active.right}
        onPress={() => run().unsetTextAlign().run()}
      />
      <ToolButton
        icon={TextAlignCenter}
        label={t('notes.format.alignCenter')}
        active={active.center}
        onPress={() => run().setTextAlign('center').run()}
      />
      <ToolButton
        icon={TextAlignEnd}
        label={t('notes.format.alignRight')}
        active={active.right}
        onPress={() => run().setTextAlign('right').run()}
      />
      <Divider />
      <ToolButton icon={List} label={t('notes.format.list')} active={active.list} onPress={() => run().toggleBulletList().run()} />
    </View>
  );
}

function Divider() {
  return <View className="mx-1 h-4 w-px bg-border" />;
}

function ToolButton({ icon, label, active, onPress }: { icon: LucideIcon; label: string; active: boolean; onPress: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Pressable
          role="button"
          aria-pressed={active}
          accessibilityLabel={label}
          onPress={onPress}
          className={cn('size-7 items-center justify-center rounded-md web:hover:bg-accent', active && 'bg-accent')}>
          <Icon as={icon} size={16} className={active ? 'text-foreground' : 'text-muted-foreground'} />
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <Text>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

function PageButton({ icon, label, disabled, onPress }: { icon: LucideIcon; label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      role="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      className={cn('size-5 items-center justify-center rounded web:hover:bg-accent', disabled && 'opacity-30')}>
      <Icon as={icon} size={14} className="text-muted-foreground" />
    </Pressable>
  );
}
