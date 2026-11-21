'use client';

import React, { useEffect, useMemo, useState } from 'react';
import AppSidebar from '@/components/app-sidebar';
import InvoicePreview from '@/components/invoice-preview';
import { billingPeriod, closeKeyOf, closeLabel } from '@/lib/billing';
import { formatJapaneseMonthDay, getTodayIso } from '@/lib/crane-utils';
import type { InvoiceLine } from '@/lib/invoice-sheet';
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
  requested_model: string | null;
  operator_name: string | null;
  supplier_name: string | null;
  unit_price: number | null;
  total_sales_amount: number | null;
  notes: string | null;
  is_cancelled: boolean | null;
};

type BillJob = Job & { amount: number; missing: boolean };
type SiteGroup = { name: string; amount: number; jobs: BillJob[] };
type Group = {
  code: string;
  name: string;
  jobs: BillJob[];
  sites: SiteGroup[];
  amount: number;
  missing: number;
};

function money(value: number): string {
  return `¥${Math.round(value).toLocaleString('ja-JP')}`;
}

function priced(job: Job, extra: number) {
  const base = job.total_sales_amount == null ? null : Number(job.total_sales_amount);
  const valid = base != null && Number.isFinite(base);
  return { amount: (valid ? base : 0) + extra, missing: !valid && !extra };
}

