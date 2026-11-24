'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil } from 'lucide-react';
import AppSidebar from '@/components/app-sidebar';
import InvoicePreview from '@/components/invoice-preview';
import { billingPeriod, closeKeyOf, closeLabel } from '@/lib/billing';
import { formatJapaneseMonthDay, getTodayIso } from '@/lib/crane-utils';
import { isSumitomoCustomer, type InvoiceLine, type SumitomoLine } from '@/lib/invoice-sheet';
import { invoiceTemplateFor } from '@/lib/invoice-templates';
import { getDefaultCompanyId, supabase } from '@/lib/supabase';

type Customer = {
  code: string;
  name: string;
  closing_day: number | string | null;
  postal_code: string | null;
  address1: string | null;
  address2: string | null;
};
type Job = {
  id: string;
  work_date: string;
  customer_code: string | null;
  customer_name: string | null;
  site_name: string | null;
  client_job_code?: string | null;
  contact_name?: string | null;
  requested_model: string | null;
  operator_name: string | null;
  supplier_name: string | null;
  unit_price: number | null;
  total_sales_amount: number | null;
  notes: string | null;
  is_cancelled: boolean | null;
  start_time: string | null;
  end_time: string | null;
  work_hours: number | null;
  shift_type?: string | null;
};

type ExtraRow = { name: string; quantity: number; unit: string; unit_price: number; amount: number };
type BillJob = Job & { amount: number; missing: boolean; base: number | null; extraLines: ExtraRow[]; extraTotal: number };
type SiteGroup = { name: string; jobCode: string; amount: number; jobs: BillJob[] };
type Group = {
  code: string;
  name: string;
  address: string;
  jobs: BillJob[];
  sites: SiteGroup[];
  amount: number;
  missing: number;
};

function money(value: number): string {
  return `¥${Math.round(value).toLocaleString('ja-JP')}`;
}

const MAIL_RULE = '▲'.repeat(23);

function siteLabelOf(group: Group) {
  const names = [...new Set(group.sites.map((site) => site.name.trim()).filter((name) => name && name !== '現場未入力'))];
  return names.length ? names.join('、') : '現場';
}

function invoicePdfName(site: string, month: number) {
  const safe = site.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim() || '現場';
  return `【${safe}】 ${month}月分請求書.pdf`;
}

function satsumaMail(person: string, site: string, month: number) {
  const name = person.replace(/様$/, '').trim() || 'ご担当者';
  return {
    subject: `${month}月分請求書　山科重機工業`,
    body: [
      '薩摩建設株式会社',
      `${name}様`,
      '',
      'いつも大変お世話になっております。',
      `${site}の${month}月分請求書を添付させていただきます。`,
      'ご確認の程よろしくお願いいたします。',
      '',
      MAIL_RULE,
      '〒273-0112　千葉県鎌ケ谷市東中沢3-3-73',
      '山科重機工業有限会社',
      'E-mail   yamashina@cr-yjk.jp',
      'TEL 047-446-6549   FAX 047-498-9461',
      MAIL_RULE,
    ].join('\r\n'),
    fileName: invoicePdfName(site, month),
  };
}

// 売上合計(total_sales_amount)は「基本＋付帯」で保存されるため、付帯を二重に足さない。
// 基本は売上単価を優先し、無ければ合計から付帯を引いて求める。
function machineUnit(
  models: { name: string; unit_name?: string | null }[],
  modelName: string | null | undefined
) {
  const name = String(modelName || '').trim();
  const model = models.find((item) => String(item.name || '').trim() === name);
  return String(model?.unit_name || '').trim() || '式';
}

function standardPrice(
  models: { name: string; standard_price_a: number | null; night_standard_price: number | null }[],
  modelName: string | null | undefined,
  shift: string | null | undefined
) {
  const name = String(modelName || '').trim();
  if (!name) return null;
  const model = models.find((item) => String(item.name || '').trim() === name);
  if (!model) return null;
  const night = String(shift || '').includes('夜');
  const nightPrice = Number(model.night_standard_price);
  const dayPrice = Number(model.standard_price_a);
  if (night && Number.isFinite(nightPrice) && nightPrice > 0) return nightPrice;
  if (Number.isFinite(dayPrice) && dayPrice > 0) return dayPrice;
  return null;
}

function priced(job: Job, extra: number, standard: number | null = null) {
  let base: number | null = null;
  if (job.unit_price != null && Number.isFinite(Number(job.unit_price))) base = Number(job.unit_price);
  else if (standard != null) base = standard;
  else if (job.total_sales_amount != null && Number.isFinite(Number(job.total_sales_amount))) {
    base = Number(job.total_sales_amount) - extra;
  }
  return { base, amount: (base ?? 0) + extra, missing: base == null && !extra };
}

