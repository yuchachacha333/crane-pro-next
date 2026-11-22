'use client';

import React, { useEffect, useState } from 'react';
import { distanceKm, formatDistance, geocodeAddress } from '@/lib/geo';

export type NearbyPartner = {
  id: string;
  name: string;
  tel: string;
  address: string;
  lat: number | null;
  lng: number | null;
};

type Props = {
  siteName: string;
  address: string;
  partners: NearbyPartner[];
  onClose: () => void;
};

type Ranked = NearbyPartner & { km: number | null };

export default function NearbyPartners({ siteName, address, partners, onClose }: Props) {
  const [rows, setRows] = useState<Ranked[]>([]);
  const [status, setStatus] = useState('現場の位置を探しています');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const point = await geocodeAddress(address);
      if (cancelled) return;
      if (!point) {
        setStatus('この現場の位置が見つかりませんでした');
        return;
      }
      const ranked = partners
        .map((partner) => {
          const known = partner.lat != null && partner.lng != null;
          return {
            ...partner,
            km: known ? distanceKm(point, { lat: partner.lat as number, lng: partner.lng as number }) : null,
          };
        })
        .sort((a, b) => {
          if (a.km == null && b.km == null) return a.name.localeCompare(b.name, 'ja');
          if (a.km == null) return 1;
          if (b.km == null) return -1;
          return a.km - b.km;
        });
      setRows(ranked);
      setStatus(`${siteName}から近い順`);
    }

    void load().catch(() => {
      if (!cancelled) setStatus('仲間を並べられませんでした');
    });

    return () => {
      cancelled = true;
    };
  }, [address, partners, siteName]);

  return (
    <div className="fixed inset-0 z-[90] bg-slate-950/50 flex items-end sm:items-center justify-center p-2">
      <div className="bg-white w-full max-w-lg max-h-[calc(100vh-1rem)] rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-slate-200 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-extrabold">近い仲間</h2>
            <p className="text-xs font-bold text-slate-500 truncate">{status}</p>
            <p className="text-sm font-extrabold mt-1">{address}</p>
          </div>
          <button type="button" onClick={onClose} className="h-10 px-3 rounded-xl border border-slate-300 font-bold shrink-0">
            閉じる
          </button>
        </div>
        <ul className="overflow-y-auto">
          {rows.map((row, index) => (
            <li key={row.id} className="px-4 py-3 border-b border-slate-100 flex items-center gap-3">
              <span className="w-6 text-sm font-extrabold text-slate-400">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="font-extrabold">{row.name}</div>
                <div className="text-xs font-bold text-slate-500">
                  {row.km == null ? '位置不明' : formatDistance(row.km)}
                  {row.address ? `　${row.address}` : ''}
                </div>
              </div>
              {row.tel ? (
                <a
                  href={`tel:${row.tel.replace(/[^\d+]/g, '')}`}
                  className="h-10 px-3 rounded-xl bg-slate-900 text-white text-sm font-extrabold flex items-center shrink-0"
                >
                  電話
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
