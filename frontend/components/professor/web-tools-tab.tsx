import { EmptyState } from '@/components/empty-state';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { api, type ProfessorSubject, type WebTool } from '@/lib/api';
import { errorMessage } from '@/lib/i18n';
import { ChevronDown, ChevronUp, ExternalLink, Globe, Pencil, Plus, Save, Trash2, type LucideIcon } from 'lucide-react-native';
import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, View } from 'react-native';

/** Professors are never restricted: this opens the tool in their own browser, not for students (R11). */
export function openInOwnBrowser(url: string) {
  void Linking.openURL(url);
}

/** Name and link fields. The server checks the link and its reason is shown under the fields. */
export function WebToolForm({
  submitLabel,
  submitIcon = Plus,
  initial,
  onSubmit,
  onCancel,
}: {
  submitLabel: string;
  submitIcon?: LucideIcon;
  initial?: { name: string; url: string };
  onSubmit: (name: string, url: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [name, setName] = useState(initial?.name ?? '');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(name.trim(), url.trim());
      if (!initial) {
        setName('');
        setUrl('');
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="gap-3">
      <View className="flex-row flex-wrap gap-3">
        <View className="min-w-48 flex-1 gap-1.5">
          <Label nativeID={`${id}-name`}>{t('webTools.name')}</Label>
          <Input aria-labelledby={`${id}-name`} value={name} onChangeText={setName} placeholder={t('webTools.namePlaceholder')} />
        </View>
        <View className="min-w-64 flex-[2] gap-1.5">
          <Label nativeID={`${id}-url`}>{t('webTools.url')}</Label>
          <Input
            aria-labelledby={`${id}-url`}
            aria-invalid={!!error}
            value={url}
            onChangeText={setUrl}
            placeholder="https://"
            autoCapitalize="none"
            autoCorrect={false}
            inputMode="url"
            onSubmitEditing={submit}
          />
        </View>
      </View>
      {error ? (
        <Text className="text-sm text-destructive">{error}</Text>
      ) : (
        <Text className="text-xs text-muted-foreground">{t('webTools.urlHint')}</Text>
      )}
      <View className="flex-row gap-2">
        <Button size="sm" disabled={busy || !name.trim() || !url.trim()} onPress={submit}>
          <Icon as={submitIcon} />
          <Text>{submitLabel}</Text>
        </Button>
        {onCancel && (
          <Button size="sm" variant="ghost" onPress={onCancel}>
            <Text>{t('common.cancel')}</Text>
          </Button>
        )}
      </View>
    </View>
  );
}

/** The Subject's web tools. They carry over to the next school year, like books and presets. */
export function WebToolsTab({ subject }: { subject: ProfessorSubject }) {
  const { t } = useTranslation();
  const [tools, setTools] = useState<WebTool[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<WebTool | null>(null);

  const load = useCallback(
    () =>
      api
        .webTools(subject.id)
        .then(setTools)
        .catch((e) => setError(errorMessage(e))),
    [subject.id]
  );
  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    }
    await load();
  }

  if (!tools) return <Skeleton className="h-48 rounded-xl" />;

  return (
    <View className="gap-5">
      <Text className="text-sm text-muted-foreground">{t('webTools.hint')}</Text>
      {error && <Text className="text-sm text-destructive">{error}</Text>}

      {tools.length === 0 ? (
        <EmptyState icon={Globe} title={t('webTools.emptyTitle')} description={t('webTools.empty')} />
      ) : (
        <View className="gap-1 rounded-xl border border-border bg-card p-3">
          {tools.map((tool, index) =>
            editing === tool.id ? (
              <View key={tool.id} className="rounded-md bg-accent/40 p-3">
                <WebToolForm
                  submitLabel={t('common.save')}
                  submitIcon={Save}
                  initial={tool}
                  onCancel={() => setEditing(null)}
                  onSubmit={async (name, url) => {
                    await api.updateWebTool(tool.id, { name, url });
                    setEditing(null);
                    await load();
                  }}
                />
              </View>
            ) : (
              <View key={tool.id} className="flex-row flex-wrap items-center gap-2 rounded-md px-2 py-1.5 web:hover:bg-accent/60">
                <View className="min-w-48 flex-1">
                  <Text className="font-medium">{tool.name}</Text>
                  <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                    {tool.url}
                  </Text>
                </View>
                <Button variant="ghost" size="sm" onPress={() => openInOwnBrowser(tool.url)} accessibilityHint={t('webTools.tryHint')}>
                  <Icon as={ExternalLink} />
                  <Text>{t('webTools.try')}</Text>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={index === 0}
                  accessibilityLabel={t('webTools.moveUp')}
                  onPress={() => run(() => api.updateWebTool(tool.id, { position: index - 1 }))}>
                  <Icon as={ChevronUp} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={index === tools.length - 1}
                  accessibilityLabel={t('webTools.moveDown')}
                  onPress={() => run(() => api.updateWebTool(tool.id, { position: index + 1 }))}>
                  <Icon as={ChevronDown} />
                </Button>
                <Button variant="ghost" size="icon" accessibilityLabel={t('common.edit')} onPress={() => setEditing(tool.id)}>
                  <Icon as={Pencil} />
                </Button>
                <Button variant="ghost" size="icon" accessibilityLabel={t('webTools.delete')} onPress={() => setDeleting(tool)}>
                  <Icon as={Trash2} className="text-destructive" />
                </Button>
              </View>
            )
          )}
        </View>
      )}

      <View className="gap-3 rounded-xl border border-border bg-card p-5">
        <Text className="font-semibold">{t('webTools.add')}</Text>
        <WebToolForm
          submitLabel={t('webTools.add')}
          onSubmit={async (name, url) => {
            await api.createWebTool(subject.id, name, url);
            await load();
          }}
        />
      </View>

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('webTools.deleteTitle', { name: deleting?.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('webTools.deleteDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Text>{t('common.cancel')}</Text>
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive"
              onPress={() => {
                const tool = deleting;
                setDeleting(null);
                if (tool) void run(() => api.deleteWebTool(tool.id));
              }}>
              <Text className="text-white">{t('webTools.delete')}</Text>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </View>
  );
}
