import { connection } from 'next/server';
import { InvoiceFitError } from '@/lib/invoice-fit';
import { loadInvoiceDraft } from '@/lib/invoice-data';
import { buildInvoiceXlsx } from '@/lib/invoice-excel';
import { invoiceTemplateFor } from '@/lib/invoice-templates';
import { layoutsFromXlsx } from '@/lib/sheet-layout';
import { getDefaultCompanyId, supabase } from '@/lib/supabase';

function sameCode(left: string, right: string) {
  if (left === right) return true;
  return /^\d+$/.test(left) && /^\d+$/.test(right) && Number(left) === Number(right);
}

export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const code = (url.searchParams.get('code') || '').trim();
  const start = url.searchParams.get('start') || '';
  const end = url.searchParams.get('end') || '';
  if (!code || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return Response.json({ error: '得意先と対象期間を指定してください' }, { status: 400 });
  }

  try {
    const companyId = await getDefaultCompanyId();
    const customerRes = await supabase.from('customers').select('code, name').eq('company_id', companyId);
    if (customerRes.error) return Response.json({ error: customerRes.error.message }, { status: 500 });
    const customer = (customerRes.data ?? []).find((row) => sameCode(String(row.code || ''), code));
    if (!customer) return Response.json({ error: '得意先が見つかりません' }, { status: 404 });
    const template = invoiceTemplateFor(String(customer.name || ''), code);
    if (!template) return Response.json({ error: 'この得意先の指定用紙はありません' }, { status: 404 });

    const draft = await loadInvoiceDraft(template, code, start, end);
    if (draft.lines.length === 0) {
      return Response.json({ error: 'この期間の配車がありません' }, { status: 404 });
    }
    const xlsx = await buildInvoiceXlsx(template, draft);
    const { cells, lines } = template;
    const money: string[] = [];
    if (lines.columns.amount) {
      for (let index = 0; index < lines.pageSize; index += 1) {
        money.push(`${lines.columns.amount.column}${lines.startRow + index}`);
      }
    }
    for (const cell of [cells.net, cells.tax, cells.gross]) if (cell) money.push(cell.cell);
    const layouts = await layoutsFromXlsx(xlsx, template.fileName, {
      money,
      date: cells.issueDate ? { cell: cells.issueDate.cell, iso: draft.issueDate } : undefined,
    });
    return Response.json(
      {
        layouts,
        staff: draft.staffName,
        email: draft.staffEmail,
        // Excelの入った端末では、このExcelをそのままPDFにする
        xlsx: Buffer.from(xlsx).toString('base64'),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : '請求書を作れませんでした';
    const status = error instanceof InvoiceFitError ? 400 : 500;
    return Response.json({ error: message }, { status });
  }
}
