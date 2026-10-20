import {
  Atom,
  BookOpen,
  Calculator,
  Dna,
  FlaskConical,
  Globe,
  Landmark,
  Languages,
  Leaf,
  Monitor,
  Music,
  Palette,
  type LucideIcon,
} from 'lucide-react-native';

// Keys match the `icon` field the backend stores for each subject.
export const SUBJECT_ICONS: Record<string, LucideIcon> = {
  'book-open': BookOpen,
  calculator: Calculator,
  atom: Atom,
  'flask-conical': FlaskConical,
  leaf: Leaf,
  dna: Dna,
  landmark: Landmark,
  globe: Globe,
  languages: Languages,
  monitor: Monitor,
  music: Music,
  palette: Palette,
};

export const SUBJECT_COLORS = ['#2563eb', '#7c3aed', '#0891b2', '#16a34a', '#d97706', '#dc2626', '#db2777', '#475569'];

export function subjectIcon(key: string): LucideIcon {
  return SUBJECT_ICONS[key] ?? BookOpen;
}

/** `#rrggbb` + alpha (0-1) -> `#rrggbbaa`, for soft subject-colored backgrounds. */
export function tint(hex: string, alpha: number) {
  return `${hex}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
}
