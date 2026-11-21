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