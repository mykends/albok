import { Atom, BookOpen, Calculator, FlaskConical, Landmark, Leaf, type LucideIcon } from 'lucide-react-native';

// Keys match the `icon` field the backend stores for each subject.
const SUBJECT_ICONS: Record<string, LucideIcon> = {
  calculator: Calculator,
  atom: Atom,
  'flask-conical': FlaskConical,
  leaf: Leaf,
  landmark: Landmark,
};

export function subjectIcon(key: string): LucideIcon {
  return SUBJECT_ICONS[key] ?? BookOpen;
}

/** `#rrggbb` + alpha (0-1) -> `#rrggbbaa`, for soft subject-colored backgrounds. */
export function tint(hex: string, alpha: number) {
  return `${hex}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
}

export function readingMinutes(wordCount: number) {
  return Math.max(1, Math.round(wordCount / 200));
}
