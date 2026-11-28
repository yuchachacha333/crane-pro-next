import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// 初期の自社ID（山科重機工業有限会社）を取得・保持するヘルパー
let cachedCompanyId: string | null = null;

export async function getDefaultCompanyId(): Promise<string> {
  if (cachedCompanyId) return cachedCompanyId;
  const { data, error } = await supabase
    .from('companies')
    .select('id')
    .limit(1)
    .single();

  if (error || !data) {
    const detail = error?.message ? `（${error.message}）` : '';
    throw new Error(
      `会社マスタ（companies）を読み込めません${detail}。SupabaseのSQLエディタで supabase/enable_master_access.sql を実行してください。`
    );
  }
  cachedCompanyId = data.id;
  return data.id;
}

/** 自社のIDと名称。名称が読めないときは、このアプリの初期会社である山科重機工業有限会社とする。 */
export async function getDefaultCompany(): Promise<{ id: string; name: string }> {
  const id = await getDefaultCompanyId();
  const fallback = '山科重機工業有限会社';
  const { data, error } = await supabase.from('companies').select('*').eq('id', id).maybeSingle();
  if (error || !data) return { id, name: fallback };
  const row = data as Record<string, unknown>;
  for (const key of ['name', 'company_name', 'official_name', 'name1']) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return { id, name: value.trim() };
  }
  const named = Object.values(row).find((value) => typeof value === 'string' && value.includes('山科重機'));
  return { id, name: typeof named === 'string' ? named.trim() : fallback };
}