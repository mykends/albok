import { Field, Panel } from '@/components/admin/panel';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { api, type SchoolClass } from '@/lib/api';
import { errorMessage } from '@/lib/i18n';
import { Plus, Save, Trash2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

export function ClassesTab() {
  const { t } = useTranslation();
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [name, setName] = useState('');
  const [level, setLevel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .classes()
      .then(setClasses)
      .catch((e) => setError(errorMessage(e)));
  useEffect(() => {
    load();
  }, []);

  async function attempt(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <View className="gap-6">
      <Panel title={t('admin.classes.add')} description={t('admin.classes.addHint')}>
        <View className="flex-row flex-wrap items-end gap-3">
          <Field label={t('admin.classes.name')}>
            <Input className="w-28" value={name} onChangeText={setName} placeholder="3.B" />
          </Field>
          <Field label={t('admin.classes.level')}>
            <Input className="w-20" inputMode="numeric" value={level} onChangeText={setLevel} placeholder="3" />
          </Field>
          <Button
            disabled={!name.trim() || !Number(level)}
            onPress={() =>
              attempt(async () => {
                await api.createClass(name.trim(), Number(level));
                setName('');
                setLevel('');
              })
            }>
            <Icon as={Plus} />
            <Text>{t('common.add')}</Text>
          </Button>
        </View>
      </Panel>
      {error && <Text className="text-sm text-destructive">{error}</Text>}
      <Panel title={t('admin.classes.list', { count: classes.length })}>
        {classes.length === 0 && <Text className="text-sm text-muted-foreground">{t('admin.classes.empty')}</Text>}
        {classes.map((c) => (
          <ClassRow key={c.id} schoolClass={c} attempt={attempt} />
        ))}
      </Panel>
    </View>
  );
}

function ClassRow({ schoolClass, attempt }: { schoolClass: SchoolClass; attempt: (action: () => Promise<unknown>) => Promise<void> }) {
  const { t } = useTranslation();
  const [name, setName] = useState(schoolClass.name);
  const [level, setLevel] = useState(String(schoolClass.year_level));
  const changed = name !== schoolClass.name || level !== String(schoolClass.year_level);
  return (
    <View className="flex-row flex-wrap items-center gap-3">
      <Input className="w-28" value={name} onChangeText={setName} />
      <Input className="w-16" inputMode="numeric" value={level} onChangeText={setLevel} />
      <Text className="flex-1 text-sm text-muted-foreground">{t('admin.classes.students', { count: schoolClass.student_count })}</Text>
      {changed && (
        <Button size="sm" onPress={() => attempt(() => api.updateClass(schoolClass.id, name.trim(), Number(level)))}>
          <Icon as={Save} />
          <Text>{t('common.save')}</Text>
        </Button>
      )}
      <Button variant="ghost" size="icon" accessibilityLabel={t('common.delete')} onPress={() => attempt(() => api.deleteClass(schoolClass.id))}>
        <Icon as={Trash2} size={14} />
      </Button>
    </View>
  );
}
