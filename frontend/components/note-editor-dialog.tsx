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
import { Text } from '@/components/ui/text';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage, type Note } from '@/lib/api';
import { useNotesStore } from '@/stores/notes-store';
import { Pin, PinOff, Trash2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

type NoteEditorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subjectId: number;
  /** Edit this note; omit to create a new one. */
  note?: Note | null;
  /** New notes are linked to this section (e.g. when created from the reader). */
  section?: { id: number; title: string } | null;
};

export function NoteEditorDialog({ open, onOpenChange, subjectId, note, section }: NoteEditorDialogProps) {
  const createNote = useNotesStore((state) => state.createNote);
  const updateNote = useNotesStore((state) => state.updateNote);
  const deleteNote = useNotesStore((state) => state.deleteNote);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(note?.title ?? '');
    setContent(note?.content ?? '');
    setPinned(note?.pinned ?? false);
    setError(null);
  }, [open, note]);

  const linkedSection = note ? note.section_title : section?.title;

  async function save() {
    if (!title.trim() && !content.trim()) {
      setError('Write a title or some content first.');
      return;
    }
    setSaving(true);
    try {
      const input = { title: title.trim(), content, pinned };
      if (note) await updateNote(note, input);
      else await createNote(subjectId, { ...input, section_id: section?.id ?? null });
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!note) return;
    try {
      await deleteNote(note);
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-full sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{note ? 'Edit note' : 'New note'}</DialogTitle>
            <DialogDescription>
              {linkedSection ? `Linked to “${linkedSection}”` : 'A general note for this subject'}
            </DialogDescription>
          </DialogHeader>
          <View className="gap-3">
            <Input placeholder="Title" value={title} onChangeText={setTitle} autoFocus={!note} />
            <Textarea
              placeholder="Write your note…"
              value={content}
              onChangeText={setContent}
              numberOfLines={12}
              className="min-h-64"
            />
            {error && <Text className="text-sm text-destructive">{error}</Text>}
          </View>
          <DialogFooter className="sm:items-center">
            {note && (
              <Button variant="ghost" onPress={() => setConfirmDelete(true)}>
                <Icon as={Trash2} className="text-destructive" />
                <Text className="text-destructive">Delete</Text>
              </Button>
            )}
            <Button variant="ghost" onPress={() => setPinned((value) => !value)}>
              <Icon as={pinned ? PinOff : Pin} />
              <Text>{pinned ? 'Unpin' : 'Pin to top'}</Text>
            </Button>
            <View className="hidden flex-1 sm:flex" />
            <Button variant="outline" onPress={() => onOpenChange(false)}>
              <Text>Cancel</Text>
            </Button>
            <Button onPress={save} disabled={saving}>
              <Text>{saving ? 'Saving…' : 'Save note'}</Text>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this note?</AlertDialogTitle>
            <AlertDialogDescription>“{note?.title || 'Untitled note'}” will be permanently deleted.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Text>Cancel</Text>
            </AlertDialogCancel>
            <AlertDialogAction className="bg-destructive" onPress={remove}>
              <Text className="text-white">Delete</Text>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
