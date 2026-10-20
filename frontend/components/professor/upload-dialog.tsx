import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Text } from '@/components/ui/text';
import { Textarea } from '@/components/ui/textarea';
import type { PickedFile } from '@/lib/api';
import { errorMessage } from '@/lib/i18n';
import * as DocumentPicker from 'expo-document-picker';
import { ClipboardPaste, FileText, Upload } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

export const ACCEPTED_FILES = [
  '.pdf', '.docx', '.odt', '.pptx', '.odp', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.md', '.markdown', '.txt',
]; // prettier-ignore
const MAX_BYTES = 300 * 1024 * 1024;

export async function pickFile(types: string[] = ACCEPTED_FILES): Promise<PickedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: types, copyToCacheDirectory: true });
  const asset = result.canceled ? undefined : result.assets[0];
  return asset ? { name: asset.name, uri: asset.uri, mimeType: asset.mimeType, file: asset.file } : null;
}

type Mode = 'file' | 'text';

/** Upload a file (or paste text) as a new book. Sections are suggested by the server and start hidden. */
export function UploadDialog({
  open,
  onOpenChange,
  subjectName,
  onUploadFile,
  onPasteText,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subjectName: string;
  onUploadFile: (file: PickedFile, title: string) => Promise<void>;
  onPasteText: (title: string, text: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('file');
  const [file, setFile] = useState<PickedFile | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode('file');
    setFile(null);
    setTitle('');
    setText('');
    setError(null);
  }, [open]);

  async function choose() {
    const picked = await pickFile();
    if (!picked) return;
    if (picked.file && picked.file.size > MAX_BYTES) {
      setError(t('upload.tooLarge'));
      return;
    }
    setFile(picked);
    setError(null);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'file' && file) await onUploadFile(file, title);
      else await onPasteText(title.trim(), text);
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = mode === 'file' ? !!file : !!title.trim() && !!text.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('upload.title', { subject: subjectName })}</DialogTitle>
          <DialogDescription>{t('upload.description')}</DialogDescription>
        </DialogHeader>
        <Tabs value={mode} onValueChange={(value) => setMode(value as Mode)}>
          <TabsList>
            <TabsTrigger value="file">
              <Icon as={Upload} size={14} />
              <Text>{t('upload.fileTab')}</Text>
            </TabsTrigger>
            <TabsTrigger value="text">
              <Icon as={ClipboardPaste} size={14} />
              <Text>{t('upload.textTab')}</Text>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="file" className="gap-4 pt-2">
            <Pressable
              onPress={choose}
              className="items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 web:transition-colors web:hover:bg-accent">
              <Icon as={file ? FileText : Upload} size={26} className="text-muted-foreground" />
              <Text className="font-medium">{file ? file.name : t('upload.choose')}</Text>
              <Text className="text-center text-sm text-muted-foreground">{file ? t('upload.chooseOther') : t('upload.formats')}</Text>
            </Pressable>
            <View className="gap-2">
              <Label nativeID="upload-title">{t('upload.titleOptional')}</Label>
              <Input aria-labelledby="upload-title" placeholder={t('upload.titlePlaceholder')} value={title} onChangeText={setTitle} />
            </View>
          </TabsContent>
          <TabsContent value="text" className="gap-4 pt-2">
            <View className="gap-2">
              <Label nativeID="paste-title">{t('upload.titleLabel')}</Label>
              <Input aria-labelledby="paste-title" value={title} onChangeText={setTitle} />
            </View>
            <Textarea placeholder={t('upload.textPlaceholder')} value={text} onChangeText={setText} numberOfLines={10} className="min-h-56" />
          </TabsContent>
        </Tabs>
        {error && <Text className="text-sm text-destructive">{error}</Text>}
        <DialogFooter>
          <Button variant="outline" onPress={() => onOpenChange(false)}>
            <Text>{t('common.cancel')}</Text>
          </Button>
          <Button onPress={submit} disabled={!canSubmit || busy}>
            <Text>{busy ? t('upload.uploading') : t('upload.submit')}</Text>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