export default function BillingClient() {
  const [companyId, setCompanyId] = useState('');
  const [anchor, setAnchor] = useState('');
  const [close, setClose] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [extras, setExtras] = useState<Record<string, number>>({});
  const [detail, setDetail] = useState<{ code: string; mode: 'flat' | 'site' } | null>(null);
  const [invoice, setInvoice] = useState<{ name: string; postal: string; address: string; lines: InvoiceLine[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setAnchor(getTodayIso());
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
    if (!close && closes.length) setClose(closes[0]);
  }, [close, closes]);

  const period = anchor && close ? billingPeriod(close, anchor) : null;

  useEffect(() => {
    if (!companyId || !anchor || !close) return;
    const nextPeriod = billingPeriod(close, anchor);
    if (!nextPeriod) return;
    let cancelled = false;
    setLoading(true);
    supabase
      .from('dispatches')
      .select(
        'id, work_date, customer_code, customer_name, site_name, requested_model, operator_name, supplier_name, unit_price, total_sales_amount, notes, is_cancelled'
      )
      .eq('company_id', companyId)
      .gte('work_date', nextPeriod.start)
      .lte('work_date', nextPeriod.end)
      .then(async ({ data, error: queryError }) => {
        if (cancelled) return;
        if (queryError) {
          setLoading(false);
          setJobs([]);
          setExtras({});
          setError(queryError.message);
          return;
        }
        const rows = (data ?? []) as Job[];
        const extraMap: Record<string, number> = {};
        const ids = rows.map((row) => row.id);
        for (let index = 0; index < ids.length; index += 100) {
          const slice = ids.slice(index, index + 100);
          const extraRes = await supabase.from('dispatch_extras').select('dispatch_id, amount').in('dispatch_id', slice);
          for (const line of extraRes.data ?? []) {
            const id = String(line.dispatch_id);
            extraMap[id] = (extraMap[id] ?? 0) + Number(line.amount || 0);
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
      const price = priced(job, extras[job.id] ?? 0);
      const current = bucket.get(code) ?? {
        code,
        name: nameByCode.get(code) || job.customer_name || code,
        jobs: [],
        sites: [],
        amount: 0,
        missing: 0,
      };
      current.jobs.push({ ...job, amount: price.amount, missing: price.missing });
      current.amount += price.amount;
      if (price.missing) current.missing += 1;
      bucket.set(code, current);
    }
    const list = [...bucket.values()].map((group) => {
      const sites = new Map<string, SiteGroup>();
      for (const job of group.jobs) {
        const name = job.site_name || '現場未入力';
        const site = sites.get(name) ?? { name, amount: 0, jobs: [] };
        site.jobs.push(job);
        site.amount += job.amount;
        sites.set(name, site);
      }
      group.sites = [...sites.values()].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
      group.jobs.sort((a, b) => a.work_date.localeCompare(b.work_date) || (a.site_name || '').localeCompare(b.site_name || '', 'ja'));
      return group;
    });
    list.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    return { groups: list, skipped: skippedCount };
  }, [jobs, extras, close, closeByCode, nameByCode]);

  const total = groups.reduce((sum, group) => sum + group.amount, 0);
  const selected = detail ? groups.find((group) => group.code === detail.code) : undefined;

  function amountLabel(group: { amount: number; missing: number }) {
    const text = group.missing && !group.amount ? '単価未入力' : money(group.amount);
    return group.missing && group.amount ? `${text}（未入力 ${group.missing}件）` : text;
  }

  function openInvoice(group: Group) {
    const party = customers.find((customer) => customer.code === group.code);
    const lines: InvoiceLine[] = group.jobs.map((job) => {
      const shown = job.work_date.replace(/-/g, '/');
      const note = [job.notes || '', job.missing ? '単価未入力' : ''].filter(Boolean).join(' ');
      return {
        date: shown,
        machine: job.requested_model || '',
        site: job.site_name || '現場未入力',
        no: '',
        detail: '',
        qty: job.missing ? '' : 1,
        price: job.missing ? '' : job.amount,
        amount: job.missing ? '' : job.amount,
        note,
        start: shown,
        end: shown,
      };
    });
    setInvoice({
      name: group.name,
      postal: party?.postal_code || '',
      address: [party?.address1, party?.address2].filter(Boolean).join(' '),
      lines,
    });
  }

  function jobRow(job: BillJob, siteName: string) {
    return (
      <div key={job.id} className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-2 text-sm">
        <div>
          <div className="font-extrabold">
            {formatJapaneseMonthDay(job.work_date)}　{job.requested_model || '機種未入力'}
          </div>
          <div className="text-xs font-bold text-slate-500">
            {[siteName, job.operator_name || job.supplier_name || '担当未入力'].filter(Boolean).join('　')}
          </div>
        </div>
        <div className="font-extrabold">{job.missing ? '単価未入力' : money(job.amount)}</div>
      </div>
    );
  }

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
              type="date"
              value={anchor}
              onChange={(event) => setAnchor(event.target.value)}
              className="h-11 rounded-xl border border-slate-300 px-3 font-bold"
            />
            <select
              value={close}
              onChange={(event) => setClose(event.target.value)}
              className="h-11 rounded-xl border border-slate-300 px-3 font-bold"
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
        {error && <p className="mb-4 text-sm font-bold text-rose-700">{error}</p>}
        {loading && <p className="text-sm font-bold text-slate-500">集計しています...</p>}

        {!loading && groups.length === 0 && (
          <section className="bg-white border border-slate-200 rounded-2xl p-6 text-sm font-bold text-slate-500">
            この締め期間に、締日が一致する配車はありません。配車ボードで入力した行が対象です。
          </section>
        )}

        {selected ? (
          <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100">
              <button type="button" onClick={() => setDetail(null)} className="h-9 px-3 rounded-lg border border-slate-300 text-sm font-extrabold">
                得意先一覧
              </button>
              <button
                type="button"
                onClick={() => openInvoice(selected)}
                className="h-9 px-3 rounded-lg bg-teal-700 text-white text-sm font-extrabold"
              >
                請求書を印刷
              </button>
            </div>
            <div className="px-4 py-3">
              <h2 className="text-xl font-extrabold">{selected.name}</h2>
              <p className="text-sm font-bold text-slate-500">
                {detail?.mode === 'site' ? '現場別請求明細' : '請求明細'}　{selected.jobs.length}件　{amountLabel(selected)}
              </p>
            </div>
            {detail?.mode === 'site'
              ? selected.sites.map((site) => (
                  <div key={site.name}>
                    <div className="flex items-center justify-between bg-slate-50 px-4 py-2 text-sm font-extrabold">
                      <span>{site.name}</span>
                      <span>{money(site.amount)}</span>
                    </div>
                    {site.jobs.map((job) => jobRow(job, ''))}
                  </div>
                ))
              : selected.jobs.map((job) => jobRow(job, job.site_name || '現場未入力'))}
          </section>
        ) : (
          <div className="space-y-3">
            {groups.map((group) => (
              <section key={group.code} className="bg-white border border-slate-200 rounded-2xl shadow-sm flex flex-wrap items-center gap-3 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setDetail({ code: group.code, mode: 'flat' })}
                  className="h-9 px-3 rounded-lg bg-[#121826] text-white text-sm font-extrabold"
                >
                  請求明細
                </button>
                <div className="flex-1 min-w-40">
                  <div className="font-extrabold">{group.name}</div>
                  <div className="text-xs font-bold text-slate-500">
                    {group.jobs.length}件　{amountLabel(group)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDetail({ code: group.code, mode: 'site' })}
                  className="h-9 px-3 rounded-lg border border-slate-300 text-sm font-extrabold"
                >
                  現場別請求明細
                </button>
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
      {invoice && (
        <InvoicePreview
          customer={{ name: invoice.name, postal: invoice.postal, address: invoice.address }}
          lines={invoice.lines}
          onClose={() => setInvoice(null)}
        />
      )}
    </div>
  );
}
