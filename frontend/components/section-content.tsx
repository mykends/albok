import { Text } from '@/components/ui/text';
import { Fragment, useMemo } from 'react';
import { Text as RNText, View } from 'react-native';

type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: { marker: string; text: string }[] }
  | { type: 'quote'; text: string }
  | { type: 'code'; text: string };

/** Parses the lightweight Markdown the backend stores for sections. */
export function parseBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  const lines = content.split('\n');
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('```')) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith('```'); i++) code.push(lines[i]);
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }
    const heading = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const ordered = /^(\d+)[.)]\s+(.*)$/.exec(line);
    const quote = /^>\s?(.*)$/.exec(line);
    const last = blocks[blocks.length - 1];

    if (!line) {
      flush();
    } else if (heading) {
      flush();
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
    } else if (bullet || ordered) {
      flush();
      const item = bullet ? { marker: '•', text: bullet[1] } : { marker: `${ordered![1]}.`, text: ordered![2] };
      if (last?.type === 'list' && last.ordered === !bullet) last.items.push(item);
      else blocks.push({ type: 'list', ordered: !bullet, items: [item] });
    } else if (quote) {
      flush();
      if (last?.type === 'quote') last.text += ` ${quote[1]}`;
      else blocks.push({ type: 'quote', text: quote[1] });
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;

// Plain RN Text so nested spans inherit the reader's font size instead of `text-base`.
function Inline({ text }: { text: string }) {
  return text
    .split(INLINE)
    .filter(Boolean)
    .map((part, i) => {
      if (part.length > 4 && part.startsWith('**') && part.endsWith('**'))
        return <RNText key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</RNText>;
      if (part.length > 2 && part.startsWith('`') && part.endsWith('`'))
        return <RNText key={i} className="rounded bg-muted px-1 font-mono text-foreground">{part.slice(1, -1)}</RNText>;
      if (part.length > 2 && part.startsWith('*') && part.endsWith('*'))
        return <RNText key={i} className="italic">{part.slice(1, -1)}</RNText>;
      return <Fragment key={i}>{part}</Fragment>;
    });
}

const HEADING_SCALE = [1.6, 1.35, 1.15, 1.05, 1, 1];

export function SectionContent({ content, fontSize }: { content: string; fontSize: number }) {
  const blocks = useMemo(() => parseBlocks(content), [content]);
  const body = { fontSize, lineHeight: Math.round(fontSize * 1.7) };

  return (
    <View className="gap-4">
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'heading': {
            const size = Math.round(fontSize * HEADING_SCALE[block.level - 1]);
            return (
              <Text key={i} role="heading" className="mt-3 font-semibold tracking-tight" style={{ fontSize: size, lineHeight: size * 1.3 }}>
                <Inline text={block.text} />
              </Text>
            );
          }
          case 'list':
            return (
              <View key={i} className="gap-1.5 pl-1">
                {block.items.map((item, j) => (
                  <View key={j} className="flex-row gap-3">
                    <Text className="min-w-5 text-muted-foreground" style={body}>{item.marker}</Text>
                    <Text className="flex-1" style={body}><Inline text={item.text} /></Text>
                  </View>
                ))}
              </View>
            );
          case 'quote':
            return (
              <View key={i} className="border-l-4 border-primary/30 pl-4">
                <Text className="italic text-muted-foreground" style={body}><Inline text={block.text} /></Text>
              </View>
            );
          case 'code':
            return (
              <View key={i} className="rounded-lg bg-muted p-4">
                <Text className="font-mono text-sm">{block.text}</Text>
              </View>
            );
          default:
            return <Text key={i} style={body}><Inline text={block.text} /></Text>;
        }
      })}
    </View>
  );
}
