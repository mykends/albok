import { Checkbox } from '@/components/checkbox';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { api, type Book, type Preset, type ProfessorSubject } from '@/lib/api';
import { errorMessage } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { ListChecks, Save, Send } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

/** A preset lists the sections a year level covers. Applying it to a class sets that class's plan
 * (included sections); publishing during the year stays manual. Presets survive the year-end reset. */
export function PresetsTab({
  subject,
  books,
  onApplied,
}: {
  subject: ProfessorSubject;
  books: Book[];
  onApplied: (books: Book[]) => void;
}) {
  const { t } = useTranslation();
  const [presets, setPresets] = useState<Preset[] | null>(null);
  const [level, setLevel] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .presets(subject.id)
      .then(setPresets)
      .catch((e) => setError(errorMessage(e)));
  }, [subject.id]);

  const levels = useMemo(() => {
    const all = new Set([...subject.classes.map((c) => c.year_level), ...(presets ?? []).map((p) => p.year_level)]);
    return [...all].sort((a, b) => a - b);
  }, [subject.classes, presets]);

  useEffect(() => {
    if (level === null && levels.length) setLevel(levels[0]);
  }, [levels, level]);

  const preset = presets?.find((p) => p.year_level === level) ?? null;
  useEffect(() => {
    setSelected(new Set(preset?.section_ids ?? []));
    setMessage(null);
  }, [preset, level]);

  async function save() {
    if (level === null) return;
    setBusy(true);
    setError(null);
    try {
      const saved = preset
        ? await api.updatePreset(preset.id, [...selected])
        : await api.createPreset(subject.id, level, [...selected]);
      setPresets((current) => [...(current ?? []).filter((p) => p.id !== saved.id), saved]);
      setMessage(t('presets.saved'));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function apply(classId: number, className: string) {
    if (!preset) return;
    setBusy(true);
    setError(null);
    try {
      onApplied(await api.applyPreset(preset.id, classId));
      setMessage(t('presets.applied', { className }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!presets) return <Skeleton className="h-48 rounded-xl" />;
  if (!levels.length) {
    return <EmptyState icon={ListChecks} title={t('presets.noLevelsTitle')} description={t('presets.noLevels')} />;
  }
  const dirty = preset ? JSON.stringify([...selected].sort()) !== JSON.stringify([...preset.section_ids].sort()) : selected.size > 0;
  const classesForLevel = subject.classes.filter((c) => c.year_level === level);

  return (
    <View className="gap-5">
      <Text className="text-sm text-muted-foreground">{t('presets.hint')}</Text>
      <View className="flex-row flex-wrap gap-2">
        {levels.map((value) => (
          <Pressable
            key={value}
            onPress={() => setLevel(value)}
            className={cn('rounded-full border border-border px-3 py-1 web:hover:bg-accent', level === value && 'border-primary bg-primary')}>
            <Text className={cn('text-sm', level === value && 'text-primary-foreground')}>{t('presets.level', { level: value })}</Text>
          </Pressable>
        ))}
      </View>

      <View className="gap-4 rounded-xl border border-border bg-card p-5">
        {books.length === 0 && <Text className="text-muted-foreground">{t('presets.noBooks')}</Text>}
        {books.map((book) => (
          <View key={book.id} className="gap-1.5">
            <View className="flex-row items-center gap-3">
              <Text className="flex-1 font-semibold">{book.title}</Text>
              <Button
                variant="link"
                size="sm"
                onPress={() => {
                  const ids = book.sections.map((s) => s.id);
                  const all = ids.every((id) => selected.has(id));
                  setSelected((current) => {
                    const next = new Set(current);
                    ids.forEach((id) => (all ? next.delete(id) : next.add(id)));
                    return next;
                  });
                }}>
                <Text>{t('presets.toggleBook')}</Text>
              </Button>
            </View>
            {book.sections.map((section) => (
              <Checkbox
                key={section.id}
                checked={selected.has(section.id)}
                label={section.title}
                className="py-1 pl-1"
                onChange={(checked) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (checked) next.add(section.id);
                    else next.delete(section.id);
                    return next;
                  })
                }
              />
            ))}
          </View>
        ))}
      </View>

      <View className="flex-row flex-wrap items-center gap-3">
        <Button disabled={busy || !dirty} onPress={save}>
          <Icon as={Save} />
          <Text>{t('presets.save')}</Text>
        </Button>
        {preset &&
          classesForLevel.map((c) => (
            <Button key={c.id} variant="outline" disabled={busy || dirty} onPress={() => apply(c.id, c.name)}>
              <Icon as={Send} />
              <Text>{t('presets.applyTo', { className: c.name })}</Text>
            </Button>
          ))}
        <Text className="text-sm text-muted-foreground">{t('presets.selected', { count: selected.size })}</Text>
      </View>
      {message && <Text className="text-sm text-green-700 dark:text-green-400">{message}</Text>}
      {error && <Text className="text-sm text-destructive">{error}</Text>}
    </View>
  );
}
