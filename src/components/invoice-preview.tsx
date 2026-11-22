'use client';

import { useEffect, useState } from 'react';
import { createSheetFile, FitPages, LayoutSheet, printSheetPages, shareSheetPages } from '@/components/print-preview';
import { fillInvoiceLayout, type InvoiceCustomer, type InvoiceLine } from '@/lib/invoice-sheet';
import type { SheetLayout } from '@/lib/sheet-layout';

export default function InvoicePreview({
  customer,
  lines,
  onClose,
}: {
  customer: InvoiceCustomer;
  lines: InvoiceLine[];
  onClose: () => void;
}) {
  const [layout, setLayout] = useState<SheetLayout | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [shareFile, setShareFile] = useState<File | null>(null);

  const requestKey = JSON.stringify({ customer, lines });

  useEffect(() => {
    let cancelled = false;
    const request = JSON.parse(requestKey) as { customer: InvoiceCustomer; lines: InvoiceLine[] };
    fetch(`/api/print/layout?file=${encodeURIComponent('自社請求書.xlsx')}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || '請求書のひな形を読めませんでした');
        if (cancelled) return;
        const filled = fillInvoiceLayout(body.layout as SheetLayout, request.lines, request.customer);
        setLayout(filled.layout);
        setNote(filled.omitted ? `${filled.omitted}件は欄が足りず印字していません。合計は全件です。` : filled.warning);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || '請求書のひな形を読めませんでした');
      });
    return () => {
      cancelled = true;
    };
  }, [requestKey]);

  useEffect(() => {
    if (!layout) return;
    let cancelled = false;
    setShareFile(null);
    const timer = window.setTimeout(() => {
      createSheetFile('請求書').then((file) => {
        if (!cancelled) setShareFile(file);
      }).catch(() => undefined);
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [layout]);

  return (
    <div className="fixed inset-0 z-[60] overflow-auto bg-slate-300">
      <div className="no-print sticky top-0 z-10 flex items-center justify-between gap-3 bg-slate-900 px-4 py-3 text-white">
        <div className="font-extrabold">請求書　{customer.name}</div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={printSheetPages} className="h-10 px-4 rounded-lg bg-teal-500 font-extrabold text-slate-950">
            印刷
          </button>
          <button
            type="button"
            onClick={() => shareSheetPages('請求書', shareFile).catch(() => undefined)}
            className="h-10 px-4 rounded-lg bg-white font-extrabold text-slate-800 disabled:opacity-50"
            disabled={!shareFile}
          >
            {shareFile ? '共有' : '準備中'}
          </button>
          <button type="button" onClick={onClose} className="h-10 px-4 rounded-lg bg-white font-extrabold text-slate-800">
            閉じる
          </button>
        </div>
      </div>
      <div className="px-4 py-6">
        {note && <p className="mb-3 text-center text-sm font-bold text-amber-800">{note}</p>}
        {error && <p className="text-center font-bold text-rose-700">{error}</p>}
        {!layout && !error && <p className="text-center font-bold text-slate-700">請求書のひな形を読み込んでいます。</p>}
        {layout && (
          <FitPages>
            <LayoutSheet layout={layout} clip />
          </FitPages>
        )}
      </div>
    </div>
  );
}
