'use client';

import React, { useEffect, useRef, useState } from 'react';
import { downloadMapPdf, downloadMapWord, FRAME_H_MM, FRAME_W_MM } from '@/lib/map-word';

type Props = {
  address: string;
  date: string;
  siteName: string;
  onClose: () => void;
};

type Geocode = { lat: number | null; lng: number | null; label: string };

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
  const [src, setSrc] = useState('');
  const [place, setPlace] = useState('');
  const [status, setStatus] = useState('住所を探しています');
  const [saving, setSaving] = useState(false);

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
        `https://map.yahoo.co.jp/embedmap/V3/embedmap?lat=${found.lat}&lon=${found.lng}&zoom=17&cond=${cond}&width=1600&height=1200`
      );
      const label = found.label || address;
      setPlace(label);
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
    const map = mapRef.current;
    if (!map) return;
    const fit = () => {
      const ratio = FRAME_W_MM / FRAME_H_MM;
      const bounds = map.getBoundingClientRect();
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
  }, []);

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
      const site = siteName.replace(/[\\/:*?"<>|\r\n]/g, ' ').replace(/\s+/g, ' ').trim() || '現場';
      const fileBase = `${date || '日付なし'}_${site}`;
      if (isPhone()) await downloadMapPdf(blob, fileBase);
      else await downloadMapWord(blob, fileBase);
      setStatus(place || address);
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      if (name === 'NotAllowedError' || name === 'AbortError') setStatus(place || address);
      else if (name === 'NotSupportedError') setStatus('Chrome または Edge で開くと出力できます');
      else if (name !== 'AbortError') setStatus(isPhone() ? 'PDFに出力できませんでした' : 'ワードに出力できませんでした');
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      bitmap?.close();
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[90] bg-slate-950/50 flex items-center justify-center p-2">
      <div className="bg-white w-full max-w-[1280px] h-[calc(100vh-1rem)] rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-extrabold">モノトーン地図</h2>
            <p className="text-xs font-bold text-slate-500 truncate">
              {status === place ? '枠の中が、比率を変えずにA4横へ入ります' : status}
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void saveMap()}
              disabled={!src || saving}
              className="h-10 px-3 rounded-xl bg-slate-900 text-white font-bold disabled:opacity-40"
            >
              {isPhone() ? 'PDFに出力' : 'ワードに出力'}
            </button>
            <button type="button" onClick={onClose} className="h-10 px-3 rounded-xl border border-slate-300 font-bold">
              閉じる
            </button>
          </div>
        </div>
        <div className="flex flex-col flex-1 min-h-0 bg-white">
          <p className="px-4 py-2 border-b border-slate-200 text-base font-extrabold">{address}</p>
          <div ref={mapRef} className="relative flex-1 min-h-0 overflow-hidden bg-white">
            {src ? (
              <iframe
                title={`${address}のヤフー地図`}
                src={src}
                className="absolute top-0 -left-[260px] h-full w-[calc(100%+260px)] max-[1023px]:left-0 max-[1023px]:top-[-150px] max-[1023px]:h-[calc(100%+150px)] max-[1023px]:w-full"
              />
            ) : null}
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
          </div>
        </div>
      </div>
    </div>
  );
}

function isPhone() {
  return window.matchMedia('(pointer: coarse), (max-width: 1023px)').matches;
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
