'use client';

import { useEffect, useState } from 'react';
import { createSheetFile, FitPages, LayoutSheet, printSheetPages } from '@/components/print-preview';
import type { SheetLayout } from '@/lib/sheet-layout';

function saveFile(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * 指定用紙の請求書を、このブラウザの中だけで表示・印刷・PDF化する。
 * Excelも、パソコンへの追加プログラムも使わない。
 */
export default function TemplateInvoice({
  layouts,
  title,
  gmail,
  onClose,
}: {
  layouts: SheetLayout[];
  title: string;
  /** 指定があるときは、PDFを保存してからGmailを開く */
  gmail?: { href: string; popup: Window | null };
  onClose: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      createSheetFile(title)
        .then((made) => {
          if (cancelled) return;
          if (!made) {
            setError('請求書のPDFを作れませんでした');
            gmail?.popup?.close();
            return;
          }
          setFile(made);
          if (gmail) {
            saveFile(made);
            if (gmail.popup && !gmail.popup.closed) gmail.popup.location.href = gmail.href;
            setMessage('PDFを保存しました。Gmailで、保存した「' + made.name + '」を添付してから送信してください。');
          }
        })
        .catch(() => {
          if (cancelled) return;
          setError('請求書のPDFを作れませんでした');
          gmail?.popup?.close();
        });
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // 表示するたびに1回だけ作る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layouts]);

  return (
    <div className="fixed inset-0 z-[200] overflow-auto bg-slate-300">
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 bg-slate-900 px-4 py-3 text-white">
        <div className="font-extrabold">{title}</div>
        <div className="flex flex-wrap items-center gap-2">
          {gmail && (
            <a
              href={gmail.href}
              target="_blank"
              rel="noopener noreferrer"
              className="h-10 px-4 inline-flex items-center rounded-lg bg-teal-500 font-extrabold text-slate-950"
            >
              Gmailを開く
            </a>
          )}
          <button
            type="button"
            onClick={() => printSheetPages(file, title)}
            className="h-10 px-4 rounded-lg bg-white font-extrabold text-slate-800"
          >
            印刷
          </button>
          <button
            type="button"
            disabled={!file}
            onClick={() => file && saveFile(file)}
            className="h-10 px-4 rounded-lg bg-white font-extrabold text-slate-800 disabled:opacity-60"
          >
            PDFを保存
          </button>
          <button type="button" onClick={onClose} className="h-10 px-4 rounded-lg bg-white font-extrabold text-slate-800">
            閉じる
          </button>
        </div>
      </div>
      <div className="px-4 py-6">
        {message && <p className="mb-3 text-center text-sm font-bold text-teal-900">{message}</p>}
        {error && <p className="mb-3 text-center text-sm font-bold text-rose-700">{error}</p>}
        {layouts.map((layout, index) => (
          <FitPages key={index}>
            <LayoutSheet layout={layout} />
          </FitPages>
        ))}
      </div>
    </div>
  );
}
