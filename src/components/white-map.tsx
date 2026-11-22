'use client';

import React, { useEffect, useState } from 'react';

type Props = {
  address: string;
  onClose: () => void;
};

type Geocode = { lat: number | null; lng: number | null; label: string };

export default function WhiteMapDialog({ address, onClose }: Props) {
  const [src, setSrc] = useState('');
  const [status, setStatus] = useState('住所を探しています');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(address)}`);
      const found = (await response.json()) as Geocode;
      if (cancelled) return;
      if (found.lat == null || found.lng == null) {
        setStatus('この住所の位置が見つかりませんでした');
        return;
      }
      const cond = encodeURIComponent('action:place;maptype:twoTones');
      setSrc(
        `https://map.yahoo.co.jp/embedmap/V3/embedmap?lat=${found.lat}&lon=${found.lng}&zoom=17&cond=${cond}&width=1200&height=800`
      );
      setStatus(found.label || address);
    }

    void load().catch(() => {
      if (!cancelled) setStatus('地図を開けませんでした');
    });

    return () => {
      cancelled = true;
    };
  }, [address]);

  return (
    <div className="fixed inset-0 z-[90] bg-slate-950/50 flex items-center justify-center p-3">
      <div className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-extrabold">モノトーン地図</h2>
            <p className="text-sm font-bold text-slate-600">{address}</p>
            <p className="text-xs font-bold text-slate-500">{status}</p>
          </div>
          <button type="button" onClick={onClose} className="h-10 px-3 rounded-xl border border-slate-300 font-bold">
            閉じる
          </button>
        </div>
        {src ? (
          <iframe title={`${address}のヤフー地図`} src={src} className="h-[70vh] w-full bg-white" />
        ) : (
          <div className="h-[70vh] bg-white" />
        )}
      </div>
    </div>
  );
}
