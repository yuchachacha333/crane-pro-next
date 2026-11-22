'use client';

import React, { useEffect, useMemo, useState } from 'react';
import AppSidebar from '@/components/app-sidebar';
import { formatJapaneseMonthDay, getTodayIso } from '@/lib/crane-utils';
import { getDefaultCompanyId, supabase } from '@/lib/supabase';

type Job = {
  id: string;
  work_date: string;
  customer_code: string | null;
  customer_name: string | null;
  site_name: string | null;
  requested_model: string | null;
  supplier_name: string | null;
  operator_name: string | null;
  unit_price: number | null;
  total_sales_amount: number | null;
  purchase_amount?: number | null;
  is_cancelled: boolean | null;
};
type Extra = { name: string; amount: number };
type Row = Job & { base: number | null; extras: Extra[]; extraTotal: number; amount: number };
type Group = { key: string; name: string; rows: Row[]; sales: number; extra: number; cost: number; costMissing: number; unpriced: number };
type View = 'customer' | 'supplier' | 'model';

const money = (v: number) => `¥${Math.round(v).toLocaleString('ja-JP')}`;

// 売上合計は「基本＋付帯」で保存されるので、付帯を二重に足さない
function priceOf(job: Job, extra: number) {
  let base: number | null = null;
  if (job.unit_price != null && Number.isFinite(Number(job.unit_price))) base = Number(job.unit_price);
  else if (job.total_sales_amount != null && Number.isFinite(Number(job.total_sales_amount))) base = Number(job.total_sales_amount) - extra;
  return base;
}

