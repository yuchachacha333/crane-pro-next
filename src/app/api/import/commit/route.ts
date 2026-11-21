import { connection } from 'next/server';
import { IMPORT_CHUNK_SIZE, importOrder, parseMasterFile, type TableName } from '@/lib/master-import';
import { getDefaultCompanyId, supabase } from '@/lib/supabase';

const TABLE_LABEL: Record<TableName, string> = {
  customers: '取引先マスタ',
  sites: '現場マスタ',
  operators: 'オペレータマスタ',
  machine_models: '機種マスタ',
  products: '商品マスタ',
};

function isGrantError(message: string): boolean {
  return /permission denied|row-level security|row level security/i.test(message);
}

function isFatal(message: string): boolean {
  return isGrantError(message) || /schema cache|ON CONFLICT|unique or exclusion constraint/i.test(message);
}

export async function POST(request: Request) {
  await connection();
  const form = await request.formData();
  const file = form.get('file');
  const requested = String(form.get('tables') ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const order = importOrder(requested);

  if (!(file instanceof File)) {
    return Response.json({ error: 'ファイルがありません' }, { status: 400 });
  }
  if (order.length === 0) {
    return Response.json({ error: '取り込むマスタを1つ以上選んでください' }, { status: 400 });
  }

  let companyId = '';
  try {
    companyId = await getDefaultCompanyId();
  } catch (error) {
    const message = error instanceof Error ? error.message : '会社IDを取得できません';
    return Response.json({ needsGrant: true, error: message, results: [] }, { status: 403 });
  }

  let parsed;
  try {
    parsed = await parseMasterFile(file.name, await file.arrayBuffer());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ファイルを読み取れませんでした';
    return Response.json({ error: message }, { status: 400 });
  }

  const results: {
    table: TableName;
    label: string;
    saved: number;
    skippedNoCode: number;
    duplicateCodes: number;
    error?: string;
    needsGrant?: boolean;
  }[] = [];

  for (const table of order) {
    const sheet = parsed.sheets
      .filter((item) => item.table === table && !item.error)
      .sort((a, b) => b.importable - a.importable)[0];

    if (!sheet) {
      results.push({
        table,
        label: TABLE_LABEL[table],
        saved: 0,
        skippedNoCode: 0,
        duplicateCodes: 0,
        error: 'ファイル内に取り込めるシートがありません',
      });
      continue;
    }

    const payload = sheet.rows.map((row) => ({ ...row, company_id: companyId }));
    let saved = 0;
    let errorMessage = '';

    for (let index = 0; index < payload.length; index += IMPORT_CHUNK_SIZE) {
      const chunk = payload.slice(index, index + IMPORT_CHUNK_SIZE);
      const { data, error } = await supabase
        .from(table)
        .upsert(chunk, { onConflict: 'company_id,code' })
        .select('id');

      if (error) {
        errorMessage = error.message;
        if (isFatal(error.message)) break;
        continue;
      }
      saved += data?.length ?? chunk.length;
    }

    results.push({
      table,
      label: sheet.label,
      saved,
      skippedNoCode: sheet.skippedNoCode,
      duplicateCodes: sheet.duplicateCodes,
      error: errorMessage || undefined,
      needsGrant: errorMessage ? isGrantError(errorMessage) : undefined,
    });

    if (errorMessage && isGrantError(errorMessage)) break;
  }

  return Response.json({
    results,
    needsGrant: results.some((result) => result.needsGrant),
  });
}
