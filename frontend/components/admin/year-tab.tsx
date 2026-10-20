import { DateInput } from '@/components/date-input';
import { Field, Panel } from '@/components/admin/panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { api, type CalendarDay, type SchoolYear, type SchoolYearInput } from '@/lib/api';
import { formatDate, formatDateShort, formatTime } from '@/lib/format';
import { errorMessage } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Plus, Save, Trash2 } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

function suggestedYear(): SchoolYearInput {
  const now = new Date();
  const first = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return {
    name: `${first}./${first + 1}.`,
    start: `${first}-09-01`,
    end: `${first + 1}-06-20`,
    deletion_date: `${first + 1}-08-31`,
    day_end_time: '15:00',
    week_a_monday: null,
  };
}

export function YearTab() {
  const { t } = useTranslation();
  const [years, setYears] = useState<SchoolYear[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const loaded = await api.years();
      setYears(loaded);
      setSelectedId((current) => current ?? loaded.find((y) => y.is_current)?.id ?? loaded[0]?.id ?? 'new');
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selected = years?.find((y) => y.id === selectedId) ?? null;

  return (
    <View className="gap-6">
      {error && <Text className="text-sm text-destructive">{error}</Text>}
      <View className="flex-row flex-wrap gap-2">
        {years?.map((year) => (
          <Pressable
            key={year.id}
            onPress={() => setSelectedId(year.id)}
            className={cn('flex-row items-center gap-2 rounded-full border border-border px-3 py-1 web:hover:bg-accent', selectedId === year.id && 'border-primary bg-accent')}>
            <Text className="text-sm font-medium">{year.name}</Text>
            {year.is_current && (
              <Badge>
                <Text>{t('admin.year.current')}</Text>
              </Badge>
            )}
            {year.purged_at && <Text className="text-xs text-muted-foreground">{t('admin.year.purged')}</Text>}
          </Pressable>
        ))}
        <Button variant="outline" size="sm" onPress={() => setSelectedId('new')}>
          <Icon as={Plus} />
          <Text>{t('admin.year.add')}</Text>
        </Button>
      </View>
      {years && (selectedId === 'new' || selected) && (
        <YearForm
          key={String(selectedId)}
          year={selected}
          onSaved={async (saved) => {
            await load();
            setSelectedId(saved.id);
          }}
        />
      )}
      {selected && !selected.purged_at && <CalendarPanel year={selected} />}
    </View>
  );
}

function YearForm({ year, onSaved }: { year: SchoolYear | null; onSaved: (year: SchoolYear) => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState<SchoolYearInput>(() =>
    year ? { ...year, day_end_time: formatTime(year.day_end_time) } : suggestedYear()
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const set = (patch: Partial<SchoolYearInput>) => setForm((current) => ({ ...current, ...patch }));

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const saved = year ? await api.updateYear(year.id, form) : await api.createYear(form);
      setMessage(t('common.saved'));
      onSaved(saved);
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const disabled = !!year?.purged_at;
  return (
    <Panel title={year ? t('admin.year.edit', { name: year.name }) : t('admin.year.new')}>
      <View className="flex-row flex-wrap gap-4">
        <Field label={t('admin.year.name')}>
          <Input className="w-40" value={form.name} onChangeText={(name) => set({ name })} />
        </Field>
        <Field label={t('admin.year.start')}>
          <DateInput value={form.start} onChange={(start) => set({ start })} />
        </Field>
        <Field label={t('admin.year.end')}>
          <DateInput value={form.end} onChange={(end) => set({ end })} />
        </Field>
        <Field label={t('admin.year.dayEnd')}>
          <DateInput type="time" value={form.day_end_time} onChange={(day_end_time) => set({ day_end_time })} />
        </Field>
        <Field label={t('admin.year.deletion')}>
          <DateInput value={form.deletion_date} onChange={(deletion_date) => set({ deletion_date })} />
        </Field>
        <Field label={t('admin.year.weekA')}>
          <DateInput value={form.week_a_monday ?? ''} onChange={(value) => set({ week_a_monday: value || null })} />
        </Field>
      </View>
      <Text className="text-xs text-muted-foreground">{t('admin.year.help')}</Text>
      <View className="flex-row items-center gap-3">
        <Button disabled={busy || disabled} onPress={save}>
          <Icon as={Save} />
          <Text>{t('common.save')}</Text>
        </Button>
        {message && <Text className="text-sm text-muted-foreground">{message}</Text>}
      </View>
    </Panel>
  );
}

function CalendarPanel({ year }: { year: SchoolYear }) {
  const { t } = useTranslation();
  const [days, setDays] = useState<CalendarDay[]>([]);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.days(year.id).then(setDays).catch((e) => setError(errorMessage(e)));
  }, [year.id]);

  async function add() {
    setError(null);
    try {
      setDays(await api.addDays(year.id, start, end || null, label));
      setStart('');
      setEnd('');
      setLabel('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <Panel title={t('admin.calendar.title')} description={t('admin.calendar.description')}>
      <View className="flex-row flex-wrap items-end gap-3">
        <Field label={t('admin.calendar.from')}>
          <DateInput value={start} onChange={setStart} />
        </Field>
        <Field label={t('admin.calendar.to')}>
          <DateInput value={end} onChange={setEnd} />
        </Field>
        <Field label={t('admin.calendar.label')}>
          <Input className="w-56" value={label} onChangeText={setLabel} placeholder={t('admin.calendar.labelPlaceholder')} />
        </Field>
        <Button disabled={!start} onPress={add}>
          <Icon as={Plus} />
          <Text>{t('common.add')}</Text>
        </Button>
      </View>
      {error && <Text className="text-sm text-destructive">{error}</Text>}
      <View className="gap-1">
        {days.length === 0 && <Text className="text-sm text-muted-foreground">{t('admin.calendar.empty')}</Text>}
        {days.map((day) => (
          <View key={day.id} className="flex-row items-center gap-3 rounded-md px-2 py-1 web:hover:bg-accent/60">
            <Text className="w-40 text-sm tabular-nums">{formatDateShort(day.date)}</Text>
            <Text className="flex-1 text-sm text-muted-foreground">{day.label}</Text>
            <Button
              variant="ghost"
              size="icon"
              accessibilityLabel={t('common.delete')}
              onPress={() => api.deleteDay(year.id, day.id).then(() => setDays((d) => d.filter((x) => x.id !== day.id)))}>
              <Icon as={Trash2} size={14} />
            </Button>
          </View>
        ))}
      </View>
      <Text className="text-xs text-muted-foreground">
        {t('admin.calendar.range', { start: formatDate(year.start), end: formatDate(year.end) })}
      </Text>
    </Panel>
  );
}
