export function partyKey(value: string): string {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/㈱|（株）|\(株\)/g, '株式会社')
    .replace(/㈲|（有）|\(有\)/g, '有限会社');
}

export function sameParty(left: string, right: string): boolean {
  const a = partyKey(left);
  const b = partyKey(right);
  return Boolean(a) && a === b;
}

export function sameCode(left: string, right: string): boolean {
  const a = String(left || '').trim();
  const b = String(right || '').trim();
  if (!a || !b) return false;
  if (a === b) return true;
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) return Number(a) === Number(b);
  return false;
}
