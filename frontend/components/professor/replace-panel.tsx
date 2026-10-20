import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { api, type Book, type ReplaceProposal, type SectionDraft } from '@/lib/api';
import { errorMessage } from '@/lib/i18n';
import { ChevronDown, FileWarning, Loader, Plus, Trash2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

/** After uploading a corrected edition: confirm the new sections and say which old section each
 * becomes, so publications and students' note links carry over. */
export function ReplacePanel({
  book,
  onDone,
  onPreviewPage,
}: {
  book: Book;
  onDone: (book: Book) => void;
  onPreviewPage: (page: number) => void;
}) {
  const { t } = useTranslation();
  const pending = book.pending_file!;
  const [proposal, setProposal] = useState<ReplaceProposal | null>(null);
  const [drafts, setDrafts] = useState<SectionDraft[]>([]);
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (pending.status !== 'ready') return;
    api
      .replaceProposal(book.id)
      .then((loaded) => {
        setProposal(loaded);
        setDrafts(loaded.suggestions);
        setMapping(loaded.mapping);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [book.id, pending.status]);

  async function act(action: () => Promise<Book>) {
    setBusy(true);
    setError(null);
    try {
      onDone(await action());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function updateDraft(index: number, patch: Partial<SectionDraft>) {
    setDrafts((current) => current.map((draft, n) => (n === index ? { ...draft, ...patch } : draft)));
  }

  function removeDraft(index: number) {
    setDrafts((current) => current.filter((_, n) => n !== index));
    // Re-point mappings after the removed index.
    setMapping((current) =>
      Object.fromEntries(
        Object.entries(current).map(([old, target]) => [old, target === null || target === index ? null : target > index ? target - 1 : target])
      )
    );
  }

  if (pending.status === 'processing') {
    return (
      <View className="flex-row items-center gap-2 p-4">
        <Icon as={Loader} size={16} className="text-muted-foreground" />
        <Text className="text-sm text-muted-foreground">{t('professor.processing')}</Text>
      </View>
    );
  }

  const cancel = (
    <Button variant="outline" disabled={busy} onPress={() => act(() => api.cancelReplace(book.id))}>
      <Text>{t('replace.cancel')}</Text>
    </Button>
  );

  if (pending.status === 'failed') {
    return (
      <View className="gap-3 p-4">
        <View className="flex-row items-center gap-2 rounded-md bg-destructive/10 p-3">
          <Icon as={FileWarning} size={16} className="text-destructive" />
          <Text className="flex-1 text-sm">{pending.error ?? t('professor.processingFailed')}</Text>
        </View>
        {cancel}
      </View>
    );
  }
  if (!proposal) return <Text className="p-4 text-sm text-muted-foreground">{error ?? t('common.loading')}</Text>;

  const label = (index: number | null | undefined) =>
    index === null || index === undefined ? t('replace.deleteOld') : `${index + 1}. ${drafts[index]?.title ?? ''}`;

  return (
    <ScrollView contentContainerClassName="gap-5 p-4">
      <Text className="text-sm text-muted-foreground">
        {t('replace.hint', { file: pending.original_filename, count: pending.page_count })}
      </Text>

      <View className="gap-2">
        <Text className="font-semibold">{t('replace.newSections')}</Text>
        {drafts.map((draft, index) => (
          <View key={index} className="flex-row items-center gap-1.5">
            <Text className="w-6 text-sm tabular-nums text-muted-foreground">{index + 1}.</Text>
            <Input className="flex-1" value={draft.title} onChangeText={(title) => updateDraft(index, { title })} />
            <Input
              className="w-14"
              inputMode="numeric"
              value={String(draft.page_start)}
              onFocus={() => onPreviewPage(draft.page_start)}
              onChangeText={(value) => updateDraft(index, { page_start: Number(value) || 0 })}
            />
            <Input
              className="w-14"
              inputMode="numeric"
              value={String(draft.page_end)}
              onChangeText={(value) => updateDraft(index, { page_end: Number(value) || 0 })}
            />
            <Button variant="ghost" size="icon" accessibilityLabel={t('common.delete')} onPress={() => removeDraft(index)}>
              <Icon as={Trash2} size={14} />
            </Button>
          </View>
        ))}
        <Button
          variant="link"
          size="sm"
          className="self-start"
          onPress={() => setDrafts((current) => [...current, { title: t('replace.newSection'), page_start: 1, page_end: 1 }])}>
          <Icon as={Plus} />
          <Text>{t('editor.addSection')}</Text>
        </Button>
      </View>

      <View className="gap-2">
        <Text className="font-semibold">{t('replace.oldSections')}</Text>
        <Text className="text-sm text-muted-foreground">{t('replace.mappingHint')}</Text>
        {book.sections.map((section) => (
          <View key={section.id} className="flex-row items-center gap-2">
            <Text className="flex-1 text-sm" numberOfLines={1}>
              {section.title}
              {section.published_class_ids.length > 0 ? ` · ${t('professor.published')}` : ''}
            </Text>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="max-w-56">
                  <Text numberOfLines={1}>{label(mapping[String(section.id)])}</Text>
                  <Icon as={ChevronDown} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                {drafts.map((draft, index) => (
                  <DropdownMenuItem key={index} onPress={() => setMapping((m) => ({ ...m, [String(section.id)]: index }))}>
                    <Text numberOfLines={1}>{label(index)}</Text>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem variant="destructive" onPress={() => setMapping((m) => ({ ...m, [String(section.id)]: null }))}>
                  <Text>{t('replace.deleteOld')}</Text>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </View>
        ))}
      </View>

      {error && <Text className="text-sm text-destructive">{error}</Text>}
      <View className="flex-row gap-2">
        {cancel}
        <Button disabled={busy || drafts.length === 0} onPress={() => act(() => api.confirmReplace(book.id, drafts, mapping))}>
          <Text>{t('replace.confirm')}</Text>
        </Button>
      </View>
    </ScrollView>
  );
}
