import { supabase } from '@/lib/supabase';

export async function nextMasterCode(
  table: string,
  companyId: string,
  match?: Record<string, string>
): Promise<string> {
  let max = 0;
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let request = supabase.from(table).select('code').eq('company_id', companyId);
    if (match) request = request.match(match);
    const { data, error } = await request.range(from, from + pageSize - 1);
    if (error) throw error;
    for (const row of data ?? []) {
      const number = parseInt(String(row.code ?? '').replace(/[^\d]/g, ''), 10);
      if (!Number.isNaN(number) && number > max) max = number;
    }
    if (!data || data.length < pageSize) break;
  }
  if (match?.category1 === '付帯' && max < 900000) max = 900000;
  return String(max + 1);
}