function timeRange(job: Job): string {
  const start = (job.start_time || '').trim();
  const end = (job.end_time || '').trim();
  return start || end ? `${start || '—'}〜${end || '—'}` : '—';
}

export default function BillingClient() {
  const [companyId, setCompanyId] = useState('');
  const [anchor, setAnchor] = useState('');
  const [close, setClose] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [contactNames, setContactNames] = useState<Record<string, string[]>>({});
  const [models, setModels] = useState<
    { name: string; standard_price_a: number | null; night_standard_price: number | null; unit_name?: string | null }[]
  >([]);
  const [extraUnits, setExtraUnits] = useState<Record<string, string>>({});
  const [jobs, setJobs] = useState<Job[]>([]);
  const [extras, setExtras] = useState<Record<string, ExtraRow[]>>({});
  const [detail, setDetail] = useState<{ code: string; mode: 'flat' | 'site' } | null>(null);
  const [invoice, setInvoice] = useState<{
    name: string;
    postal: string;
    address: string;
    lines: InvoiceLine[];
    sumitomo?: { contact: string; quoteNo: string; jobCode: string; lines: SumitomoLine[] };
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [pdfMode, setPdfMode] = useState<'print' | 'mail' | null>(null);
  const [printUrl, setPrintUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [gmailHref, setGmailHref] = useState('');
  const [error, setError] = useState('');
  const [helperMissing, setHelperMissing] = useState(false);
  const pdfLock = useRef(false);

  // 訂正処理から戻ってきた時は、同じ基準日・締め・得意先ページを開く
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const a = params.get('anchor') || '';
    setAnchor(/^\d{4}-\d{2}-\d{2}$/.test(a) ? a : getTodayIso());
    const c = params.get('close') || '';
    if (c) setClose(c);
    const code = params.get('code');
    if (code != null && params.has('code')) setDetail({ code, mode: params.get('mode') === 'site' ? 'site' : 'flat' });
  }, []);

  useEffect(() => {
    let cancelled = false;
    getDefaultCompanyId()
      .then(async (id) => {
        if (cancelled) return;
        setCompanyId(id);
        const { data, error: queryError } = await supabase
          .from('customers')
          .select('code, name, closing_day, postal_code, address1, address2')
          .eq('company_id', id);
        if (cancelled) return;
        if (queryError) setError(queryError.message);
        else setCustomers((data ?? []) as Customer[]);
        const contactRes = await supabase
          .from('customer_contacts')
          .select('customer_code, name')
          .eq('company_id', id);
        if (!cancelled && !contactRes.error) {
          const byCustomer: Record<string, string[]> = {};
          for (const row of contactRes.data ?? []) {
            const code = String(row.customer_code || '').trim();
            const name = String(row.name || '').replace(/様$/, '').trim();
            if (code && name) (byCustomer[code] ??= []).push(name);
          }
          setContactNames(byCustomer);
        }
        const modelRes = await supabase
          .from('machine_models')
          .select('name, standard_price_a, night_standard_price, unit_name')
          .eq('company_id', id);
        const modelRows = modelRes.error && /unit_name/i.test(modelRes.error.message)
          ? (
              await supabase
                .from('machine_models')
                .select('name, standard_price_a, night_standard_price')
                .eq('company_id', id)
            ).data
          : modelRes.data;
        if (!cancelled && modelRows) setModels(modelRows);
        const extraRes = await supabase
          .from('products')
          .select('name, unit_name')
          .eq('company_id', id)
          .eq('category1', '付帯');
        if (!cancelled && !extraRes.error) {
          const units: Record<string, string> = {};
          for (const row of extraRes.data ?? []) {
            const unit = String(row.unit_name || '').trim();
            if (row.name && unit) units[String(row.name)] = unit;
          }
          setExtraUnits(units);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || '会社マスタを読み込めません');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const closes = useMemo(() => {
    const seen = new Set<string>();
    for (const customer of customers) {
      const key = closeKeyOf(customer.closing_day);
      if (key) seen.add(key);
    }
    return [...seen].sort((a, b) => {
      if (a === 'end') return 1;
      if (b === 'end') return -1;
      return Number(a) - Number(b);
    });
  }, [customers]);

  useEffect(() => {
    if (close || !closes.length) return;
    // 今日の日付にいちばん近い締め日を初期表示にする
    const now = new Date();
    const today = now.getDate();
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOf = (key: string) => (key === 'end' ? monthEnd : Number(key));
    const nearest = [...closes].sort((x, y) => Math.abs(dayOf(x) - today) - Math.abs(dayOf(y) - today))[0];
    setClose(nearest);
  }, [close, closes]);

  const period = anchor && close ? billingPeriod(close, anchor) : null;

  useEffect(() => {
    if (!companyId || !anchor || !close) return;
    const nextPeriod = billingPeriod(close, anchor);
    if (!nextPeriod) return;
    let cancelled = false;
    setLoading(true);
    const columns =
      'id, work_date, customer_code, customer_name, site_name, client_job_code, contact_name, requested_model, shift_type, operator_name, supplier_name, unit_price, total_sales_amount, notes, is_cancelled, start_time, end_time, work_hours';
    const loadJobs = (fields: string) =>
      supabase
        .from('dispatches')
        .select(fields)
        .eq('company_id', companyId)
        .gte('work_date', nextPeriod.start)
        .lte('work_date', nextPeriod.end);
    loadJobs(columns).then(async (first) => {
      let result = first;
      let fields = columns;
      if (result.error && /client_job_code/i.test(result.error.message)) {
        fields = fields.replace(', client_job_code', '');
        result = await loadJobs(fields);
      }
      if (result.error && /contact_name/i.test(result.error.message)) {
        fields = fields.replace(', contact_name', '');
        result = await loadJobs(fields);
      }
      const { data, error: queryError } = result;
        if (cancelled) return;
        if (queryError) {
          setLoading(false);
          setJobs([]);
          setExtras({});
          setError(queryError.message);
          return;
        }
        const rows = (data ?? []) as unknown as Job[];
        const extraMap: Record<string, ExtraRow[]> = {};
        const ids = rows.map((row) => row.id);
        for (let index = 0; index < ids.length; index += 100) {
          const slice = ids.slice(index, index + 100);
          const extraRes = await supabase
            .from('dispatch_extras')
            .select('dispatch_id, item_name, quantity, unit, unit_price, amount, sort_order')
            .in('dispatch_id', slice)
            .order('sort_order', { ascending: true });
          for (const line of extraRes.data ?? []) {
            const id = String(line.dispatch_id);
            const quantity = Number(line.quantity ?? 1);
            const unitPrice = Number(line.unit_price ?? 0);
            const amount = line.amount != null ? Number(line.amount) : quantity * unitPrice;
            if (!amount && !line.item_name) continue;
            (extraMap[id] ??= []).push({
              name: String(line.item_name || '付帯'),
              quantity,
              unit: String(line.unit || ''),
              unit_price: unitPrice,
              amount,
            });
          }
        }
        if (cancelled) return;
        setError('');
        setJobs(rows);
        setExtras(extraMap);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, anchor, close]);

  const closeByCode = useMemo(() => {
    const map = new Map<string, string>();
    for (const customer of customers) map.set(customer.code, closeKeyOf(customer.closing_day));
    return map;
  }, [customers]);

  const nameByCode = useMemo(() => {
    const map = new Map<string, string>();
    for (const customer of customers) map.set(customer.code, customer.name);
    return map;
  }, [customers]);

  const addressByCode = useMemo(() => {
    const map = new Map<string, string>();
    for (const customer of customers) {
      map.set(customer.code, [customer.address1, customer.address2].filter(Boolean).join(' '));
    }
    return map;
  }, [customers]);

  const { groups, skipped } = useMemo(() => {
    const bucket = new Map<string, Group>();
    let skippedCount = 0;
    for (const job of jobs) {
      if (job.is_cancelled) continue;
      const code = (job.customer_code || '').trim();
      const key = code ? closeByCode.get(code) || '' : '';
      if (key !== close) {
        skippedCount += 1;
        continue;
      }
      const extraLines = extras[job.id] ?? [];
      const extraTotal = extraLines.reduce((sum, line) => sum + line.amount, 0);
      const price = priced(job, extraTotal, standardPrice(models, job.requested_model, job.shift_type));
      const current = bucket.get(code) ?? {
        code,
        name: nameByCode.get(code) || job.customer_name || code,
        address: addressByCode.get(code) || '',
        jobs: [],
        sites: [],
        amount: 0,
        missing: 0,
      };
      current.jobs.push({ ...job, amount: price.amount, missing: price.missing, base: price.base, extraLines, extraTotal });
      current.amount += price.amount;
      if (price.missing) current.missing += 1;
      bucket.set(code, current);
    }
    const list = [...bucket.values()].map((group) => {
      const byJobCode = isSumitomoCustomer(group.code);
      const sites = new Map<string, SiteGroup>();
      group.jobs.sort((a, b) => a.work_date.localeCompare(b.work_date) || (a.start_time || '').localeCompare(b.start_time || ''));
      for (const job of group.jobs) {
        const jobCode = String(job.client_job_code || '').trim();
        const name = job.site_name || '現場未入力';
        const key = byJobCode ? jobCode || `未入力:${name}` : name;
        const site = sites.get(key) ?? { name, jobCode: byJobCode ? jobCode : '', amount: 0, jobs: [] };
        if (byJobCode && name && !site.name.split('、').includes(name)) {
          site.name = site.jobs.length ? `${site.name}、${name}` : name;
        }
        site.jobs.push(job);
        site.amount += job.amount;
        sites.set(key, site);
      }
      group.sites = [...sites.values()].sort((a, b) => (a.jobCode || a.name).localeCompare(b.jobCode || b.name, 'ja'));
      group.jobs.sort((a, b) => a.work_date.localeCompare(b.work_date) || (a.site_name || '').localeCompare(b.site_name || '', 'ja'));
      return group;
    });
    list.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    return { groups: list, skipped: skippedCount };
  }, [jobs, extras, close, closeByCode, nameByCode, addressByCode, models]);

  const total = groups.reduce((sum, group) => sum + group.amount, 0);
  const selected = detail ? groups.find((group) => group.code === detail.code) : undefined;

  function amountLabel(group: { amount: number; missing: number }) {
    const text = group.missing && !group.amount ? '単価未入力' : money(group.amount);
    return group.missing && group.amount ? `${text}（未入力 ${group.missing}件）` : text;
  }

  function unitOfExtra(line: ExtraRow) {
    return line.unit || extraUnits[line.name] || '';
  }

  function helperMissingError() {
    const error = new Error('このパソコンで請求PDFの受付が動いていません。下のプログラムを保存して解凍し、start-invoice-pdf.cmd を開いたまま、もう一度押してください。Excelが必要です。');
    error.name = 'HelperMissingError';
    return error;
  }

  async function loadTemplateWorkbook(group: Group) {
    if (!period) throw new Error('対象期間がありません');
    const params = new URLSearchParams({ code: group.code, start: period.start, end: period.end });
    const response = await fetch(`/api/invoices/xlsx?${params}`);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error || '請求書を作れませんでした');
    }
    return {
      workbook: await response.blob(),
      staff: decodeURIComponent(response.headers.get('X-Invoice-Staff') || ''),
      email: decodeURIComponent(response.headers.get('X-Invoice-Email') || ''),
    };
  }

  async function convertWorkbook(workbook: Blob) {
    let pdfResponse: Response;
    try {
      pdfResponse = await fetch('http://127.0.0.1:3100/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
        body: workbook,
        signal: AbortSignal.timeout(60000),
      });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new Error('Excelが応答しませんでした。受付の窓を一度閉じて start-invoice-pdf.cmd を開き直してから、もう一度押してください。');
      }
      throw helperMissingError();
    }
    if (!pdfResponse.ok) throw new Error((await pdfResponse.text()) || 'PDFを作れませんでした');
    return pdfResponse.blob();
  }

  function closePrintPreview() {
    setPrintUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
  }

  function printPreview() {
    if (!printUrl) return;
    const popup = window.open(printUrl, 'satsuma-print');
    if (!popup) {
      setError('印刷画面を開けませんでした。ブラウザのポップアップを許可してください。');
      return;
    }
    window.setTimeout(() => {
      popup.focus();
      popup.print();
    }, 700);
  }

  async function printTemplate(group: Group) {
    if (!period || pdfLock.current) return;
    pdfLock.current = true;
    setPdfMode('print');
    setError('');
    setNotice('');
    setHelperMissing(false);
    setGmailHref('');
    try {
      const { workbook } = await loadTemplateWorkbook(group);
      const pdf = await convertWorkbook(workbook);
      const month = Number(period.end.slice(5, 7));
      const file = new File([pdf], invoicePdfName(siteLabelOf(group), month), { type: 'application/pdf' });
      const url = URL.createObjectURL(file);
      setPrintUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return url;
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'HelperMissingError') setHelperMissing(true);
      setError(err instanceof Error ? err.message : 'PDFを作れませんでした');
    } finally {
      pdfLock.current = false;
      setPdfMode(null);
    }
  }

  async function mailTemplate(group: Group) {
    if (!period || pdfLock.current) return;
    const popup = window.open('about:blank', '_blank');
    pdfLock.current = true;
    setPdfMode('mail');
    setError('');
    setNotice('');
    setHelperMissing(false);
    setGmailHref('');
    try {
      const { workbook, staff, email } = await loadTemplateWorkbook(group);
      const pdf = await convertWorkbook(workbook);
      const month = Number(period.end.slice(5, 7));
      const mail = satsumaMail(staff, siteLabelOf(group), month);
      const gmail = new URL('https://mail.google.com/mail/');
      gmail.searchParams.set('view', 'cm');
      gmail.searchParams.set('fs', '1');
      gmail.searchParams.set('tf', '1');
      if (email) gmail.searchParams.set('to', email);
      gmail.searchParams.set('su', mail.subject);
      gmail.searchParams.set('body', mail.body);
      const href = gmail.toString();
      const opened = Boolean(popup && !popup.closed);
      if (opened && popup) popup.location.href = href;
      setGmailHref(href);
      const url = URL.createObjectURL(pdf);
      const link = document.createElement('a');
      link.href = url;
      link.download = mail.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      setNotice(
        opened
          ? 'Gmailを開きました。保存されたPDFを、そのメールに添付してから送信してください。'
          : 'PDFを保存しました。下のリンクからGmailを開き、そのPDFを添付してから送信してください。'
      );
    } catch (err) {
      popup?.close();
      if (err instanceof Error && err.name === 'HelperMissingError') setHelperMissing(true);
      setError(err instanceof Error ? err.message : 'メールを開けませんでした');
    } finally {
      pdfLock.current = false;
      setPdfMode(null);
    }
  }

  function openInvoice(group: Group) {
    const party = customers.find((customer) => customer.code === group.code);
    const lines: InvoiceLine[] = group.jobs.flatMap((job) => {
      const parts = String(job.work_date || '').match(/^\d{4}-(\d{2})-(\d{2})/);
      const shown = parts ? `${Number(parts[1])}/${Number(parts[2])}` : job.work_date;
      const code = String(job.client_job_code || '').trim();
      const site = code ? `${job.site_name || '現場未入力'}\n${code}` : job.site_name || '現場未入力';
      const unpriced = job.base == null;
      const main: InvoiceLine = {
        date: shown,
        machine: job.requested_model || '',
        site,
        no: '',
        detail: '',
        qty: unpriced ? '' : 1,
        price: unpriced ? '' : job.base ?? '',
        amount: unpriced ? '' : job.base ?? '',
        note: [job.notes || '', unpriced ? '単価未入力' : ''].filter(Boolean).join(' '),
        start: shown,
        end: shown,
      };
      // 付帯は合算せず、1項目ずつ別の行にする
      const extraRows: InvoiceLine[] = job.extraLines.map((line) => ({
        date: shown,
        machine: line.name,
        site,
        no: '',
        detail: '',
        qty: line.quantity,
        price: line.unit_price,
        amount: line.amount,
        note: unitOfExtra(line) ? `単位: ${unitOfExtra(line)}` : '',
        start: shown,
        end: shown,
      }));
      return [main, ...extraRows];
    });
    setInvoice({
      name: group.name,
      postal: party?.postal_code || '',
      address: [party?.address1, party?.address2].filter(Boolean).join(' '),
      lines,
    });
  }

  function shownDay(value: string) {
    const parts = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return parts ? `${parts[1]}/${parts[2]}/${parts[3]}` : value;
  }

  function postalOf(value: string | null | undefined) {
    const text = String(value || '').trim();
    if (!text) return '';
    return text.startsWith('〒') ? text : `〒${text}`;
  }

  function pickContact(jobs: BillJob[]) {
    const counts = new Map<string, { n: number; date: string }>();
    for (const job of jobs) {
      const name = String(job.contact_name || '').replace(/様$/, '').trim();
      if (!name) continue;
      const current = counts.get(name) ?? { n: 0, date: '' };
      current.n += 1;
      if (job.work_date > current.date) current.date = job.work_date;
      counts.set(name, current);
    }
    return [...counts.entries()].sort((a, b) => b[1].n - a[1].n || b[1].date.localeCompare(a[1].date))[0]?.[0] || '';
  }

  function openSumitomo(group: Group, site: SiteGroup, index: number) {
    const party = customers.find((customer) => customer.code === group.code);
    const month = (anchor || '').slice(0, 7).replace('-', '');
    const lines: SumitomoLine[] = site.jobs.flatMap((job) => {
      const unpriced = job.base == null;
      const main: SumitomoLine = {
        machine: job.requested_model || '',
        date: shownDay(job.work_date),
        site: job.site_name || '',
        qty: unpriced ? '' : 1,
        unit: unpriced ? '' : machineUnit(models, job.requested_model),
        price: unpriced ? '' : job.base ?? '',
        amount: unpriced ? '' : job.base ?? '',
        note: unpriced ? '単価未入力' : '',
      };
      const extras: SumitomoLine[] = job.extraLines.map((line) => ({
        machine: line.name,
        date: '',
        site: '',
        qty: line.quantity,
        unit: unitOfExtra(line),
        price: line.unit_price,
        amount: line.amount,
        note: '',
      }));
      return [main, ...extras];
    });
    setInvoice({
      name: group.name,
      postal: postalOf(party?.postal_code),
      address: [party?.address1, party?.address2].filter(Boolean).join(' '),
      lines: [],
      sumitomo: {
        contact: pickContact(site.jobs) || (contactNames[group.code] || [])[0] || '',
        quoteNo: `${month}-${String(index + 1).padStart(2, '0')}`,
        jobCode: site.jobCode,
        lines,
      },
    });
  }

  // 請求明細の1件分（本体の行＋付帯売上の行）
  function siteHeading(site: SiteGroup) {
    if (site.jobCode) return `工事コード ${site.jobCode}　${site.name}`;
    if (isSumitomoCustomer(detail?.code || '')) return `工事コード未入力　${site.name}`;
    const codes = [...new Set(site.jobs.map((job) => String(job.client_job_code || '').trim()).filter(Boolean))];
    return codes.length ? `現場：${site.name}　${codes.join('、')}` : `現場：${site.name}`;
  }

  function jobRows(job: BillJob) {
    const hours = job.work_hours == null ? '—' : `${job.work_hours}`;
    const back = `/billing?anchor=${anchor}&close=${close}&code=${encodeURIComponent(detail?.code ?? '')}&mode=${detail?.mode ?? 'flat'}`;
    const fix = `/?job=${encodeURIComponent(job.id)}&date=${job.work_date}&tab=sales&back=${encodeURIComponent(back)}`;
    return [
      <tr key={job.id} className="border-t border-slate-200 align-middle">
        <td className="px-3 py-3 whitespace-nowrap font-black">{formatJapaneseMonthDay(job.work_date)}</td>
        <td className="px-3 py-3 font-bold">{job.requested_model || '機種未入力'}</td>
        <td className="px-3 py-3 whitespace-nowrap font-bold">{timeRange(job)}</td>
        <td className="px-3 py-3 text-right font-bold">1</td>
        <td className="px-3 py-3 font-bold">{machineUnit(models, job.requested_model)}</td>
        <td className="px-3 py-3 text-right font-bold">{hours}</td>
        <td className="px-3 py-3 text-right whitespace-nowrap font-bold">{job.base == null ? '未入力' : money(job.base)}</td>
        <td className="px-3 py-3 font-bold">
          <div>{job.site_name || '現場未入力'}</div>
          {job.client_job_code?.trim() ? <div className="text-[11px] font-black text-slate-500">{job.client_job_code}</div> : null}
        </td>
        <td className="px-3 py-3 text-right whitespace-nowrap font-black">{job.base == null ? '単価未入力' : money(job.base)}</td>
        <td className="sticky right-0 bg-white px-2 py-2 text-center shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.25)]">
          <a
            href={fix}
            title="訂正処理（配車の詳細・売上明細へ）"
            className="inline-flex min-w-16 flex-col items-center rounded-xl border-2 border-teal-700 px-2 py-1 text-teal-800"
          >
            <Pencil className="h-5 w-5" />
            <span className="text-[11px] font-black leading-tight">訂正処理</span>
          </a>
        </td>
      </tr>,
      ...job.extraLines.map((line, index) => (
        <tr key={`${job.id}-x${index}`} className="bg-amber-50 text-amber-950">
          <td className="px-3 py-1.5" />
          <td className="px-3 py-1.5 font-extrabold" colSpan={2}>
            └ 付帯売上　{line.name}
          </td>
          <td className="px-3 py-1.5 text-right font-bold">{line.quantity}</td>
          <td className="px-3 py-1.5 font-bold">{unitOfExtra(line)}</td>
          <td className="px-3 py-1.5" />
          <td className="px-3 py-1.5 text-right whitespace-nowrap font-bold">{money(line.unit_price)}</td>
          <td className="px-3 py-1.5" />
          <td className="px-3 py-1.5 text-right whitespace-nowrap font-bold">{money(line.amount)}</td>
          <td className="sticky right-0 bg-amber-50 px-2" />
        </tr>
      )),
    ];
  }

  const detailHead = ['作業日', '商品名', '時間帯（開始〜終了）', '数量', '単位', '時間', '売上単価', '現場名', '金額', '訂正'];

  return (
    <div className={`min-h-screen bg-slate-100 text-slate-900 flex flex-col md:flex-row ${invoice ? 'print:hidden' : ''}`}>
      <AppSidebar active="billing" />
      <main className="flex-1 min-w-0 p-4 md:p-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">請求・締め集計</h1>
            <p className="text-sm text-slate-500 mt-1">
              取引先の請求締日で期間を切り、キャンセルを除いた配車を得意先ごとに集めます。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="month"
              value={anchor.slice(0, 7)}
              onChange={(event) => event.target.value && setAnchor(`${event.target.value}-01`)}
              className="h-14 min-w-52 rounded-2xl border-2 border-slate-400 bg-white px-4 text-xl font-black text-black"
            />
            <select
              value={close}
              onChange={(event) => setClose(event.target.value)}
              className="h-14 min-w-44 rounded-2xl border-2 border-slate-400 bg-white px-4 text-xl font-black text-black"
            >
              {closes.map((key) => (
                <option key={key} value={key}>
                  {closeLabel(key)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {period && (
          <p className="mb-4 text-sm font-extrabold text-slate-700">
            対象期間 {formatJapaneseMonthDay(period.start)} 〜 {formatJapaneseMonthDay(period.end)}　
            {groups.length}社　合計 {money(total)}
          </p>
        )}
        {error && (
          <div className="mb-4 text-sm font-bold text-rose-700">
            <p>{error}</p>
            {helperMissing && (
              <a href="/api/invoices/helper" className="mt-2 inline-flex h-10 items-center rounded-lg bg-slate-900 px-3 text-white">
                受付プログラムをダウンロード
              </a>
            )}
          </div>
        )}
        {notice && (
          <p className="mb-4 text-sm font-bold text-teal-800">
            {notice}
            {gmailHref && (
              <>
                {' '}
                <a href={gmailHref} target="_blank" rel="noopener noreferrer" className="underline">
                  Gmailを開く
                </a>
              </>
            )}
          </p>
        )}
        {loading && <p className="text-sm font-bold text-slate-500">集計しています...</p>}

        {!loading && groups.length === 0 && (
          <section className="bg-white border border-slate-200 rounded-2xl p-6 text-sm font-bold text-slate-500">
            この締め期間に、締日が一致する配車はありません。配車ボードで入力した行が対象です。
          </section>
        )}

        {selected ? (
          <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-100">
              {isSumitomoCustomer(selected.code) ? (
                <p className="text-xs font-bold text-slate-600">先頭の「この工事の請求書」から、工事コードごとに印刷します。</p>
              ) : invoiceTemplateFor(selected.name, selected.code) ? (
                <>
                  <button
                    type="button"
                    disabled={pdfMode !== null}
                    onClick={() => printTemplate(selected)}
                    className="h-9 px-3 rounded-lg bg-slate-900 text-white text-sm font-extrabold disabled:opacity-60"
                  >
                    {pdfMode === 'print' ? '用紙を作成中' : '指定用紙を印刷'}
                  </button>
                  <button
                    type="button"
                    disabled={pdfMode !== null}
                    onClick={() => mailTemplate(selected)}
                    className="h-9 px-3 rounded-lg bg-teal-700 text-white text-sm font-extrabold disabled:opacity-60"
                  >
                    {pdfMode === 'mail' ? '請求書を作成しています' : '請求書をGmailで開く'}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => openInvoice(selected)}
                  className="h-9 px-3 rounded-lg bg-teal-700 text-white text-sm font-extrabold"
                >
                  請求書を印刷
                </button>
              )}
              <button type="button" onClick={() => setDetail(null)} className="h-9 px-3 rounded-lg border border-slate-300 text-sm font-extrabold">
                得意先一覧
              </button>
            </div>
            <div className="px-4 py-3">
              <h2 className="text-xl font-extrabold">{selected.name}</h2>
              {selected.address && <p className="text-sm font-bold text-slate-600">{selected.address}</p>}
              <p className="text-sm font-bold text-slate-500">
                {isSumitomoCustomer(selected.code) ? '工事コード別の請求' : detail?.mode === 'site' ? '現場別請求明細' : '請求明細'}　{selected.jobs.length}件　{amountLabel(selected)}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] border-collapse text-base">
                <thead>
                  <tr className="bg-slate-800 text-left text-sm text-white">
                    {detailHead.map((label, index) => (
                      <th
                        key={label}
                        className={`px-3 py-2 font-extrabold whitespace-nowrap ${index === 9 ? 'sticky right-0 bg-slate-800 text-center' : ''} ${[3, 5, 6, 8].includes(index) ? 'text-right' : ''}`}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {detail?.mode === 'site'
                    ? selected.sites.map((site, index) => (
                        <React.Fragment key={`${site.jobCode}:${site.name}:${index}`}>
                          <tr className="border-t-2 border-slate-300 bg-slate-100">
                            <td colSpan={8} className="px-3 py-2 font-black">
                              {isSumitomoCustomer(selected.code) && (
                                <button
                                  type="button"
                                  onClick={() => openSumitomo(selected, site, index)}
                                  className="mr-3 h-8 rounded-lg bg-teal-700 px-3 text-xs font-extrabold text-white"
                                >
                                  この工事の請求書
                                </button>
                              )}
                              {siteHeading(site)}
                            </td>
                            <td className="px-3 py-2 text-right whitespace-nowrap font-black">小計 {money(site.amount)}</td>
                            <td className="sticky right-0 bg-slate-100" />
                          </tr>
                          {site.jobs.flatMap((job) => jobRows(job))}
                        </React.Fragment>
                      ))
                    : selected.jobs.flatMap((job) => jobRows(job))}
                </tbody>
                <tfoot>
                  <tr className="border-t-4 border-slate-800 bg-slate-50">
                    <td colSpan={8} className="px-3 py-4 text-right text-lg font-black">
                      累計金額（{selected.jobs.length}件
                      {selected.jobs.some((job) => job.extraTotal) &&
                        `／うち付帯売上 ${money(selected.jobs.reduce((sum, job) => sum + job.extraTotal, 0))}`}
                      ）
                    </td>
                    <td className="px-3 py-4 text-right whitespace-nowrap text-2xl font-black">{money(selected.amount)}</td>
                    <td className="sticky right-0 bg-slate-50" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        ) : (
          <div className="space-y-3">
            {groups.map((group) => (
              <section key={group.code} className="bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-wrap items-center gap-3 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setDetail({ code: group.code, mode: isSumitomoCustomer(group.code) ? 'site' : 'flat' })}
                  className="h-9 px-3 rounded-lg bg-[#121826] text-white text-sm font-extrabold"
                >
                  {isSumitomoCustomer(group.code) ? '工事別の請求' : '請求明細'}
                </button>
                <div className="flex-1 min-w-40">
                  <div className="font-extrabold">{group.name}</div>
                  {group.address && <div className="text-xs font-bold text-slate-600">{group.address}</div>}
                  <div className="text-xs font-bold text-slate-500">
                    {group.jobs.length}件　{amountLabel(group)}
                  </div>
                </div>
                {!isSumitomoCustomer(group.code) && (
                  <button
                    type="button"
                    onClick={() => setDetail({ code: group.code, mode: 'site' })}
                    className="h-9 px-3 rounded-lg border border-slate-300 text-sm font-extrabold"
                  >
                    現場別請求明細
                  </button>
                )}
              </section>
            ))}
          </div>
        )}
        {!loading && skipped > 0 && (
          <p className="mt-4 text-xs font-bold text-slate-500">
            締日が違う、または得意先コードが空の配車 {skipped}件は、この締めに含めていません。
          </p>
        )}
      </main>
      {printUrl &&
        createPortal(
          <div className="fixed inset-0 z-[200] flex flex-col bg-slate-900 p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-extrabold text-white">内容を確認してから、印刷してください。</p>
              <div className="flex gap-2">
                <button type="button" onClick={printPreview} className="h-10 px-4 rounded-lg bg-white text-sm font-extrabold text-slate-900">
                  印刷する
                </button>
                <button type="button" onClick={closePrintPreview} className="h-10 px-4 rounded-lg border border-white/40 text-sm font-extrabold text-white">
                  閉じる
                </button>
              </div>
            </div>
            <iframe title="指定用紙の確認" src={printUrl} className="min-h-0 flex-1 rounded-xl bg-white" />
          </div>,
          document.body
        )}
      {invoice && (
        <InvoicePreview
          customer={{ name: invoice.name, postal: invoice.postal, address: invoice.address }}
          lines={invoice.lines}
          sumitomo={invoice.sumitomo}
          onClose={() => setInvoice(null)}
        />
      )}
    </div>
  );
}
