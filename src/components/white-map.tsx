'use client';

import React, { useEffect, useRef, useState } from 'react';
import { buildVisibleMapPdf, downloadMapWord, FRAME_H_MM, FRAME_W_MM, saveNamedFile } from '@/lib/map-word';

type Props = {
  address: string;
  date: string;
  siteName: string;
  onClose: () => void;
};

type Geocode = { lat: number | null; lng: number | null; label: string };
type Point = { lat: number; lng: number };
type View = Point & { zoom: number };
type ReadyPdf = { name: string; file: File };

type CaptureTrack = MediaStreamTrack & {
  restrictTo?: (target: unknown) => Promise<void>;
};

type CaptureOptions = DisplayMediaStreamOptions & {
  preferCurrentTab?: boolean;
  selfBrowserSurface?: 'include' | 'exclude';
  surfaceSwitching?: 'include' | 'exclude';
  monitorTypeSurfaces?: 'include' | 'exclude';
};

const tileCache = new Map<string, Promise<HTMLImageElement | null>>();
let paintSerial = 0;

export default function WhiteMapDialog({ address, date, siteName, onClose }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ x: number; y: number; lat: number; lng: number; zoom: number } | null>(null);
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [src, setSrc] = useState('');
  const [place, setPlace] = useState('');
  const [point, setPoint] = useState<Point | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [shift, setShift] = useState({ x: 0, y: 0 });
  const [mapReady, setMapReady] = useState(false);
  const [status, setStatus] = useState('住所を探しています');
  const [saving, setSaving] = useState(false);
  const [phone, setPhone] = useState(false);
  const [layoutReady, setLayoutReady] = useState(false);
  const [pdfFile, setPdfFile] = useState<ReadyPdf | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPoint(null);
    setView(null);
    setPdfFile(null);
    setMapReady(false);

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
    if (!map || phone) return;
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
  }, [phone]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!phone || !canvas || !view || !point) return;
    let cancelled = false;
    const finish = (drawn: boolean | null) => {
      if (cancelled || drawn == null) return;
      setMapReady(drawn);
      if (!drawn) setStatus('地図を描けませんでした');
    };
    const timer = window.setTimeout(() => {
      void paintMonoMap(canvas, view, point).then(finish);
    }, 80);
    const observer = new ResizeObserver(() => {
      void paintMonoMap(canvas, view, point).then(finish);
    });
    observer.observe(canvas);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [phone, point, view]);

  function fileBase() {
    const site = siteName.replace(/[\\/:*?"<>|\r\n]/g, ' ').replace(/\s+/g, ' ').trim() || '現場';
    return `${date || '日付なし'}_${site}`;
  }

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
      await downloadMapWord(blob, fileBase());
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

  async function savePhonePdf() {
    const canvas = canvasRef.current;
    if (!canvas || !mapReady || saving) return;
    setSaving(true);
    setStatus('PDFを作っています');
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('empty');
      const name = `${fileBase()}.pdf`;
      const file = await buildVisibleMapPdf(blob, fileBase(), canvas.width, canvas.height);
      setPdfFile({ name: file.name || name, file });
      saveNamedFile(file, file.name || name);
      setStatus(`${file.name || name} を保存しました`);
    } catch {
      setStatus('PDFにできませんでした');
    } finally {
      setSaving(false);
    }
  }

  async function handPdf() {
    if (!pdfFile) return;
    if (navigator.canShare?.({ files: [pdfFile.file] })) {
      try {
        await navigator.share({ files: [pdfFile.file], title: pdfFile.name });
        setStatus(`${pdfFile.name} を渡しました`);
        return;
      } catch (error) {
        const name = error instanceof DOMException ? error.name : '';
        if (name === 'AbortError') {
          setStatus('保存をやめました');
          return;
        }
      }
    }
    saveNamedFile(pdfFile.file, pdfFile.name);
    setStatus(`${pdfFile.name} を保存しました`);
  }

  function moveView(nextZoom: number) {
    if (!view) return;
    setPdfFile(null);
    setView({ ...view, zoom: Math.min(18, Math.max(14, nextZoom)) });
  }

  return (
    <div className="fixed inset-0 z-[90] bg-slate-950/50 flex items-center justify-center p-2">
      <div className="bg-white w-full max-w-[1280px] h-[calc(100vh-1rem)] rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-extrabold">モノトーン地図</h2>
            <p className="text-xs font-bold text-slate-800 truncate">
              {status === place
                ? phone
                  ? '見えている地図を、日付_現場名.pdf にします'
                  : '枠の中が、比率を変えずにA4横へ入ります'
                : status}
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void (phone ? savePhonePdf() : saveMap())}
              disabled={phone ? !mapReady || saving : !src || saving}
              className="h-10 px-3 rounded-xl bg-slate-900 text-white font-bold disabled:opacity-40"
            >
              {phone ? 'PDFに出力' : 'ワードに出力'}
            </button>
            <button type="button" onClick={onClose} className="h-10 px-3 rounded-xl border border-slate-300 font-bold">
              閉じる
            </button>
          </div>
        </div>
        {pdfFile && (
          <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between gap-3">
            <p className="min-w-0 text-sm font-black break-all">{pdfFile.name}</p>
            <button type="button" onClick={() => void handPdf()} className="h-11 px-3 rounded-xl bg-white text-black font-black shrink-0">
              このPDFを保存
            </button>
          </div>
        )}
        <div className="flex flex-col flex-1 min-h-0 bg-white">
          <p className="px-4 py-2 border-b border-slate-200 text-base font-extrabold">{address}</p>
          <div ref={mapRef} className="relative flex-1 min-h-0 overflow-hidden bg-white">
            {layoutReady && phone ? (
              <>
                <canvas
                  ref={canvasRef}
                  className="absolute inset-0 h-full w-full touch-none"
                  style={{ transform: `translate(${shift.x}px, ${shift.y}px)` }}
                  onPointerDown={(event) => {
                    if (!view) return;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    dragRef.current = { x: event.clientX, y: event.clientY, lat: view.lat, lng: view.lng, zoom: view.zoom };
                  }}
                  onPointerMove={(event) => {
                    const drag = dragRef.current;
                    if (!drag) return;
                    setShift({ x: event.clientX - drag.x, y: event.clientY - drag.y });
                  }}
                  onPointerUp={(event) => {
                    const drag = dragRef.current;
                    dragRef.current = null;
                    setShift({ x: 0, y: 0 });
                    if (!drag) return;
                    const dx = event.clientX - drag.x;
                    const dy = event.clientY - drag.y;
                    if (Math.abs(dx) + Math.abs(dy) < 4) return;
                    const origin = project(drag.lat, drag.lng, drag.zoom);
                    const next = unproject(origin.x - dx, origin.y - dy, drag.zoom);
                    setPdfFile(null);
                    setView({ lat: next.lat, lng: next.lng, zoom: drag.zoom });
                  }}
                />
                <div className="absolute right-3 bottom-3 flex flex-col gap-2">
                  <button type="button" onClick={() => moveView((view?.zoom || 17) + 1)} className="h-11 w-11 rounded-xl bg-white border border-slate-400 font-black">
                    +
                  </button>
                  <button type="button" onClick={() => moveView((view?.zoom || 17) - 1)} className="h-11 w-11 rounded-xl bg-white border border-slate-400 font-black">
                    −
                  </button>
                </div>
              </>
            ) : src && layoutReady ? (
              <iframe
                title={`${address}のヤフー地図`}
                src={src}
                className="absolute top-0 -left-[260px] h-full w-[calc(100%+260px)]"
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
      </div>
    </div>
  );
}

function project(lat: number, lng: number, zoom: number) {
  const scale = 256 * 2 ** zoom;
  const x = ((lng + 180) / 360) * scale;
  const sine = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * scale;
  return { x, y };
}

function unproject(x: number, y: number, zoom: number) {
  const scale = 256 * 2 ** zoom;
  const lng = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return { lat, lng };
}

function loadTile(zoom: number, x: number, y: number) {
  const key = `${zoom}/${x}/${y}`;
  const cached = tileCache.get(key);
  if (cached) return cached;
  const pending = (async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const image = await new Promise<HTMLImageElement | null>((resolve) => {
        const element = new Image();
        element.onload = () => resolve(element.naturalWidth > 0 ? element : null);
        element.onerror = () => resolve(null);
        element.src = `/api/map-tile?z=${zoom}&x=${x}&y=${y}&n=${attempt}`;
      });
      if (image) return image;
      await new Promise((resolve) => window.setTimeout(resolve, 300));
    }
    tileCache.delete(key);
    return null;
  })();
  tileCache.set(key, pending);
  return pending;
}

