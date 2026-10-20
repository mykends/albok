import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { api } from '@/lib/api';
import { useLocalSearchParams } from 'expo-router';
import Head from 'expo-router/head';
import { CircleAlert, GraduationCap, Info } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, View } from 'react-native';

export default function LoginScreen() {
  const { t } = useTranslation();
  const { error, reason, next } = useLocalSearchParams<{ error?: string; reason?: string; next?: string }>();
  const [redirecting, setRedirecting] = useState(false);
  const [config, setConfig] = useState<{ school_name: string; privacy_url: string | null } | null>(null);

  useEffect(() => {
    api.publicConfig().then(setConfig).catch(() => {});
  }, []);

  function signIn() {
    setRedirecting(true);
    window.location.assign(api.loginUrl(next || '/'));
  }

  return (
    <View className="flex-1 items-center justify-center bg-muted/40 p-6">
      <Head>
        <title>{`${t('login.title')} · Albok`}</title>
      </Head>
      <View className="w-full max-w-sm gap-6 rounded-2xl border border-border bg-card p-8 shadow-sm shadow-black/5">
        <View className="items-center gap-3">
          <View className="size-14 items-center justify-center rounded-2xl bg-primary">
            <Icon as={GraduationCap} size={30} className="text-primary-foreground" />
          </View>
          <Text className="text-2xl font-bold">Albok</Text>
          <Text className="text-center text-muted-foreground">{config?.school_name || t('login.subtitle')}</Text>
        </View>

        {!!error && (
          <View className="flex-row gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3">
            <Icon as={CircleAlert} size={18} className="text-destructive" />
            <Text className="flex-1 text-sm">{error}</Text>
          </View>
        )}
        {!error && (reason === 'idle' || reason === 'day-end' || reason === 'expired') && (
          <View className="flex-row gap-2 rounded-lg bg-secondary p-3">
            <Icon as={Info} size={18} className="text-muted-foreground" />
            <Text className="flex-1 text-sm">{t(`login.reason.${reason}`)}</Text>
          </View>
        )}

        {/* AAI@EduHr certification requires its logo next to the login button. */}
        <Button size="lg" className="h-12" disabled={redirecting} onPress={signIn}>
          <View className="rounded bg-white px-1.5 py-0.5">
            <Text className="text-xs font-bold text-[#003c71]">AAI@EduHr</Text>
          </View>
          <Text>{redirecting ? t('login.redirecting') : t('login.button')}</Text>
        </Button>
        <Text className="text-center text-xs text-muted-foreground">{t('login.help')}</Text>
      </View>
      <View className="mt-6 flex-row flex-wrap justify-center gap-1">
        <Text className="text-xs text-muted-foreground">{t('login.privacy')}</Text>
        {config?.privacy_url && (
          <Pressable onPress={() => Linking.openURL(config.privacy_url!)}>
            <Text className="text-xs text-muted-foreground underline">{t('login.privacyLink')}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
