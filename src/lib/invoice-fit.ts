/** 文字数や桁が用紙の枠を超えるときに出す。金額は切り詰めない（誤った請求になるため） */
export class InvoiceFitError extends Error {}

export function fitText(value: string, maxChars: number): string {
  const text = String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/[ \t\u3000]+/g, ' ')
    .trim();
  if (maxChars <= 0 || [...text].length <= maxChars) return text;
  return `${[...text].slice(0, Math.max(0, maxChars - 1)).join('')}…`;
}

export function fitMoney(value: number, maxDigits: number, label: string): number {
  const rounded = Math.round(Number(value) || 0);
  const digits = String(Math.abs(rounded)).length;
  if (maxDigits > 0 && digits > maxDigits) {
    throw new InvoiceFitError(`${label}が${maxDigits}桁を超えるため、用紙の枠に収まりません`);
  }
  return rounded;
}

/** 請求金額の表記。例: ¥33,000- */
export function yenText(value: number): string {
  const rounded = Math.round(Number(value) || 0);
  const sign = rounded < 0 ? '-' : '';
  const digits = String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}¥${digits}-`;
}

/** 消費税は税抜合計の10%を切り捨てる */
export function taxOf(net: number): number {
  return Math.floor(net * 0.1);
}

export function excelSerial(iso: string): number {
  const match = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) throw new InvoiceFitError('日付が不正です');
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const epoch = Date.UTC(1899, 11, 30);
  return Math.round((utc - epoch) / 86400000);
}

export function shortDate(iso: string): string {
  const match = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return fitText(iso, 6);
  return `${Number(match[2])}/${Number(match[3])}`;
}
