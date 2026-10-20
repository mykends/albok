import { DateInput } from '@/components/date-input';
import { Field, Panel } from '@/components/admin/panel';
import { Select } from '@/components/select';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { api, type AdminUser, type SchoolClass, type Slot, type SlotInput } from '@/lib/api';
import { formatTime, weekdayName } from '@/lib/format';
import { errorMessage } from '@/lib/i18n';
import { Pencil, Plus, Save, Trash2, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

const EMPTY: SlotInput = { weekday: 1, starts_at: '08:00', ends_at: '08:45', week: null, class_id: 0, subject_name: '', professor_id: 0 };

export function TimetableTab() {
  const { t } = useTranslation();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [professors, setProfessors] = useState<AdminUser[]>([]);
  const [classFilter, setClassFilter] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [form, setForm] = useState<SlotInput>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    Promise.all([api.slots(), api.classes(), api.users(undefined, 'professor')])
      .then(([s, c, p]) => {
        setSlots(s);
        setClasses(c);
        setProfessors(p);
      })
      .catch((e) => setError(errorMessage(e)));
  useEffect(() => {
    load();
  }, []);

  const visible = useMemo(() => slots.filter((s) => classFilter === null || s.class_id === classFilter), [slots, classFilter]);
  const byDay = useMemo(() => {
    const days = new Map<number, Slot[]>();
    for (const slot of visible) days.set(slot.weekday, [...(days.get(slot.weekday) ?? []), slot]);
    return [...days.entries()].sort(([a], [b]) => a - b);
  }, [visible]);

  function edit(slot: Slot | null) {
    setError(null);
    if (!slot) {
      setEditing('new');
      setForm({ ...EMPTY, class_id: classFilter ?? classes[0]?.id ?? 0, professor_id: professors[0]?.id ?? 0 });
      return;
    }
    setEditing(slot.id);
    setForm({
      weekday: slot.weekday,
      starts_at: formatTime(slot.starts_at),
      ends_at: formatTime(slot.ends_at),
      week: slot.week,
      class_id: slot.class_id,
      subject_name: slot.subject_name,
      professor_id: slot.professor_id,
    });
  }

  async function save() {
    setError(null);
    try {
      if (editing === 'new') await api.createSlot(form);
      else if (editing) await api.updateSlot(editing, form);
      setEditing(null);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const set = (patch: Partial<SlotInput>) => setForm((current) => ({ ...current, ...patch }));

  return (
    <View className="gap-6">
      <View className="flex-row flex-wrap items-center gap-3">
        <Select
          className="w-48"
          value={classFilter}
          onChange={setClassFilter}
          options={[{ value: null, label: t('admin.timetable.allClasses') }, ...classes.map((c) => ({ value: c.id, label: c.name }))]}
        />
        <Text className="flex-1 text-sm text-muted-foreground">{t('admin.timetable.importHint')}</Text>
        <Button onPress={() => edit(null)}>
          <Icon as={Plus} />
          <Text>{t('admin.timetable.add')}</Text>
        </Button>
      </View>

      {editing !== null && (
        <Panel title={editing === 'new' ? t('admin.timetable.add') : t('admin.timetable.edit')}>
          <View className="flex-row flex-wrap items-end gap-3">
            <Field label={t('admin.timetable.day')}>
              <Select
                className="w-40"
                value={form.weekday}
                onChange={(weekday) => set({ weekday })}
                options={[1, 2, 3, 4, 5, 6].map((d) => ({ value: d, label: weekdayName(d) }))}
              />
            </Field>
            <Field label={t('admin.timetable.start')}>
              <DateInput type="time" value={form.starts_at} onChange={(starts_at) => set({ starts_at })} />
            </Field>
            <Field label={t('admin.timetable.end')}>
              <DateInput type="time" value={form.ends_at} onChange={(ends_at) => set({ ends_at })} />
            </Field>
            <Field label={t('admin.timetable.week')}>
              <Select
                className="w-32"
                value={form.week}
                onChange={(week) => set({ week })}
                options={[
                  { value: null, label: t('admin.timetable.everyWeek') },
                  { value: 'A', label: 'A' },
                  { value: 'B', label: 'B' },
                ]}
              />
            </Field>
            <Field label={t('admin.timetable.class')}>
              <Select className="w-28" value={form.class_id} onChange={(class_id) => set({ class_id })} options={classes.map((c) => ({ value: c.id, label: c.name }))} />
            </Field>
            <Field label={t('admin.timetable.subject')}>
              <Input className="w-48" value={form.subject_name} onChangeText={(subject_name) => set({ subject_name })} />
            </Field>
            <Field label={t('admin.timetable.professor')}>
              <Select
                className="w-56"
                value={form.professor_id}
                onChange={(professor_id) => set({ professor_id })}
                options={professors.map((p) => ({ value: p.id, label: p.display_name || p.username }))}
              />
            </Field>
          </View>
          <View className="flex-row gap-2">
            <Button disabled={!form.subject_name.trim() || !form.class_id || !form.professor_id} onPress={save}>
              <Icon as={Save} />
              <Text>{t('common.save')}</Text>
            </Button>
            <Button variant="ghost" onPress={() => setEditing(null)}>
              <Icon as={X} />
              <Text>{t('common.cancel')}</Text>
            </Button>
          </View>
        </Panel>
      )}
      {error && <Text className="text-sm text-destructive">{error}</Text>}

      {byDay.length === 0 && <Text className="text-muted-foreground">{t('admin.timetable.empty')}</Text>}
      {byDay.map(([weekday, daySlots]) => (
        <Panel key={weekday} title={weekdayName(weekday)}>
          {daySlots.map((slot) => (
            <View key={slot.id} className="flex-row flex-wrap items-center gap-3 rounded-md px-1 py-0.5 web:hover:bg-accent/60">
              <Text className="w-28 text-sm tabular-nums">
                {formatTime(slot.starts_at)}–{formatTime(slot.ends_at)}
              </Text>
              <Text className="w-12 text-sm font-medium">{slot.class_name}</Text>
              <Text className="flex-1 text-sm">{slot.subject_name}</Text>
              <Text className="text-sm text-muted-foreground">{slot.professor_name}</Text>
              {slot.week && <Text className="w-16 text-xs text-muted-foreground">{t('admin.timetable.weekOnly', { week: slot.week })}</Text>}
              <Button variant="ghost" size="icon" accessibilityLabel={t('common.edit')} onPress={() => edit(slot)}>
                <Icon as={Pencil} size={14} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                accessibilityLabel={t('common.delete')}
                onPress={() => api.deleteSlot(slot.id).then(load).catch((e) => setError(errorMessage(e)))}>
                <Icon as={Trash2} size={14} />
              </Button>
            </View>
          ))}
        </Panel>
      ))}
    </View>
  );
}
