import { Input } from '@/components/ui/input';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';

const HR_DATE = /^(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4})\.?$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{1,2})[:.](\d{2})$/;

function display(value: string, type: 'date' | 'time') {
  if (!value) return '';
  return type === 'date' ? formatDate(value) : value.slice(0, 5);
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/** Returns the ISO value, '' for empty input, or null if the text isn't a valid date/time. */
function parse(text: string, type: 'date' | 'time'): string | null {
  const value = text.trim();
  if (!value) return '';
  if (type === 'time') {
    const match = TIME.exec(value);
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
    return `${pad(Number(match[1]))}:${match[2]}`;
  }
  const iso = ISO_DATE.exec(value);
  const hr = HR_DATE.exec(value);
  const [year, month, day] = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : hr
      ? [Number(hr[3]), Number(hr[2]), Number(hr[1])]
      : [0, 0, 0];
  const date = new Date(year, month - 1, day);
  if (!year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Date ("21. 10. 2026.") or 24-hour time ("08:00") in Croatian format, whatever the browser's locale.
 * `value` and `onChange` use ISO strings (2026-10-21 / 08:00). */
export function DateInput({
  value,
  onChange,
  type = 'date',
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  type?: 'date' | 'time';
  className?: string;
}) {
  const [text, setText] = useState(display(value, type));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setText(display(value, type));
    setInvalid(false);
  }, [value, type]);

  function commit() {
    const parsed = parse(text, type);
    setInvalid(parsed === null);
    if (parsed !== null && parsed !== value) onChange(parsed);
    else if (parsed !== null) setText(display(parsed, type));
  }

  return (
    <Input
      value={text}
      onChangeText={setText}
      onBlur={commit}
      onSubmitEditing={commit}
      placeholder={type === 'date' ? 'd. m. gggg.' : 'hh:mm'}
      aria-invalid={invalid}
      className={cn(type === 'date' ? 'w-36' : 'w-24', invalid && 'border-destructive', className)}
    />
  );
}
