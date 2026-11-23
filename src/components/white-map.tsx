'use client';

import React, { useEffect, useRef, useState } from 'react';
import { downloadMapWord, FRAME_H_MM, FRAME_W_MM } from '@/lib/map-word';

type Props = {
  address: string;
  date: string;
  siteName: string;
  onClose: () => void;
};

type Geocode = { lat: number | null; lng: number | null; label: string };
type Point = { lat: number; lng: number };

type View = { lat: number; lng: number; zoom: number };

const TILE = 512;
const MIN_ZOOM = 13;
const MAX_ZOOM = 19;
// 画面用のタイルは17までしか中身が入っていないので、それ以上は拡大して見せる（出力は別に描き直す）
const MAX_TILE_ZOOM = 17;

function toWorld(lat: number, lng: number, zoom: number) {
  const scale = TILE * 2 ** zoom;
  const sine = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * scale,
  };
}

function fromWorld(x: number, y: number, zoom: number) {
  const scale = TILE * 2 ** zoom;
  return {
    lng: (x / scale) * 360 - 180,
    lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / scale))) * 180) / Math.PI,
  };
}

function TileMap({
  view,
  size,
  pin,
  onChange,
}: {
  view: View;
  size: { width: number; height: number };
  pin: Point;
  onChange: (next: View) => void;
}) {
  const drag = useRef<{ x: number; y: number } | null>(null);
  const tileZoom = Math.min(MAX_TILE_ZOOM, Math.max(0, Math.floor(view.zoom)));
  const ratio = 2 ** (view.zoom - tileZoom);
  const tileSize = TILE * ratio;
  const center = toWorld(view.lat, view.lng, tileZoom);
  const limit = 2 ** tileZoom;
  const halfW = size.width / 2 / ratio;
  const halfH = size.height / 2 / ratio;
  const tiles: { key: string; x: number; y: number; left: number; top: number }[] = [];
  if (size.width > 0 && size.height > 0) {
    const x0 = Math.floor((center.x - halfW) / TILE);
    const x1 = Math.floor((center.x + halfW) / TILE);
    const y0 = Math.floor((center.y - halfH) / TILE);
    const y1 = Math.floor((center.y + halfH) / TILE);
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        if (x < 0 || y < 0 || x >= limit || y >= limit) continue;
        tiles.push({
          key: `${tileZoom}/${x}/${y}`,
          x,
          y,
          left: size.width / 2 + (x * TILE - center.x) * ratio,
          top: size.height / 2 + (y * TILE - center.y) * ratio,
        });
      }
    }
  }
  const pinWorld = toWorld(pin.lat, pin.lng, view.zoom);
  const here = toWorld(view.lat, view.lng, view.zoom);
  const pinLeft = size.width / 2 + pinWorld.x - here.x;
  const pinTop = size.height / 2 + pinWorld.y - here.y;

  const zoomAt = (next: number, cx: number, cy: number) => {
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    if (zoom === view.zoom) return;
    const offX = cx - size.width / 2;
    const offY = cy - size.height / 2;
    const before = toWorld(view.lat, view.lng, view.zoom);
    const factor = 2 ** (zoom - view.zoom);
    const target = { x: (before.x + offX) * factor - offX, y: (before.y + offY) * factor - offY };
    onChange({ ...fromWorld(target.x, target.y, zoom), zoom });
  };

  return (
    <div
      className="absolute inset-0 touch-none select-none overflow-hidden bg-white"
      style={{ cursor: 'grab' }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const dx = event.clientX - drag.current.x;
        const dy = event.clientY - drag.current.y;
        drag.current = { x: event.clientX, y: event.clientY };
        onChange({ ...fromWorld(here.x - dx, here.y - dy, view.zoom), zoom: view.zoom });
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onWheel={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        zoomAt(view.zoom - event.deltaY / 400, event.clientX - box.left, event.clientY - box.top);
      }}
    >
      {tiles.map((tile) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={tile.key}
          src={`/api/map-mono?z=${tileZoom}&x=${tile.x}&y=${tile.y}`}
          alt=""
          draggable={false}
          style={{
            position: 'absolute',
            left: tile.left,
            top: tile.top,
            width: tileSize + 0.5,
            height: tileSize + 0.5,
            maxWidth: 'none',
          }}
        />
      ))}
      <div
        className="pointer-events-none absolute rounded-full bg-black"
        style={{ left: pinLeft - 9, top: pinTop - 9, width: 18, height: 18, boxShadow: '0 0 0 3px #fff' }}
      />
      <div className="absolute right-3 top-3 flex flex-col gap-2">
        {[
          { label: '+', delta: 0.5 },
          { label: '−', delta: -0.5 },
        ].map((item) => (
          <button
            key={item.label}
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => zoomAt(view.zoom + item.delta, size.width / 2, size.height / 2)}
            className="h-10 w-10 rounded-lg border-2 border-slate-800 bg-white text-xl font-black text-black"
            aria-label={item.delta > 0 ? '拡大' : '縮小'}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function WhiteMapDialog({ address, date, siteName, onClose }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });
  const [src, setSrc] = useState('');
  const [place, setPlace] = useState('');
  const [point, setPoint] = useState<Point | null>(null);
  const [status, setStatus] = useState('住所を探しています');
  const [saving, setSaving] = useState(false);
  const [phone, setPhone] = useState(false);
  const [layoutReady, setLayoutReady] = useState(false);
  const [view, setView] = useState<View | null>(null);

  const filePart = (value: string) => value.replace(/[\\/:*?"<>|\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
  const fileBase = [date || '日付なし', filePart(siteName) || '現場', filePart(address)].filter(Boolean).join('_');
  const pdfHref =
    point && mapSize.width > 0 && mapSize.height > 0
      ? `/api/map-pdf?lat=${point.lat}&lng=${point.lng}&w=${Math.round(mapSize.width)}&h=${Math.round(mapSize.height)}&file=${encodeURIComponent(fileBase)}`
      : '';

  useEffect(() => {
    let cancelled = false;
    setPoint(null);
    setView(null);
    setSrc('');

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
        `https://map.yahoo.co.jp/embedmap/V3/embedmap?lat=${found.lat}&lon=${found.lng}&zoom=17&cond=${cond}&width=1600&height=1200`
      );
      const label = found.label || address;
      setPlace(label);
      setPoint({ lat: found.lat, lng: found.lng });
      setView({ lat: found.lat, lng: found.lng, zoom: 17 });
      setStatus(label);
    }

    void load().catch(() => {
      if (!cancelled) setStatus('地図を開けませんでした');
    });

    return () => {
      cancelled = true;
    };
  }, [address]);

  useEffect(() => {
    const media = window.matchMedia('(pointer: coarse), (max-width: 1023px)');
    const apply = () => {
      setPhone(media.matches);
      setLayoutReady(true);
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const fit = () => {
      const bounds = map.getBoundingClientRect();
      setMapSize({ width: bounds.width, height: bounds.height });
      if (phone) return;
      const ratio = FRAME_W_MM / FRAME_H_MM;
      let width = bounds.width;
      let height = width / ratio;
      if (height > bounds.height) {
        height = bounds.height;
        width = height * ratio;
      }
      setFrame({ width, height });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(map);
    return () => observer.disconnect();
  }, [phone, src]);

  async function saveMap() {
    const sheet = frameRef.current;
    const map = mapRef.current;
    if (!sheet || !map || !point || !view || saving) return;
    setSaving(true);
    setStatus('印刷用の地図を作っています');
    try {
      const frameBox = sheet.getBoundingClientRect();
      const logicalW = Math.min(1280, Math.max(200, Math.round(frameBox.width)));
      const logicalH = Math.max(200, Math.round((logicalW * FRAME_H_MM) / FRAME_W_MM));
      const zoom = view.zoom + Math.log2(logicalW / frameBox.width);
      const params = new URLSearchParams({
        lat: String(view.lat),
        lng: String(view.lng),
        zoom: String(zoom),
        w: String(logicalW),
        h: String(logicalH),
        plat: String(point.lat),
        plng: String(point.lng),
      });
      const response = await fetch(`/api/map-image?${params}`);
      if (!response.ok) throw new Error('map');
      const blob = await response.blob();
      await downloadMapWord(blob, fileBase);
      setStatus(place || address);
    } catch {
      setStatus('ワードに出力できませんでした');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex h-dvh max-h-dvh flex-col bg-slate-950/50 p-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-lg font-black text-black">モノトーン地図</h2>
            <p className="truncate text-sm font-bold text-black">
              {status === place
                ? phone
                  ? `${fileBase}.pdf として開きます`
                  : '地図を動かして拡大縮小すると、枠の中がそのままA4横へ入ります'
                : status}
            </p>
          </div>
          <div className="hidden shrink-0 gap-2 min-[1024px]:flex">
            <button
              type="button"
              onClick={() => void saveMap()}
              disabled={!view || saving}
              className="h-10 rounded-xl bg-slate-900 px-3 font-bold text-white disabled:opacity-40"
            >
              ワードに出力
            </button>
            <button type="button" onClick={onClose} className="h-10 rounded-xl border-2 border-slate-700 px-3 font-black text-black">
              閉じる
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col bg-white">
          <p className="shrink-0 border-b border-slate-200 px-4 py-2 text-lg font-black text-black">{address}</p>
          <div ref={mapRef} className="relative min-h-0 flex-1 overflow-hidden bg-white">
            {src && layoutReady && phone ? (
              <iframe
                title={`${address}のヤフー地図`}
                src={src}
                style={{ filter: 'grayscale(1) contrast(1.7) brightness(0.92)' }}
                className="absolute -left-[260px] -top-[150px] h-[calc(100%+150px)] w-[calc(100%+260px)]"
              />
            ) : null}
            {layoutReady && !phone && view && point ? (
              <TileMap view={view} size={mapSize} pin={point} onChange={setView} />
            ) : null}
            {layoutReady && !phone ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div
                  ref={frameRef}
                  style={{
                    width: frame.width,
                    height: frame.height,
                    outline: '3px solid #0f172a',
                    boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.45)',
                  }}
                />
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 gap-2 border-t border-slate-200 p-3 min-[1024px]:hidden">
          <a
            href={pdfHref || undefined}
            target="_blank"
            rel="noopener"
            aria-disabled={!pdfHref}
            onClick={(event) => {
              if (!pdfHref) event.preventDefault();
            }}
            className={`flex h-12 flex-1 items-center justify-center rounded-xl bg-slate-900 font-black text-white ${pdfHref ? '' : 'pointer-events-none opacity-40'}`}
          >
            PDFに出力
          </a>
          <button type="button" onClick={onClose} className="h-12 rounded-xl border-2 border-slate-700 px-4 font-black text-black">
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

