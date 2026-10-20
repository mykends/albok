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
import { errorMessage, type PickedFile, type Subject } from '@/lib/api';
import { useBooksStore } from '@/stores/books-store';
import * as DocumentPicker from 'expo-document-picker';
import { ClipboardPaste, FileText, Upload } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

const ACCEPTED_TYPES = Platform.select({
  web: ['.pdf', '.docx', '.txt', '.md', '.markdown'],
  default: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown',
  ],
});

type Mode = 'file' | 'text';

export function ImportBookDialog({
  open,
  onOpenChange,
  subject,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subject: Subject;
}) {
  const importFile = useBooksStore((state) => state.importFile);
  const importText = useBooksStore((state) => state.importText);

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

  async function pickFile() {
    const result = await DocumentPicker.getDocumentAsync({ type: ACCEPTED_TYPES, copyToCacheDirectory: true });
    const asset = result.canceled ? undefined : result.assets[0];
    if (asset) {
      setFile({ name: asset.name, uri: asset.uri, mimeType: asset.mimeType, file: asset.file });
      setError(null);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'file' && file) await importFile(subject.id, file, title);
      else await importText(subject.id, title.trim(), text);
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
          <DialogTitle>Import a book into {subject.name}</DialogTitle>
          <DialogDescription>
            Albok splits it into sections using PDF bookmarks, headings or chapter titles, so you can follow along in
            class.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(value) => setMode(value as Mode)}>
          <TabsList>
            <TabsTrigger value="file">
              <Icon as={Upload} size={14} />
              <Text>Upload file</Text>
            </TabsTrigger>
            <TabsTrigger value="text">
              <Icon as={ClipboardPaste} size={14} />
              <Text>Paste text</Text>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="file" className="gap-4 pt-2">
            <Pressable
              onPress={pickFile}
              className="items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 web:transition-colors web:hover:bg-accent">
              <Icon as={file ? FileText : Upload} size={26} className="text-muted-foreground" />
              <Text className="font-medium">{file ? file.name : 'Choose a file'}</Text>
              <Text className="text-sm text-muted-foreground">
                {file ? 'Click to choose a different file' : 'PDF, Word (.docx), text or Markdown'}
              </Text>
            </Pressable>
            <View className="gap-2">
              <Label nativeID="import-file-title">Title (optional)</Label>
              <Input
                aria-labelledby="import-file-title"
                placeholder="Leave empty to use the file's own title"
                value={title}
                onChangeText={setTitle}
              />
            </View>
          </TabsContent>

          <TabsContent value="text" className="gap-4 pt-2">
            <View className="gap-2">
              <Label nativeID="import-text-title">Title</Label>
              <Input
                aria-labelledby="import-text-title"
                placeholder="e.g. Chapter 4 handout"
                value={title}
                onChangeText={setTitle}
              />
            </View>
            <Textarea
              placeholder={'Paste text here. Lines like "Chapter 2" or "## Heading" start new sections.'}
              value={text}
              onChangeText={setText}
              numberOfLines={10}
              className="min-h-56"
            />
          </TabsContent>
        </Tabs>

        {error && <Text className="text-sm text-destructive">{error}</Text>}

        <DialogFooter>
          <Button variant="outline" onPress={() => onOpenChange(false)}>
            <Text>Cancel</Text>
          </Button>
          <Button onPress={submit} disabled={!canSubmit || busy}>
            <Text>{busy ? 'Importing…' : 'Import'}</Text>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
