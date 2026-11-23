export function closeKeyOf(value: unknown): string {
  const text = String(value ?? '')
    .replace(/\.0$/, '')
    .trim();
  if (!text) return '';
  if (text.includes('末')) return 'end';
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0) return '';
  if (number === 0) return '00';
  if (number >= 28) return 'end';
  return String(Math.round(number));
}

export function closeLabel(key: string): string {
  if (key === 'end') return '末日締め';
  if (key === '00') return '00日締め';
  return `${key}日締め`;
}

function lastDay(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function isoFromDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function billingPeriod(closeKey: string, iso: string): { start: string; end: string } | null {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match || !closeKey) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // 00日締めは、選んだ月の1日から末日まで（住友林業など締日0の得意先）
  if (closeKey === '00') {
    const end = lastDay(year, month);
    return {
      start: `${match[1]}-${match[2]}-01`,
      end: `${match[1]}-${match[2]}-${String(end).padStart(2, '0')}`,
    };
  }
  const closeDay = (y: number, m: number) =>
    closeKey === 'end' ? lastDay(y, m) : Math.min(Number(closeKey), lastDay(y, m));

  let endYear = year;
  let endMonth = month;
  if (closeKey !== 'end' && day > closeDay(year, month)) {
    endMonth += 1;
    if (endMonth > 12) {
      endMonth = 1;
      endYear += 1;
    }
  }
  const endDay = closeDay(endYear, endMonth);
  let startYear = endYear;
  let startMonth = endMonth - 1;
  if (startMonth < 1) {
    startMonth = 12;
    startYear -= 1;
  }
  const previous = closeDay(startYear, startMonth);
  const startDate = new Date(startYear, startMonth - 1, previous + 1);
  const endDate = new Date(endYear, endMonth - 1, endDay);
  return { start: isoFromDate(startDate), end: isoFromDate(endDate) };
}
