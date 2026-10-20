import { Checkbox } from '@/components/checkbox';
import { Panel } from '@/components/admin/panel';
import { Select } from '@/components/select';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { api, type AdminUser } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { errorMessage } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useSession } from '@/stores/session-store';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

type Role = 'student' | 'professor' | 'admin' | null;

export function UsersTab() {
  const { t } = useTranslation();
  const me = useSession((state) => state.me)!;
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<Role>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      api
        .users(query.trim() || undefined, role ?? undefined)
        .then(setUsers)
        .catch((e) => setError(errorMessage(e)));
    }, 250);
    return () => clearTimeout(timer);
  }, [query, role]);

  async function update(user: AdminUser, patch: Partial<Pick<AdminUser, 'is_professor' | 'is_admin' | 'active'>>) {
    setError(null);
    try {
      const updated = await api.updateUser(user.id, patch);
      setUsers((current) => current.map((u) => (u.id === updated.id ? updated : u)));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <View className="gap-4">
      <View className="flex-row flex-wrap gap-3">
        <Input className="w-72" placeholder={t('admin.users.search')} value={query} onChangeText={setQuery} />
        <Select
          className="w-44"
          value={role}
          onChange={setRole}
          options={[
            { value: null, label: t('admin.users.allRoles') },
            { value: 'student', label: t('roles.student') },
            { value: 'professor', label: t('roles.professor') },
            { value: 'admin', label: t('roles.admin') },
          ]}
        />
      </View>
      {error && <Text className="text-sm text-destructive">{error}</Text>}
      <Panel title={t('admin.users.count', { count: users.length })} description={t('admin.users.hint')}>
        {users.map((user) => (
          <View key={user.id} className={cn('flex-row flex-wrap items-center gap-x-5 gap-y-1 border-b border-border py-2', !user.active && 'opacity-60')}>
            <View className="min-w-56 flex-1">
              <Text className="font-medium">{user.display_name || user.username}</Text>
              <Text className="text-xs text-muted-foreground">
                {user.username}
                {user.class_names.length ? ` · ${user.class_names.join(', ')}` : ''}
                {user.is_student ? ` · ${t('roles.student')}` : ''}
              </Text>
              <Text className="text-xs text-muted-foreground">
                {user.last_login_at ? t('admin.users.lastLogin', { when: formatDateTime(user.last_login_at) }) : t('admin.users.neverSignedIn')}
              </Text>
            </View>
            <Checkbox label={t('roles.professor')} checked={user.is_professor} onChange={(value) => update(user, { is_professor: value })} />
            <Checkbox
              label={t('roles.admin')}
              checked={user.is_admin}
              disabled={user.id === me.id}
              onChange={(value) => update(user, { is_admin: value })}
            />
            <Checkbox
              label={t('admin.users.active')}
              checked={user.active}
              disabled={user.id === me.id}
              onChange={(value) => update(user, { active: value })}
            />
          </View>
        ))}
      </Panel>
    </View>
  );
}
