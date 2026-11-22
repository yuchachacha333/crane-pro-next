'use client';

import React, { useEffect, useState } from 'react';
import { distanceKm, formatDistance, geocodeAddress } from '@/lib/geo';

export type CallNumber = {
  label: string;
  display: string;
  digits: string;
};

export type NearbyPartner = {
  id: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  calls: CallNumber[];
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
    <div className="fixed inset-0 z-[90] flex h-dvh max-h-dvh flex-col bg-slate-950/50 p-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:items-center sm:justify-center">
      <div className="flex min-h-0 w-full max-w-lg flex-1 flex-col overflow-hidden rounded-2xl bg-white text-black shadow-2xl sm:max-h-[calc(100dvh-1rem)]">
        <div className="border-b border-slate-300 px-4 py-3">
          <h2 className="text-lg font-black text-black">近い仲間</h2>
          <p className="truncate text-sm font-bold text-black">{status}</p>
          <p className="mt-1 text-base font-black text-black">{address}</p>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {rows.map((row, index) => (
            <li key={row.id} className="px-4 py-3 border-b border-slate-300">
              <div className="flex items-start gap-3">
                <span className="w-7 text-lg font-black text-black">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-lg font-black text-black leading-snug">{row.name}</div>
                  <div className="mt-1 text-sm font-bold text-black leading-snug">
                    {row.km == null ? '位置不明' : formatDistance(row.km)}
                    {row.address ? `　${row.address}` : ''}
                  </div>
                  {row.calls.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {row.calls.map((call) => (
                        <a
                          key={`${call.label}-${call.digits}`}
                          href={`tel:${call.digits}`}
                          className="min-h-11 px-3 py-1.5 rounded-xl bg-black text-white text-sm font-black leading-tight flex flex-col justify-center"
                        >
                          <span>{call.label}</span>
                          <span className="text-xs font-bold">{call.display}</span>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
        <div className="shrink-0 border-t border-slate-300 p-3">
          <button type="button" onClick={onClose} className="h-12 w-full rounded-xl border border-slate-400 font-black">
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
