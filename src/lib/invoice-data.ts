import { getDefaultCompanyId, supabase } from '@/lib/supabase';
import type { InvoiceDraft, InvoiceLine, InvoiceTemplate } from '@/lib/invoice-templates';
import { finitePrice, rememberedUnitPrices, resolveBasePrice } from '@/lib/sales-price';

type JobRow = {
  id: string;
  work_date: string;
  customer_code: string | null;
  customer_name: string | null;
  site_name: string | null;
  contact_name?: string | null;
  requested_model: string | null;
  unit_price: number | null;
  total_sales_amount: number | null;
  notes: string | null;
  is_cancelled: boolean | null;
  start_time: string | null;
  shift_type?: string | null;
};

type ExtraRow = { name: string; amount: number };

function sameCode(left: string, right: string) {
  if (left === right) return true;
  return /^\d+$/.test(left) && /^\d+$/.test(right) && Number(left) === Number(right);
}

function mailAddress(value: string) {
  const text = String(value || '').replace(/[\r\n\s]/g, '');
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(text) ? text : '';
}

function staffNameOf(jobs: JobRow[], fallback: string) {
  const counts = new Map<string, { n: number; date: string }>();
  for (const job of jobs) {
    const name = String(job.contact_name || '').replace(/様$/, '').trim();
    if (!name) continue;
    const current = counts.get(name) ?? { n: 0, date: '' };
    current.n += 1;
    if (job.work_date > current.date) current.date = job.work_date;
    counts.set(name, current);
  }
  const picked = [...counts.entries()].sort((a, b) => b[1].n - a[1].n || b[1].date.localeCompare(a[1].date))[0]?.[0];
  return picked || fallback.replace(/様$/, '').trim();
}

export async function loadInvoiceDraft(_template: InvoiceTemplate, code: string, start: string, end: string): Promise<InvoiceDraft> {
  const companyId = await getDefaultCompanyId();
  type CustomerRow = { code?: string | null; name?: string | null; sales_staff_name?: string | null };
  const withStaff = await supabase.from('customers').select('code, name, sales_staff_name').eq('company_id', companyId);
  let customerRows: CustomerRow[] = [];
  if (withStaff.error && /sales_staff_name/i.test(withStaff.error.message)) {
    const plain = await supabase.from('customers').select('code, name').eq('company_id', companyId);
    if (plain.error) throw new Error(plain.error.message);
    customerRows = plain.data ?? [];
  } else if (withStaff.error) {
    throw new Error(withStaff.error.message);
  } else {
    customerRows = withStaff.data ?? [];
  }
  const named = customerRows.find((row) => sameCode(String(row.code || ''), code));
  if (!named) throw new Error('得意先が見つかりません');

  let columns =
    'id, work_date, customer_code, customer_name, site_name, contact_name, requested_model, shift_type, unit_price, total_sales_amount, notes, is_cancelled, start_time';
  let jobsRes = await supabase
    .from('dispatches')
    .select(columns)
    .eq('company_id', companyId)
    .gte('work_date', start)
    .lte('work_date', end);
  if (jobsRes.error && /contact_name/i.test(jobsRes.error.message)) {
    columns = columns.replace(', contact_name', '');
    jobsRes = await supabase
      .from('dispatches')
      .select(columns)
      .eq('company_id', companyId)
      .gte('work_date', start)
      .lte('work_date', end);
  }
  if (jobsRes.error) throw new Error(jobsRes.error.message);
  const jobs = ((jobsRes.data ?? []) as unknown as JobRow[])
    .filter((job) => !job.is_cancelled && sameCode(String(job.customer_code || ''), code))
    .sort((a, b) => a.work_date.localeCompare(b.work_date) || String(a.start_time || '').localeCompare(String(b.start_time || '')));

  const modelRes = await supabase
    .from('machine_models')
    .select('name, standard_price_a, night_standard_price')
    .eq('company_id', companyId);
  const models = modelRes.error
    ? []
    : ((modelRes.data ?? []) as { name: string; standard_price_a: number | null; night_standard_price: number | null }[]);

  const extras = new Map<string, ExtraRow[]>();
  const ids = jobs.map((job) => job.id);
  for (let index = 0; index < ids.length; index += 100) {
    const slice = ids.slice(index, index + 100);
    if (slice.length === 0) continue;
    const extraRes = await supabase
      .from('dispatch_extras')
      .select('dispatch_id, item_name, quantity, unit_price, amount, sort_order')
      .in('dispatch_id', slice)
      .order('sort_order', { ascending: true });
    if (extraRes.error) break;
    for (const line of extraRes.data ?? []) {
      const quantity = Number(line.quantity ?? 1);
      const unitPrice = Number(line.unit_price ?? 0);
      const amount = line.amount != null ? Number(line.amount) : quantity * unitPrice;
      if (!amount && !line.item_name) continue;
      const id = String(line.dispatch_id);
      const list = extras.get(id) ?? [];
      list.push({ name: String(line.item_name || '付帯'), amount });
      extras.set(id, list);
    }
  }

  const remembered = await rememberedUnitPrices(
    companyId,
    jobs
      .filter((job) => finitePrice(job.unit_price) == null)
      .map((job) => ({
        customerCode: String(job.customer_code || ''),
        customerName: String(job.customer_name || ''),
        model: String(job.requested_model || ''),
        shift: String(job.shift_type || ''),
      }))
  );

  const lines: InvoiceLine[] = [];
  for (const job of jobs) {
    const extraLines = extras.get(job.id) ?? [];
    const extraTotal = extraLines.reduce((sum, line) => sum + line.amount, 0);
    const base = resolveBasePrice(job, extraTotal, models, remembered) ?? 0;
    lines.push({
      date: job.work_date,
      site: String(job.site_name || ''),
      machine: String(job.requested_model || ''),
      qty: null,
      price: null,
      amount: Math.round(base),
      note: String(job.notes || ''),
    });
    for (const extra of extraLines) {
      lines.push({
        date: job.work_date,
        site: '',
        machine: extra.name,
        qty: null,
        price: null,
        amount: Math.round(extra.amount),
        note: '',
      });
    }
  }

  const sites = [...new Set(jobs.map((job) => String(job.site_name || '').trim()).filter(Boolean))];
  const staffName = staffNameOf(jobs, String(named.sales_staff_name || ''));
  let staffEmail = '';
  const contactRes = await supabase
    .from('customer_contacts')
    .select('name, email, customer_code')
    .eq('company_id', companyId);
  if (!contactRes.error) {
    const wanted = staffName.replace(/様$/, '').trim();
    const people = (contactRes.data ?? []) as { name?: string | null; email?: string | null; customer_code?: string | null }[];
    const namedPeople = people.filter((person) => String(person.name || '').replace(/様$/, '').trim() === wanted);
    const forCustomer = namedPeople.filter((person) => sameCode(String(person.customer_code || ''), code));
    const picked = [...forCustomer, ...namedPeople].map((person) => mailAddress(String(person.email || ''))).find(Boolean);
    staffEmail = picked || '';
  }
  return {
    customerName: String(named.name || ''),
    issueDate: end,
    periodLabel: `${start}〜${end}`,
    projectName: sites.length === 1 ? sites[0] : sites.length > 1 ? '明細記載のとおり' : '',
    staffName,
    staffEmail,
    lines,
  };
}