async function paintMonoMap(canvas: HTMLCanvasElement, view: View, pin: Point) {
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (cssW < 2 || cssH < 2) return null;
  const serial = ++paintSerial;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const context = canvas.getContext('2d');
  if (!context) return false;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, cssW, cssH);
  const center = project(view.lat, view.lng, view.zoom);
  const left = center.x - cssW / 2;
  const top = center.y - cssH / 2;
  const x0 = Math.floor(left / 256);
  const y0 = Math.floor(top / 256);
  const x1 = Math.floor((left + cssW) / 256);
  const y1 = Math.floor((top + cssH) / 256);
  const tiles: { x: number; y: number; image: HTMLImageElement }[] = [];
  for (let x = x0; x <= x1; x += 1) {
    for (let y = y0; y <= y1; y += 1) {
      const image = await loadTile(view.zoom, x, y);
      if (image) tiles.push({ x, y, image });
    }
  }
  if (serial !== paintSerial) return null;
  if (tiles.length === 0) return false;
  for (const tile of tiles) {
    context.drawImage(tile.image, tile.x * 256 - left, tile.y * 256 - top, 256, 256);
  }
  const snap = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = snap.data;
  for (let index = 0; index < pixels.length; index += 4) {
    const gray = pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
    const ink = gray < 200 ? gray * 0.65 : 255 - (255 - gray) * 0.2;
    pixels[index] = ink;
    pixels[index + 1] = ink;
    pixels[index + 2] = ink;
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.putImageData(snap, 0, 0);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  const mark = project(pin.lat, pin.lng, view.zoom);
  context.beginPath();
  context.arc(mark.x - left, mark.y - top, 9, 0, Math.PI * 2);
  context.fillStyle = '#111111';
  context.strokeStyle = '#ffffff';
  context.lineWidth = 3;
  context.fill();
  context.stroke();
  return true;
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
