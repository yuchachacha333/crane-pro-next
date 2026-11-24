'use client';

import { useEffect, useMemo, useState } from 'react';
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
 * 指定用紙の請求書を表示・印刷・PDF化する。
 * この端末にExcel受付があれば、Excelで作ったPDFをそのまま使う。
 * 無ければ、ブラウザの中だけで簡易に作る。
 */
export default function TemplateInvoice({
  layouts,
  title,
  excelPdf,
  gmail,
  onClose,
}: {
  layouts: SheetLayout[];
  title: string;
  /** Excelで作ったPDF。あれば、それを表示・印刷する */
  excelPdf?: File | null;
  /** 指定があるときは、PDFを保存してからGmailを開く */
  gmail?: { href: string; popup: Window | null };
  onClose: () => void;
}) {
  const [made, setMade] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const excelUrl = useMemo(() => (excelPdf ? URL.createObjectURL(excelPdf) : ''), [excelPdf]);
  const file = excelPdf || made;

  useEffect(() => () => {
    if (excelUrl) URL.revokeObjectURL(excelUrl);
  }, [excelUrl]);

  useEffect(() => {
    let cancelled = false;
    const finish = (pdf: File) => {
      if (gmail) {
        saveFile(pdf);
        if (gmail.popup && !gmail.popup.closed) gmail.popup.location.href = gmail.href;
        setMessage('PDFを保存しました。Gmailで、保存した「' + pdf.name + '」を添付してから送信してください。');
      }
    };
    if (excelPdf) {
      finish(excelPdf);
      return;
    }
    const timer = window.setTimeout(() => {
      createSheetFile(title)
        .then((pdf) => {
          if (cancelled) return;
          if (!pdf) {
            setError('請求書のPDFを作れませんでした');
            gmail?.popup?.close();
            return;
          }
          setMade(pdf);
          finish(pdf);
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
  }, [layouts, excelPdf]);

  function print() {
    if (excelUrl) {
      const popup = window.open(excelUrl, 'satsuma-print');
      if (!popup) {
        setError('印刷画面を開けませんでした。ブラウザのポップアップを許可してください。');
        return;
      }
      window.setTimeout(() => {
        popup.focus();
        popup.print();
      }, 700);
      return;
    }
    printSheetPages(made, title);
  }

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
          <button type="button" onClick={print} className="h-10 px-4 rounded-lg bg-white font-extrabold text-slate-800">
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
        {!excelPdf && (
          <p className="mb-3 text-center text-xs font-bold text-slate-600">
            このパソコンにはExcel受付が入っていないため、簡易表示です。Excelの用紙どおりにするには、請求画面の「Excel受付を入れる」を一度だけ行ってください。
          </p>
        )}
        {excelPdf ? (
          <iframe title="請求書" src={excelUrl} className="mx-auto h-[85vh] w-full max-w-4xl rounded-xl bg-white" />
        ) : (
          layouts.map((layout, index) => (
            <FitPages key={index}>
              <LayoutSheet layout={layout} />
            </FitPages>
          ))
        )}
      </div>
    </div>
  );
}
