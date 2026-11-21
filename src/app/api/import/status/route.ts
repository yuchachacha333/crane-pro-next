import fs from 'fs';
import path from 'path';
import { connection } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  await connection();
  const { error } = await supabase.from('companies').select('id').limit(1);
  if (!error) return Response.json({ ok: true });

  let sql = '';
  try {
    sql = fs.readFileSync(path.join(process.cwd(), 'supabase', 'enable_master_access.sql'), 'utf8');
  } catch {
    sql = '';
  }

  return Response.json({
    ok: false,
    message: error.message,
    sql,
  });
}
