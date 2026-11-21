'use client';

import React, { useEffect, useState } from 'react';
import AppSidebar from '@/components/app-sidebar';
import { formatJapaneseMonthDay, getTodayIso } from '@/lib/crane-utils';
import { getDefaultCompanyId, supabase } from '@/lib/supabase';

const HORIZON = 90;

const VEHICLE_DATES = [
  { key: 'inspection_expiry', label: '車検満了日' },
  { key: 'crane_inspection_expiry', label: 'クレーン検査満了日' },
  { key: 'compulsory_insurance_expiry', label: '自賠責保険有効期限' },
  { key: 'voluntary_insurance_expiry', label: '任意保険有効期限' },
] as const;

const PRODUCT_DATES = [
  { key: 'inspection_expiry', label: '車検満了日' },
  { key: 'crane_inspection_expiry', label: 'クレーン検査満了日' },
  { key: 'lower_inspection_expiry', label: '下車検満了日' },
  { key: 'upper_inspection_expiry', label: '上車検満了日' },
] as const;

const GRANT_SQL = `grant select, insert, update, delete on table
  public.vehicle_inspections
to anon, authenticated;`;

type Level = 'overdue' | 'soon' | 'watch';

type AlertRow = {
  id: string;
  name: string;
  kind: string;
  date: string;
  days: number;
  level: Level;
  source: string;
};

function daysUntil(iso: string, today: string): number | null {
  const target = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const base = today.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!target || !base) return null;
  const targetUtc = Date.UTC(Number(target[1]), Number(target[2]) - 1, Number(target[3]));
  const baseUtc = Date.UTC(Number(base[1]), Number(base[2]) - 1, Number(base[3]));
  return Math.round((targetUtc - baseUtc) / 86400000);
}

function levelOf(days: number): Level {
  if (days < 0) return 'overdue';
  if (days <= 30) return 'soon';
  return 'watch';
}

const levelLabel: Record<Level, string> = {
  overdue: '期限超過',
  soon: '30日以内',
  watch: '90日以内',
};

const levelClass: Record<Level, string> = {
  overdue: 'bg-rose-100 text-rose-800',
  soon: 'bg-amber-100 text-amber-900',
  watch: 'bg-sky-100 text-sky-900',
};

export default function AlertsClient() {
  const [rows, setRows] = useState<AlertRow[]>([]);
  const [grantNeeded, setGrantNeeded] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const today = getTodayIso();

    async function load() {
      try {
        const companyId = await getDefaultCompanyId();
        const [vehicles, products] = await Promise.all([
          supabase
            .from('vehicle_inspections')
            .select(
              'id, product_name, inspection_expiry, crane_inspection_expiry, compulsory_insurance_expiry, voluntary_insurance_expiry'
            )
            .eq('company_id', companyId),
          supabase
            .from('products')
            .select(
              'id, name, is_scrapped, inspection_expiry, crane_inspection_expiry, lower_inspection_expiry, upper_inspection_expiry'
            )
            .eq('company_id', companyId),
        ]);
        if (cancelled) return;

        const next: AlertRow[] = [];
        const denied = vehicles.error?.message.includes('permission denied') || vehicles.error?.code === '42501';
        setGrantNeeded(Boolean(denied));
        if (vehicles.error && !denied) setError(vehicles.error.message);
        if (products.error) setError(products.error.message);

        const vehicleRows = denied ? [] : ((vehicles.data ?? []) as Record<string, string | null>[]);
        for (const vehicle of vehicleRows) {
          const name = vehicle.product_name || '名称未設定';
          for (const kind of VEHICLE_DATES) {
            const raw = vehicle[kind.key];
            if (!raw) continue;
            const days = daysUntil(String(raw), today);
            if (days == null || days > HORIZON) continue;
            next.push({
              id: `v-${vehicle.id}-${kind.key}`,
              name,
              kind: kind.label,
              date: String(raw).slice(0, 10),
              days,
              level: levelOf(days),
              source: '車検',
            });
          }
        }

        for (const product of (products.data ?? []) as Record<string, string | boolean | null>[]) {
          if (product.is_scrapped === true) continue;
          const name = String(product.name || '名称未設定');
          for (const kind of PRODUCT_DATES) {
            const raw = product[kind.key];
            if (!raw) continue;
            const days = daysUntil(String(raw), today);
            if (days == null || days > HORIZON) continue;
            next.push({
              id: `p-${product.id}-${kind.key}`,
              name,
              kind: kind.label,
              date: String(raw).slice(0, 10),
              days,
              level: levelOf(days),
              source: '商品',
            });
          }
        }

        next.sort((a, b) => a.days - b.days || a.name.localeCompare(b.name, 'ja'));
        setRows(next);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '期限を読み込めません');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function copySql() {
    await navigator.clipboard.writeText(GRANT_SQL);
    setCopied(true);
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col md:flex-row">
      <AppSidebar active="alerts" />
      <main className="flex-1 min-w-0 p-4 md:p-6">
        <div className="mb-4">
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">期限アラート</h1>
          <p className="text-sm text-slate-500 mt-1">車検・クレーン検査・自賠責・任意保険のうち、90日以内と期限超過を表示します。</p>
        </div>

        {grantNeeded && (
          <section className="mb-4 bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <p className="text-sm font-bold text-amber-950">
              車検日確認マスタを読む権限がありません。Supabase の SQL エディタで次を実行すると、保険期限も表示できます。
            </p>
            <pre className="mt-3 overflow-auto rounded-xl bg-white p-3 text-xs font-mono text-slate-800">{GRANT_SQL}</pre>
            <button type="button" onClick={() => void copySql()} className="mt-3 h-9 px-3 rounded-lg bg-[#121826] text-white text-sm font-extrabold">
              {copied ? 'コピーしました' : 'SQLをコピー'}
            </button>
          </section>
        )}
        {error && <p className="mb-4 text-sm font-bold text-rose-700">{error}</p>}
        {loading && <p className="text-sm font-bold text-slate-500">確認しています...</p>}

        {!loading && rows.length === 0 && (
          <section className="bg-white border border-slate-200 rounded-2xl p-6 text-sm font-bold text-slate-500">
            90日以内の期限はありません。商品マスタの車検日が空のときは、商品台帳の期限欄に日付を入れるとここに出ます。
          </section>
        )}

        {!loading && rows.length > 0 && (
          <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-sky-50 text-left text-xs font-extrabold text-slate-700">
                  <th className="px-3 py-2">状態</th>
                  <th className="px-3 py-2">名称</th>
                  <th className="px-3 py-2">項目</th>
                  <th className="px-3 py-2">日付</th>
                  <th className="px-3 py-2">残り</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-extrabold ${levelClass[row.level]}`}>
                        {levelLabel[row.level]}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-bold">
                      {row.name}
                      <span className="ml-2 text-xs font-bold text-slate-400">{row.source}</span>
                    </td>
                    <td className="px-3 py-2">{row.kind}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatJapaneseMonthDay(row.date)}</td>
                    <td className="px-3 py-2 font-extrabold">{row.days < 0 ? `${Math.abs(row.days)}日超過` : `${row.days}日`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </main>
    </div>
  );
}
