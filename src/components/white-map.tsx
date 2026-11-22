'use client';

import React, { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';

type Props = {
  address: string;
  onClose: () => void;
};

const PIN = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="48" viewBox="0 0 36 48" aria-hidden="true">
  <path d="M18 47S2 29 2 18a16 16 0 1 1 32 0C34 29 18 47 18 47z" fill="#111" stroke="#111" stroke-width="1.5"/>
  <circle cx="18" cy="18" r="6.5" fill="#fff"/>
</svg>`;

export default function WhiteMapDialog({ address, onClose }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('住所を探しています');

  useEffect(() => {
    let cancelled = false;
    let map: { remove: () => void } | null = null;

    async function draw() {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(address)}`);
      const found = (await response.json()) as { lat: number | null; lng: number | null; label: string };
      if (cancelled) return;
      if (found.lat == null || found.lng == null) {
        setStatus('この住所の位置が見つかりませんでした');
        return;
      }
      const leaflet = (await import('leaflet')) as typeof import('leaflet') & {
        default?: typeof import('leaflet');
      };
      if (cancelled || !host.current) return;
      const L = leaflet.default?.map ? leaflet.default : leaflet;
      const view = L.map(host.current, { zoomControl: true }).setView([found.lat, found.lng], 17);
      map = view;
      L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', {
        attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">国土地理院</a>',
        maxZoom: 18,
        minZoom: 5,
      }).addTo(view);
      const pin = L.divIcon({
        className: 'mono-pin',
        html: PIN,
        iconSize: [36, 48],
        iconAnchor: [18, 46],
      });
      L.marker([found.lat, found.lng], { icon: pin, keyboard: false, title: address }).addTo(view);
      setStatus(found.label || address);
      window.setTimeout(() => view.invalidateSize(), 50);
    }

    void draw().catch(() => {
      if (!cancelled) setStatus('地図を開けませんでした');
    });

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [address]);

  return (
    <div className="fixed inset-0 z-[90] bg-slate-950/50 flex items-center justify-center p-3">
      <style>{`
        .mono-map .leaflet-tile-pane { filter: grayscale(1) contrast(2.6) brightness(1.2); }
        .mono-map .leaflet-container { background: #fff; }
        .mono-pin { background: none; border: none; }
      `}</style>
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
        <div ref={host} className="mono-map h-[70vh] bg-white" />
      </div>
    </div>
  );
}
