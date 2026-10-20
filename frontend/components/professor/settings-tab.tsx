import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Text } from '@/components/ui/text';
import { Textarea } from '@/components/ui/textarea';
import { api, type ProfessorSubject } from '@/lib/api';
import { errorMessage } from '@/lib/i18n';
import { SUBJECT_COLORS, SUBJECT_ICONS } from '@/lib/subjects';
import { cn } from '@/lib/utils';
import { Check, Save } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

export function SettingsTab({ subject, onSaved }: { subject: ProfessorSubject; onSaved: (subject: ProfessorSubject) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(subject.name);
  const [description, setDescription] = useState(subject.description);
  const [color, setColor] = useState(subject.color);
  const [icon, setIcon] = useState(subject.icon);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setName(subject.name);
    setDescription(subject.description);
    setColor(subject.color);
    setIcon(subject.icon);
  }, [subject]);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      onSaved(await api.updateSubject(subject.id, { name: name.trim(), description: description.trim(), color, icon }));
      setMessage(t('settings.saved'));
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="max-w-xl gap-5">
      <View className="gap-2">
        <Label nativeID="subject-name">{t('settings.name')}</Label>
        <Input aria-labelledby="subject-name" value={name} onChangeText={setName} />
        <Text className="text-xs text-muted-foreground">{t('settings.timetableName', { name: subject.timetable_name })}</Text>
      </View>
      <View className="gap-2">
        <Label nativeID="subject-description">{t('settings.description')}</Label>
        <Textarea aria-labelledby="subject-description" value={description} onChangeText={setDescription} className="min-h-20" />
      </View>
      <View className="gap-2">
        <Label>{t('settings.color')}</Label>
        <View className="flex-row flex-wrap gap-2">
          {SUBJECT_COLORS.map((value) => (
            <Pressable
              key={value}
              accessibilityLabel={value}
              onPress={() => setColor(value)}
              className={cn('size-9 items-center justify-center rounded-full', color === value && 'border-2 border-foreground')}
              style={{ backgroundColor: value }}>
              {color === value && <Icon as={Check} size={16} color="#fff" />}
            </Pressable>
          ))}
        </View>
      </View>
      <View className="gap-2">
        <Label>{t('settings.icon')}</Label>
        <View className="flex-row flex-wrap gap-2">
          {Object.entries(SUBJECT_ICONS).map(([key, IconComponent]) => (
            <Pressable
              key={key}
              accessibilityLabel={key}
              onPress={() => setIcon(key)}
              className={cn('size-10 items-center justify-center rounded-lg border border-border web:hover:bg-accent', icon === key && 'border-primary bg-accent')}>
              <Icon as={IconComponent} size={18} color={icon === key ? color : undefined} />
            </Pressable>
          ))}
        </View>
      </View>
      <View className="flex-row items-center gap-3">
        <Button disabled={busy || !name.trim()} onPress={save}>
          <Icon as={Save} />
          <Text>{t('common.save')}</Text>
        </Button>
        {message && <Text className="text-sm text-muted-foreground">{message}</Text>}
      </View>
    </View>
  );
}
