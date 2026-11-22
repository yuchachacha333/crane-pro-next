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

type CaptureTrack = MediaStreamTrack & {
  restrictTo?: (target: unknown) => Promise<void>;
};

type CaptureOptions = DisplayMediaStreamOptions & {
  preferCurrentTab?: boolean;
  selfBrowserSurface?: 'include' | 'exclude';
  surfaceSwitching?: 'include' | 'exclude';
  monitorTypeSurfaces?: 'include' | 'exclude';
};

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

  const filePart = (value: string) => value.replace(/[\\/:*?"<>|\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
  const fileBase = [date || '日付なし', filePart(siteName) || '現場', filePart(address)].filter(Boolean).join('_');
  const pdfHref =
    point && mapSize.width > 0 && mapSize.height > 0
      ? `/api/map-pdf?lat=${point.lat}&lng=${point.lng}&w=${Math.round(mapSize.width)}&h=${Math.round(mapSize.height)}&file=${encodeURIComponent(fileBase)}`
      : '';

  useEffect(() => {
    let cancelled = false;
    setPoint(null);
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
    if (!sheet || !src || saving) return;
    setSaving(true);
    setStatus('表示された画面で、このタブを選んでください');
    let stream: MediaStream | undefined;
    let bitmap: ImageBitmap | undefined;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        surfaceSwitching: 'exclude',
        monitorTypeSurfaces: 'exclude',
      } as CaptureOptions);
      const [track] = stream.getVideoTracks() as CaptureTrack[];
      const surface = track.getSettings().displaySurface;
      if (surface && surface !== 'browser') {
        setStatus('「このタブ」を選ぶと、地図だけ保存できます');
        return;
      }
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();
      const Restriction = (window as unknown as {
        RestrictionTarget?: { fromElement: (element: Element) => Promise<unknown> };
      }).RestrictionTarget;
      if (Restriction && track.restrictTo) {
        try {
          const target = await Restriction.fromElement(sheet);
          await track.restrictTo(target);
        } catch {
          // 範囲指定できないブラウザは、あとで地図の位置だけ切り出す
        }
      }
      await new Promise((resolve) => window.setTimeout(resolve, 400));
      bitmap = await createImageBitmap(video);
      const canvas = cropMap(bitmap, sheet);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('empty');
      await downloadMapWord(blob, fileBase);
      setStatus(place || address);
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      if (name === 'NotAllowedError' || name === 'AbortError') setStatus(place || address);
      else if (name === 'NotSupportedError') setStatus('Chrome または Edge で開くと出力できます');
      else setStatus('ワードに出力できませんでした');
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      bitmap?.close();
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
                  : '枠の中が、比率を変えずにA4横へ入ります'
                : status}
            </p>
          </div>
          <div className="hidden shrink-0 gap-2 min-[1024px]:flex">
            <button
              type="button"
              onClick={() => void saveMap()}
              disabled={!src || saving}
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
            {src && layoutReady ? (
              <iframe
                title={`${address}のヤフー地図`}
                src={src}
                style={{ filter: 'grayscale(1) contrast(1.7) brightness(0.92)' }}
                className={
                  phone
                    ? 'absolute -left-[260px] -top-[150px] h-[calc(100%+150px)] w-[calc(100%+260px)]'
                    : 'absolute top-0 -left-[260px] h-full w-[calc(100%+260px)]'
                }
              />
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

function cropMap(bitmap: ImageBitmap, sheet: HTMLElement) {
  const rect = sheet.getBoundingClientRect();
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  const expected = rect.width * (window.devicePixelRatio || 1);
  if (bitmap.width > expected * 1.6) {
    const scaleX = bitmap.width / window.innerWidth;
    const scaleY = bitmap.height / window.innerHeight;
    canvas.width = Math.max(1, Math.round(rect.width * scaleX));
    canvas.height = Math.max(1, Math.round(rect.height * scaleY));
    context.drawImage(
      bitmap,
      rect.left * scaleX,
      rect.top * scaleY,
      rect.width * scaleX,
      rect.height * scaleY,
      0,
      0,
      canvas.width,
      canvas.height
    );
    return canvas;
  }
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  context.drawImage(bitmap, 0, 0);
  return canvas;
}
