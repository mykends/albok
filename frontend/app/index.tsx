import { ProfessorHome } from '@/components/professor-home';
import { StudentHome } from '@/components/student-home';
import { useSession } from '@/stores/session-store';
import { Redirect } from 'expo-router';

export default function HomeScreen() {
  const me = useSession((state) => state.me);
  if (!me) return null;
  if (me.is_professor) return <ProfessorHome />;
  if (me.is_admin) return <Redirect href={{ pathname: '/admin', params: { tab: 'year' } }} />;
  return <StudentHome />;
}
