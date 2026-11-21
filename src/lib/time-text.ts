export function toHalfwidthTime(value: string): string {
  let text = String(value || '')
    .normalize('NFKC')
    .replace(/[：・]/g, ':')
    .replace(/\s+/g, '');
  text = text.replace(/(\d{1,2})時/g, (_, hour: string) => `${Number(hour)}:00`);
  text = text.replace(/(\d{1,2}):(\d{2})/g, (_, hour: string, minute: string) => `${Number(hour)}:${minute}`);
  return text.trim();
}
