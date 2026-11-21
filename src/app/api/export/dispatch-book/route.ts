import { connection } from 'next/server';
import { activeJobs, buildDispatchBook, buildInstructionBook, type ExportJob } from '@/lib/dispatch-export';
import { getDefaultCompanyId, supabase } from '@/lib/supabase';
import { formatJapaneseMonthDay, getRokuyo, getWeekday } from '@/lib/crane-utils';

function asJob(row: Record<string, unknown>): ExportJob {
  return {
    work_date: String(row.work_date || ''),
    customer_name: String(row.customer_name || ''),
    site_name: String(row.site_name || ''),
    site_address: String(row.site_address || ''),
    requested_model: String(row.requested_model || ''),
    assigned_product: String(row.assigned_product || ''),
    operator_name: String(row.operator_name || ''),
    supplier_name: String(row.supplier_name || ''),
    entry_time: String(row.entry_time || ''),
    start_time: String(row.start_time || ''),
    end_time: String(row.end_time || ''),
    work_hours: row.work_hours == null || row.work_hours === '' ? null : Number(row.work_hours),
    work_location: String(row.work_location || ''),
    prime_contractor: String(row.prime_contractor || ''),
    contact_name: String(row.contact_name || ''),
    contact_tel: String(row.contact_tel || ''),
    notes: String(row.notes || ''),
    is_cancelled: Boolean(row.is_cancelled),
  };
}

export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const date = url.searchParams.get('date') || '';
  const kind = url.searchParams.get('kind') || 'board';
  const id = url.searchParams.get('id') || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: '日付が不正です' }, { status: 400 });
  }
  if (kind !== 'board' && kind !== 'instruction') {
    return Response.json({ error: '出力の種類が不正です' }, { status: 400 });
  }

  const companyId = await getDefaultCompanyId();
  let query = supabase.from('dispatches').select('*').eq('company_id', companyId).eq('work_date', date);
  if (id) query = query.eq('id', id);
  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const jobs = ((data ?? []) as Record<string, unknown>[]).map(asJob);
  if (activeJobs(jobs).length === 0) {
    return Response.json({ error: 'この日の出力できる配車がありません' }, { status: 404 });
  }

  const label = `${formatJapaneseMonthDay(date)}（${getWeekday(date)}）${getRokuyo(date)}`;
  const buffer = kind === 'board' ? await buildDispatchBook(label, jobs) : await buildInstructionBook(label, jobs);
  const filename = kind === 'board' ? `配車表_${date}.xlsx` : `作業指示書_${date}.xlsx`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
