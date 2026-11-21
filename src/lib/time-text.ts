export function toHalfwidthTime(value: string): string {
  const text = String(value || '')
    .normalize('NFKC')
    .replace(/[：・]/g, ':')
    .replace(/\s+/g, '');
  const kanji = text.match(/^(\d{1,2})時(?:(\d{1,2})分?)?$/);
  if (kanji) return `${Number(kanji[1])}:${String(kanji[2] || '0').padStart(2, '0')}`;
  const clock = text.match(/^(\d{1,2}):(\d{2})/);
  if (clock) return `${Number(clock[1])}:${clock[2]}`;
  return text.trim();
}
