'use client';

import React, { useEffect, useMemo, useState } from 'react';
import AppSidebar from '@/components/app-sidebar';
import { distanceKm, errorMessage, formatCoordinate, formatDistance, geocodeAddress, missingCoordinateColumn } from '@/lib/geo';
import { getDefaultCompanyId, supabase } from '@/lib/supabase';

const COORDINATE_SQL = `alter table public.customers
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

alter table public.sites
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;`;

type Supplier = {
  id: string;
  code: string;
  name: string;
  tel: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
};

type SiteHit = {
  id: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
};

type Destination = {
  label: string;
  address: string;
  lat: number;
  lng: number;
};

type CustomerRow = {
  id: string;
  code: string | null;
  name: string | null;
  tel: string | null;
  address1: string | null;
  address2: string | null;
  partner_type: string | null;
  latitude: number | null;
  longitude: number | null;
};

function asPoint(latitude: number | null, longitude: number | null) {
  if (latitude == null || longitude == null) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { lat: latitude, lng: longitude };
}

export default function FindCraneClient() {
  const [companyId, setCompanyId] = useState('');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [query, setQuery] = useState('');
  const [sites, setSites] = useState<SiteHit[]>([]);
  const [destination, setDestination] = useState<Destination | null>(null);
  const [progress, setProgress] = useState('');
  const [status, setStatus] = useState('仕入先を読み込んでいます');
  const [error, setError] = useState('');
  const [needSql, setNeedSql] = useState(false);
  const [copied, setCopied] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const id = await getDefaultCompanyId();
        if (cancelled) return;
        setCompanyId(id);
        const { data, error: loadError } = await supabase
          .from('customers')
          .select('id,code,name,tel,address1,address2,partner_type,latitude,longitude')
          .eq('company_id', id)
          .limit(3000);
        if (loadError) throw loadError;
        const rows = ((data || []) as CustomerRow[])
          .filter((row) => String(row.partner_type || '').includes('仕入') && row.name)
          .map((row) => ({
            id: row.id,
            code: row.code || '',
            name: row.name || '',
            tel: row.tel || '',
            address: [row.address1, row.address2].filter(Boolean).join(' '),
            latitude: row.latitude,
            longitude: row.longitude,
          }));
        if (cancelled) return;
        setSuppliers(rows);
        setStatus(`${rows.length}件の仕入先`);
        void fillCoordinates(rows, () => cancelled);
      } catch (err) {
        if (cancelled) return;
        const message = errorMessage(err, '仕入先を読めませんでした');
        if (missingCoordinateColumn(message)) setNeedSql(true);
        else setError(message);
        setStatus('');
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!companyId) return;
    const text = query.trim();
    if (text.length < 1) {
      setSites([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void supabase
        .from('sites')
        .select('id,name,address,latitude,longitude')
        .eq('company_id', companyId)
        .or(`name.ilike.%${text.replace(/[%_,]/g, '')}%,address.ilike.%${text.replace(/[%_,]/g, '')}%`)
        .limit(12)
        .then(({ data, error: searchError }) => {
          if (cancelled) return;
          if (searchError) {
            if (missingCoordinateColumn(searchError.message)) setNeedSql(true);
            return;
          }
          setSites(
            ((data || []) as SiteHit[]).map((site) => ({
              id: site.id,
              name: site.name || '',
              address: site.address || '',
              latitude: site.latitude,
              longitude: site.longitude,
            }))
          );
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [companyId, query]);

  async function fillCoordinates(rows: Supplier[], cancelled: () => boolean) {
    const pending = rows.filter((row) => !asPoint(row.latitude, row.longitude) && row.address);
    if (pending.length === 0) return;
    let finished = rows.length - pending.length;
    setProgress(`緯度と経度を入れています ${finished}/${rows.length}`);
    const queue = [...pending];

    async function worker() {
      while (!cancelled()) {
        const row = queue.shift();
        if (!row) return;
        const point = await geocodeAddress(row.address);
        if (point) {
          const { error: saveError } = await supabase
            .from('customers')
            .update({ latitude: point.lat, longitude: point.lng })
            .eq('id', row.id);
          if (saveError) {
            if (missingCoordinateColumn(saveError.message)) setNeedSql(true);
            return;
          }
          if (!cancelled()) {
            setSuppliers((current) =>
              current.map((item) => (item.id === row.id ? { ...item, latitude: point.lat, longitude: point.lng } : item))
            );
          }
        }
        finished += 1;
        if (!cancelled()) setProgress(`緯度と経度を入れています ${finished}/${rows.length}`);
      }
    }

    await Promise.all([worker(), worker(), worker()]);
    if (!cancelled()) setProgress('');
  }

  async function useSite(site: SiteHit) {
    setSearching(true);
    setError('');
    setSites([]);
    setQuery(site.name);
    try {
      let point = asPoint(site.latitude, site.longitude);
      if (!point && site.address) {
        point = await geocodeAddress(site.address);
        if (point) {
          await supabase.from('sites').update({ latitude: point.lat, longitude: point.lng }).eq('id', site.id);
        }
      }
      if (!point) {
        setError('この現場の位置が見つかりませんでした');
        return;
      }
      setDestination({ label: site.name, address: site.address, lat: point.lat, lng: point.lng });
    } finally {
      setSearching(false);
    }
  }

  async function useTypedAddress() {
    const address = query.trim();
    if (address.length < 2) return;
    setSearching(true);
    setError('');
    setSites([]);
    try {
      const point = await geocodeAddress(address);
      if (!point) {
        setError('この住所の位置が見つかりませんでした');
        return;
      }
      setDestination({ label: address, address, lat: point.lat, lng: point.lng });
    } finally {
      setSearching(false);
    }
  }

  const ranked = useMemo(() => {
    if (!destination) return [];
    return suppliers
      .map((supplier) => {
        const point = asPoint(supplier.latitude, supplier.longitude);
        return {
          supplier,
          km: point ? distanceKm(destination, point) : null,
        };
      })
      .sort((a, b) => {
        if (a.km == null && b.km == null) return a.supplier.name.localeCompare(b.supplier.name, 'ja');
        if (a.km == null) return 1;
        if (b.km == null) return -1;
        return a.km - b.km;
      });
  }, [destination, suppliers]);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col md:flex-row">
      <AppSidebar active="find" />
      <main className="flex-1 min-w-0 p-4 md:p-6">
        <div className="mb-4">
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">クレーンを探す</h1>
          <p className="text-sm text-slate-500 mt-1">
            現場と仕入先の緯度・経度から、直線距離が短い順に仕入先を出します。道路距離ではありません。
          </p>
        </div>

        {needSql && (
          <section className="mb-4 bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <p className="text-sm font-bold text-amber-950">
              緯度と経度を保存する列がまだありません。Supabase の SQL エディタで次を1回実行してください。
            </p>
            <pre className="mt-3 overflow-auto rounded-xl bg-white p-3 text-xs font-mono text-slate-800">{COORDINATE_SQL}</pre>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(COORDINATE_SQL).then(() => setCopied(true));
              }}
              className="mt-3 h-9 px-3 rounded-lg bg-[#121826] text-white text-sm font-extrabold"
            >
              {copied ? 'コピーしました' : 'SQLをコピー'}
            </button>
          </section>
        )}

        {error && <p className="mb-4 text-sm font-bold text-rose-700">{error}</p>}

        <section className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
          <label className="block text-xs font-extrabold text-slate-500 mb-1">現場名または住所</label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="現場名、または住所"
              className="h-11 flex-1 rounded-xl border border-slate-300 px-3 font-bold"
            />
            <button
              type="button"
              onClick={() => void useTypedAddress()}
              disabled={searching || query.trim().length < 2}
              className="h-11 px-4 rounded-xl bg-slate-900 text-white font-extrabold disabled:opacity-40"
            >
              この住所で探す
            </button>
          </div>
          {sites.length > 0 && (
            <ul className="mt-2 border border-slate-200 rounded-xl overflow-hidden">
              {sites.map((site) => (
                <li key={site.id} className="border-t border-slate-100 first:border-t-0">
                  <button
                    type="button"
                    onClick={() => void useSite(site)}
                    className="w-full px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <span className="font-extrabold">{site.name}</span>
                    <span className="ml-2 text-sm font-bold text-slate-500">{site.address}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs font-bold text-slate-500">{progress || status}</p>
          {destination && (
            <p className="mt-1 text-sm font-extrabold">
              目的地 {destination.label}
              <span className="ml-2 font-bold text-slate-500">
                緯度 {formatCoordinate(destination.lat)}　経度 {formatCoordinate(destination.lng)}
              </span>
            </p>
          )}
        </section>

        {destination && (
          <section className="mt-4 bg-white border border-slate-200 rounded-2xl shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-sky-50 text-left text-xs font-extrabold text-slate-700">
                  <th className="px-3 py-2">順</th>
                  <th className="px-3 py-2">仕入先</th>
                  <th className="px-3 py-2">直線距離</th>
                  <th className="px-3 py-2">住所</th>
                  <th className="px-3 py-2">電話</th>
                  <th className="px-3 py-2">緯度</th>
                  <th className="px-3 py-2">経度</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((row, index) => (
                  <tr key={row.supplier.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-extrabold">{index + 1}</td>
                    <td className="px-3 py-2 font-extrabold">{row.supplier.name}</td>
                    <td className="px-3 py-2 font-extrabold whitespace-nowrap">
                      {row.km == null ? '位置不明' : formatDistance(row.km)}
                    </td>
                    <td className="px-3 py-2">{row.supplier.address}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{row.supplier.tel}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {row.supplier.latitude == null ? '' : formatCoordinate(row.supplier.latitude)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {row.supplier.longitude == null ? '' : formatCoordinate(row.supplier.longitude)}
                    </td>
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
