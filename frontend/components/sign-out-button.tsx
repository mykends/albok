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
import { Text } from '@/components/ui/text';
import { useSession } from '@/stores/session-store';
import { LogOut } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Signs out after flushing notes; if some couldn't be saved, asks before discarding them. */
export function SignOutButton({ compact }: { compact?: boolean }) {
  const { t } = useTranslation();
  const signOut = useSession((state) => state.signOut);
  const [busy, setBusy] = useState(false);
  const [unsynced, setUnsynced] = useState(false);

  async function run(force = false) {
    setBusy(true);
    const result = await signOut('manual', { force });
    setBusy(false);
    setUnsynced(result === 'unsynced');
  }

  return (
    <>
      <Button
        variant="ghost"
        size={compact ? 'icon' : 'default'}
        className="justify-start"
        disabled={busy}
        accessibilityLabel={t('session.signOut')}
        onPress={() => run()}>
        <Icon as={LogOut} size={16} />
        {!compact && <Text>{busy ? t('session.signingOut') : t('session.signOut')}</Text>}
      </Button>
      <AlertDialog open={unsynced} onOpenChange={setUnsynced}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('session.unsyncedTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('session.unsyncedDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onPress={() => run()}>
              <Text>{t('session.retry')}</Text>
            </AlertDialogCancel>
            <AlertDialogAction className="bg-destructive" onPress={() => run(true)}>
              <Text className="text-white">{t('session.signOutAnyway')}</Text>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
