import { DateInput } from '@/components/date-input';
import { Field, Panel } from '@/components/admin/panel';
import { Select } from '@/components/select';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { api, type AdminUser, type Override, type Slot, type SubjectOption } from '@/lib/api';
import { formatDateShort, formatTime, parseDate, todayIso } from '@/lib/format';
import { errorMessage } from '@/lib/i18n';
import { Save, Trash2 } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

type Kind = 'cancel' | 'professor' | 'subject';

/** Cancel one lesson, or give it to a substitute professor or another subject, for one date. */
export function OverridesTab() {
  const { t } = useTranslation();
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [professors, setProfessors] = useState<AdminUser[]>([]);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [date, setDate] = useState(todayIso());
  const [classId, setClassId] = useState<number | null>(null);
  const [slotId, setSlotId] = useState<number | null>(null);
  const [kind, setKind] = useState<Kind>('cancel');
  const [substituteId, setSubstituteId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = () =>
    Promise.all([api.overrides(todayIso()), api.slots(), api.users(undefined, 'professor'), api.allSubjects()])
      .then(([o, s, p, subj]) => {
        setOverrides(o);
        setSlots(s);
        setProfessors(p);
        setSubjects(subj);
      })
      .catch((e) => setMessage(errorMessage(e)));
  useEffect(() => {
    load();
  }, []);

  const weekday = date ? ((parseDate(date).getDay() + 6) % 7) + 1 : 0;
  const classes = useMemo(() => {
    const seen = new Map<number, string>();
    slots.forEach((s) => seen.set(s.class_id, s.class_name));
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], 'hr'));
  }, [slots]);
  const daySlots = slots.filter((s) => s.weekday === weekday && (classId === null || s.class_id === classId));

  useEffect(() => setSlotId(null), [date, classId]);

  async function save() {
    if (!slotId) return;
    setMessage(null);
    try {
      await api.saveOverride({
        slot_id: slotId,
        date,
        cancelled: kind === 'cancel',
        substitute_professor_id: kind === 'professor' ? substituteId : null,
        substitute_subject_id: kind === 'subject' ? substituteId : null,
      });
      setMessage(t('common.saved'));
      await load();
    } catch (e) {
      setMessage(errorMessage(e));
    }
  }

  return (
    <View className="gap-6">
      <Panel title={t('admin.overrides.new')}>
        <View className="flex-row flex-wrap items-end gap-3">
          <Field label={t('admin.overrides.date')}>
            <DateInput value={date} onChange={setDate} />
          </Field>
          <Field label={t('admin.timetable.class')}>
            <Select
              className="w-36"
              value={classId}
              onChange={setClassId}
              options={[{ value: null, label: t('admin.timetable.allClasses') }, ...classes.map(([id, name]) => ({ value: id, label: name }))]}
            />
          </Field>
          <Field label={t('admin.overrides.lesson')}>
            <Select
              className="w-80"
              value={slotId}
              onChange={setSlotId}
              placeholder={daySlots.length ? t('admin.overrides.chooseLesson') : t('admin.overrides.noLessons')}
              options={daySlots.map((s) => ({
                value: s.id,
                label: `${formatTime(s.starts_at)} · ${s.class_name} · ${s.subject_name} (${s.professor_name})`,
              }))}
            />
          </Field>
        </View>
        <View className="flex-row flex-wrap items-end gap-3">
          <Field label={t('admin.overrides.change')}>
            <Select
              className="w-56"
              value={kind}
              onChange={(value) => {
                setKind(value);
                setSubstituteId(null);
              }}
              options={[
                { value: 'cancel', label: t('admin.overrides.cancel') },
                { value: 'professor', label: t('admin.overrides.substituteProfessor') },
                { value: 'subject', label: t('admin.overrides.substituteSubject') },
              ]}
            />
          </Field>
          {kind === 'professor' && (
            <Field label={t('admin.timetable.professor')}>
              <Select
                className="w-56"
                value={substituteId}
                onChange={setSubstituteId}
                options={professors.map((p) => ({ value: p.id, label: p.display_name || p.username }))}
              />
            </Field>
          )}
          {kind === 'subject' && (
            <Field label={t('admin.timetable.subject')}>
              <Select
                className="w-72"
                value={substituteId}
                onChange={setSubstituteId}
                options={subjects.map((s) => ({ value: s.id, label: `${s.name} (${s.professor_name})` }))}
              />
            </Field>
          )}
          <Button disabled={!slotId || (kind !== 'cancel' && !substituteId)} onPress={save}>
            <Icon as={Save} />
            <Text>{t('common.save')}</Text>
          </Button>
        </View>
        {message && <Text className="text-sm text-muted-foreground">{message}</Text>}
        <Text className="text-xs text-muted-foreground">{t('admin.overrides.help')}</Text>
      </Panel>

      <Panel title={t('admin.overrides.upcoming')}>
        {overrides.length === 0 && <Text className="text-sm text-muted-foreground">{t('admin.overrides.empty')}</Text>}
        {overrides.map((o) => (
          <View key={o.id} className="flex-row flex-wrap items-center gap-3">
            <Text className="w-40 text-sm tabular-nums">{formatDateShort(o.date)}</Text>
            <Text className="flex-1 text-sm">
              {o.slot ? `${formatTime(o.slot.starts_at)} · ${o.slot.class_name} · ${o.slot.subject_name}` : ''}
            </Text>
            <Text className="text-sm font-medium">
              {o.cancelled
                ? t('admin.overrides.cancelled')
                : o.substitute_subject_name
                  ? t('admin.overrides.becomes', { name: o.substitute_subject_name })
                  : t('admin.overrides.substitute', { name: o.substitute_professor_name })}
            </Text>
            <Button
              variant="ghost"
              size="icon"
              accessibilityLabel={t('common.delete')}
              onPress={() => api.deleteOverride(o.id).then(load)}>
              <Icon as={Trash2} size={14} />
            </Button>
          </View>
        ))}
      </Panel>
    </View>
  );
}