function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, '0')}` };
}

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function SalesClient() {
  const [companyId, setCompanyId] = useState('');
  const [month, setMonth] = useState('');
  const [view, setView] = useState<View>('customer');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    setMonth(getTodayIso().slice(0, 7));
    getDefaultCompanyId()
      .then(setCompanyId)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!companyId || !month) return;
    let cancelled = false;
    setLoading(true);
    setOpen(null);
    const { start, end } = monthRange(month);
    (async () => {
      const res = await supabase
        .from('dispatches')
        .select('*')
        .eq('company_id', companyId)
        .gte('work_date', start)
        .lte('work_date', end)
        .order('work_date', { ascending: true });
      if (cancelled) return;
      if (res.error) {
        setError(res.error.message);
        setRows([]);
        setLoading(false);
        return;
      }
      const jobs = ((res.data ?? []) as Job[]).filter((j) => !j.is_cancelled);
      const map: Record<string, Extra[]> = {};
      const ids = jobs.map((j) => j.id);
      for (let i = 0; i < ids.length; i += 100) {
        const ex = await supabase
          .from('dispatch_extras')
          .select('dispatch_id, item_name, amount')
          .in('dispatch_id', ids.slice(i, i + 100));
        for (const line of ex.data ?? []) {
          (map[String(line.dispatch_id)] ??= []).push({ name: String(line.item_name || '付帯'), amount: Number(line.amount || 0) });
        }
      }
      if (cancelled) return;
      setError('');
      setRows(
        jobs.map((job) => {
          const extras = map[job.id] ?? [];
          const extraTotal = extras.reduce((s, e) => s + e.amount, 0);
          const base = priceOf(job, extraTotal);
          return { ...job, base, extras, extraTotal, amount: (base ?? 0) + extraTotal };
        })
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, month]);

  const totals = useMemo(() => {
    const sales = rows.reduce((s, r) => s + r.amount, 0);
    const extra = rows.reduce((s, r) => s + r.extraTotal, 0);
    const outsourced = rows.filter((r) => (r.supplier_name || '').trim());
    const cost = outsourced.reduce((s, r) => s + Number(r.purchase_amount || 0), 0);
    const costMissing = outsourced.filter((r) => r.purchase_amount == null).length;
    const outsourcedSales = outsourced.reduce((s, r) => s + r.amount, 0);
    return { sales, extra, cost, costMissing, outsourcedSales, count: rows.length };
  }, [rows]);

  const groups = useMemo(() => {
    const bucket = new Map<string, Group>();
    for (const row of rows) {
      let key: string;
      let name: string;
      if (view === 'customer') {
        key = row.customer_code || row.customer_name || '';
        name = row.customer_name || '得意先未入力';
      } else if (view === 'supplier') {
        if (!(row.supplier_name || '').trim()) continue;
        key = row.supplier_name as string;
        name = key;
      } else {
        key = (row.requested_model || '').trim();
        name = key || '機種未入力';
      }
      const g = bucket.get(key || name) ?? { key: key || name, name, rows: [], sales: 0, extra: 0, cost: 0, costMissing: 0, unpriced: 0 };
      g.rows.push(row);
      g.sales += row.amount;
      g.extra += row.extraTotal;
      if ((row.supplier_name || '').trim()) {
        g.cost += Number(row.purchase_amount || 0);
        if (row.purchase_amount == null) g.costMissing += 1;
      }
      if (row.base == null && !row.extraTotal) g.unpriced += 1;
      bucket.set(g.key, g);
    }
    const list = [...bucket.values()];
    list.sort((a, b) => (view === 'supplier' ? b.cost - a.cost || b.sales - a.sales : b.sales - a.sales));
    return list;
  }, [rows, view]);

  const maxValue = Math.max(1, ...groups.map((g) => (view === 'supplier' ? g.cost : g.sales)));
  const gross = totals.sales - totals.cost;
  const tabs: { key: View; label: string }[] = [
    { key: 'customer', label: '得意先別（売上）' },
    { key: 'supplier', label: '外注先別（支払）' },
    { key: 'model', label: '機種別' },
  ];

  const th = 'px-3 py-2 font-extrabold whitespace-nowrap text-sm';
  const td = 'px-3 py-2.5 whitespace-nowrap';

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col md:flex-row">
      <AppSidebar active="sales" />
      <main className="flex-1 min-w-0 p-4 md:p-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">売上集計</h1>
            <p className="text-sm text-slate-600 mt-1">月ごとに、売上・外注への支払・粗利を内訳つきで見ます（キャンセルは除きます）。</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} className="h-14 w-14 rounded-2xl border-2 border-slate-400 bg-white text-xl font-black">
              ◀
            </button>
            <input
              type="month"
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              className="h-14 min-w-44 rounded-2xl border-2 border-slate-400 bg-white px-4 text-xl font-black text-black"
            />
            <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} className="h-14 w-14 rounded-2xl border-2 border-slate-400 bg-white text-xl font-black">
              ▶
            </button>
          </div>
        </div>

        {error && <p className="mb-3 text-sm font-bold text-rose-700">{error}</p>}

        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            { label: '売上合計', value: money(totals.sales), sub: `${totals.count}件` },
            { label: 'うち付帯売上', value: money(totals.extra), sub: '' },
            { label: '外注への支払', value: money(totals.cost), sub: totals.costMissing ? `仕入金額 未入力 ${totals.costMissing}件` : '' },
            { label: '粗利', value: money(gross), sub: '売上 − 外注支払' },
            { label: '粗利率', value: totals.sales ? `${Math.round((gross / totals.sales) * 1000) / 10}%` : '—', sub: '' },
          ].map((card) => (
            <div key={card.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-sm font-extrabold text-slate-600">{card.label}</div>
              <div className="mt-1 text-2xl font-black text-black">{card.value}</div>
              {card.sub && <div className="text-xs font-bold text-slate-600">{card.sub}</div>}
            </div>
          ))}
        </div>

        <div className="mb-3 flex gap-2 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setView(t.key);
                setOpen(null);
              }}
              className={`h-12 shrink-0 rounded-xl px-5 text-base font-black ${view === t.key ? 'bg-[#121826] text-white' : 'bg-white border-2 border-slate-300 text-black'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {view === 'supplier' && totals.costMissing > 0 && (
          <p className="mb-3 rounded-xl bg-amber-50 px-4 py-2 text-sm font-bold text-amber-900">
            仕入金額が未入力の外注が {totals.costMissing}件あります。配車の「詳細・売上」→「庸車・日程変更」で入力すると、ここに支払額が出ます。
          </p>
        )}
        {loading && <p className="text-sm font-bold text-slate-600">集計しています...</p>}

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-base">
              <thead>
                <tr className="bg-slate-800 text-left text-white">
                  <th className={th}>{view === 'customer' ? '得意先' : view === 'supplier' ? '外注先' : '機種'}</th>
                  <th className={`${th} text-right`}>件数</th>
                  <th className={`${th} text-right`}>売上</th>
                  <th className={`${th} text-right`}>うち付帯</th>
                  {view !== 'model' && <th className={`${th} text-right`}>外注支払</th>}
                  {view !== 'model' && <th className={`${th} text-right`}>粗利</th>}
                  <th className={`${th} w-40`}>構成</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const isOpen = open === g.key;
                  const value = view === 'supplier' ? g.cost : g.sales;
                  return (
                    <React.Fragment key={g.key}>
                      <tr
                        onClick={() => setOpen(isOpen ? null : g.key)}
                        className="cursor-pointer border-t border-slate-200 hover:bg-teal-50"
                      >
                        <td className={`${td} font-black`}>
                          {isOpen ? '▼' : '▶'} {g.name}
                          {g.unpriced > 0 && <span className="ml-2 text-xs font-bold text-rose-700">単価未入力 {g.unpriced}件</span>}
                        </td>
                        <td className={`${td} text-right font-bold`}>{g.rows.length}</td>
                        <td className={`${td} text-right font-black`}>{money(g.sales)}</td>
                        <td className={`${td} text-right font-bold`}>{g.extra ? money(g.extra) : '—'}</td>
                        {view !== 'model' && (
                          <td className={`${td} text-right font-bold`}>
                            {g.cost ? money(g.cost) : '—'}
                            {g.costMissing > 0 && <span className="ml-1 text-xs text-rose-700">未入力{g.costMissing}</span>}
                          </td>
                        )}
                        {view !== 'model' && (
                          <td className={`${td} text-right font-black`}>{g.cost || view === 'supplier' ? money(g.sales - g.cost) : '—'}</td>
                        )}
                        <td className="px-3 py-2.5">
                          <div className="h-3 rounded bg-slate-200">
                            <div className="h-3 rounded bg-teal-700" style={{ width: `${Math.max(2, (value / maxValue) * 100)}%` }} />
                          </div>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-slate-50">
                          <td colSpan={view === 'model' ? 5 : 7} className="p-0">
                            <table className="w-full border-collapse text-sm">
                              <thead>
                                <tr className="text-left text-slate-700">
                                  <th className="px-4 py-1.5 font-extrabold">作業日</th>
                                  <th className="px-3 py-1.5 font-extrabold">{view === 'customer' ? '機種' : '得意先'}</th>
                                  <th className="px-3 py-1.5 font-extrabold">現場名</th>
                                  <th className="px-3 py-1.5 text-right font-extrabold">売上</th>
                                  <th className="px-3 py-1.5 text-right font-extrabold">付帯</th>
                                  {view !== 'model' && <th className="px-3 py-1.5 text-right font-extrabold">{view === 'customer' ? '外注' : '仕入金額'}</th>}
                                </tr>
                              </thead>
                              <tbody>
                                {g.rows.map((r) => (
                                  <tr key={r.id} className="border-t border-slate-200">
                                    <td className="px-4 py-1.5 font-bold whitespace-nowrap">{formatJapaneseMonthDay(r.work_date)}</td>
                                    <td className="px-3 py-1.5 font-bold">{view === 'customer' ? r.requested_model || '—' : r.customer_name || '—'}</td>
                                    <td className="px-3 py-1.5 font-bold">{r.site_name || '—'}</td>
                                    <td className="px-3 py-1.5 text-right font-black whitespace-nowrap">
                                      {r.base == null && !r.extraTotal ? '未入力' : money(r.amount)}
                                    </td>
                                    <td className="px-3 py-1.5 text-right font-bold whitespace-nowrap">
                                      {r.extras.length ? r.extras.map((e) => `${e.name} ${money(e.amount)}`).join(' / ') : '—'}
                                    </td>
                                    {view !== 'model' && (
                                      <td className="px-3 py-1.5 text-right font-bold whitespace-nowrap">
                                        {view === 'customer'
                                          ? r.supplier_name
                                            ? `${r.supplier_name} ${r.purchase_amount != null ? money(Number(r.purchase_amount)) : '未入力'}`
                                            : '自社'
                                          : r.purchase_amount != null
                                            ? money(Number(r.purchase_amount))
                                            : '未入力'}
                                      </td>
                                    )}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {!loading && groups.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-sm font-bold text-slate-600">
                      この月のデータはありません。
                    </td>
                  </tr>
                )}
              </tbody>
              {groups.length > 0 && (
                <tfoot>
                  <tr className="border-t-4 border-slate-800 bg-slate-50 font-black">
                    <td className={td}>合計</td>
                    <td className={`${td} text-right`}>{groups.reduce((s, g) => s + g.rows.length, 0)}</td>
                    <td className={`${td} text-right`}>{money(groups.reduce((s, g) => s + g.sales, 0))}</td>
                    <td className={`${td} text-right`}>{money(groups.reduce((s, g) => s + g.extra, 0))}</td>
                    {view !== 'model' && <td className={`${td} text-right`}>{money(groups.reduce((s, g) => s + g.cost, 0))}</td>}
                    {view !== 'model' && (
                      <td className={`${td} text-right`}>{money(groups.reduce((s, g) => s + g.sales - g.cost, 0))}</td>
                    )}
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
