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
    <div className="fixed inset-0 z-[90] bg-slate-950/50 flex items-end sm:items-center justify-center p-2">
      <div className="bg-white text-black w-full max-w-lg max-h-[calc(100vh-1rem)] rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-slate-300 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-black text-black">近い仲間</h2>
            <p className="text-sm font-bold text-black truncate">{status}</p>
            <p className="text-base font-black text-black mt-1">{address}</p>
          </div>
          <button type="button" onClick={onClose} className="h-10 px-3 rounded-xl border border-slate-400 font-black shrink-0">
            閉じる
          </button>
        </div>
        <ul className="overflow-y-auto">
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
      </div>
    </div>
  );
}
