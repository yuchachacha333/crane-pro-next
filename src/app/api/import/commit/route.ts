import fs from 'fs';
import path from 'path';
import { connection } from 'next/server';
import { IMPORT_CHUNK_SIZE, importOrder, parseMasterFile, type TableName } from '@/lib/master-import';
import { getDefaultCompanyId, supabase } from '@/lib/supabase';

const TABLE_LABEL: Record<TableName, string> = {
  customers: '取引先マスタ',
  sites: '現場マスタ',
  operators: 'オペレータマスタ',
  machine_models: '機種マスタ',
  products: '商品マスタ',
  customer_contacts: '担当者マスタ',
};

function isGrantError(message: string): boolean {
  return /permission denied|row-level security|row level security/i.test(message);
}

function isConflictError(message: string): boolean {
  return /ON CONFLICT|unique or exclusion constraint/i.test(message);
}

function isFatal(message: string): boolean {
  return isGrantError(message) || /schema cache/i.test(message) || isConflictError(message);
}

function explainError(table: TableName, message: string): string {
  if (isGrantError(message)) {
    return `${TABLE_LABEL[table]}は画面の一覧には出ますが、Supabase が書き込みを拒否しているためテーブルには入りません。下の SQL を SQL Editor で実行してから、もう一度取り込んでください。`;
  }
  if (isConflictError(message)) {
    return `${TABLE_LABEL[table]}を同じコードで更新する一意制約がなく、追加にも失敗しました。下の SQL を実行してから、もう一度取り込んでください。`;
  }
  return message;
}

function accessSql(): string {
  try {
    return fs.readFileSync(path.join(process.cwd(), 'supabase', 'enable_master_access.sql'), 'utf8');
  } catch {
    return '';
  }
}

function rowLabel(row: Record<string, unknown>): string {
  const code = typeof row.code === 'string' ? row.code : '';
  const name = typeof row.name === 'string' ? row.name : '';
  return [code, name].filter(Boolean).join(' ') || '行';
}

async function saveRows(
  table: TableName,
  rows: Record<string, unknown>[]
): Promise<{ saved: number; errors: string[]; fatal: boolean }> {
  if (rows.length === 0) return { saved: 0, errors: [], fatal: false };

  const upserted = await supabase.from(table).upsert(rows, { onConflict: 'company_id,code' }).select('id');
  let error = upserted.error;
  let data = upserted.data;

  if (error && isConflictError(error.message)) {
    const inserted = await supabase.from(table).insert(rows).select('id');
    error = inserted.error;
    data = inserted.data;
  }

  if (!error) return { saved: data?.length ?? rows.length, errors: [], fatal: false };

  if (isFatal(error.message) || rows.length === 1) {
    const prefix = rows.length === 1 ? `${rowLabel(rows[0])}: ` : '';
    return { saved: 0, errors: [`${prefix}${error.message}`], fatal: isFatal(error.message) };
  }

  const mid = Math.floor(rows.length / 2);
  const left = await saveRows(table, rows.slice(0, mid));
  if (left.fatal) return left;
  const right = await saveRows(table, rows.slice(mid));
  return {
    saved: left.saved + right.saved,
    errors: [...left.errors, ...right.errors].slice(0, 8),
    fatal: right.fatal,
  };
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
    skippedNoName: number;
    duplicateCodes: number;
    warnings: string[];
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
        skippedNoName: 0,
        duplicateCodes: 0,
        warnings: [],
        error: 'ファイル内に取り込めるシートがありません',
      });
      continue;
    }

    const payload = sheet.rows.map((row) => ({ ...row, company_id: companyId }));
    let saved = 0;
    const errors: string[] = [];
    let fatal = false;

    for (let index = 0; index < payload.length; index += IMPORT_CHUNK_SIZE) {
      const chunk = payload.slice(index, index + IMPORT_CHUNK_SIZE);
      const outcome = await saveRows(table, chunk);
      saved += outcome.saved;
      errors.push(...outcome.errors);
      if (outcome.fatal) {
        fatal = true;
        break;
      }
    }

    const errorMessage = errors[0] ?? '';
    const needsGrant = fatal && isGrantError(errorMessage);
    results.push({
      table,
      label: sheet.label,
      saved,
      skippedNoCode: sheet.skippedNoCode,
      skippedNoName: sheet.skippedNoName,
      duplicateCodes: sheet.duplicateCodes,
      warnings: sheet.warnings,
      error: errorMessage ? explainError(table, errorMessage) : undefined,
      needsGrant,
    });

    if (fatal && isGrantError(errorMessage)) break;
  }

  const needsGrant = results.some((result) => result.needsGrant);
  return Response.json({
    results,
    needsGrant,
    error: needsGrant ? results.find((result) => result.needsGrant)?.error : undefined,
    sql: needsGrant ? accessSql() : undefined,
  });
}
