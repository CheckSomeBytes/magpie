import type { LibraryItem } from '../../shared/ipc';

export interface DayGroup {
  key: string;
  label: string;
  items: LibraryItem[];
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** "Today", "Yesterday", weekday within the last week, else a full date. Items arrive pre-sorted. */
export function dayLabel(d: Date, now = new Date()): string {
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric', ...(d.getFullYear() === now.getFullYear() ? { year: undefined } : {}) });
}

export function groupByDay(items: LibraryItem[], _sort: 'newest' | 'oldest', now = new Date()): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const item of items) {
    const d = new Date(item.createdAt);
    const key = dayKey(d);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, label: dayLabel(d, now), items: [item] });
  }
  return groups;
}
