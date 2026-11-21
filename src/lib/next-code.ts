import { supabase } from '@/lib/supabase';

export async function nextMasterCode(table: string, companyId: string): Promise<string> {
  let max = 0;
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select('code')
      .eq('company_id', companyId)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    for (const row of data ?? []) {
      const number = parseInt(String(row.code ?? '').replace(/[^\d]/g, ''), 10);
      if (!Number.isNaN(number) && number > max) max = number;
    }
    if (!data || data.length < pageSize) break;
  }
  return String(max + 1);
}
