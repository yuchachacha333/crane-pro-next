'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import type { SheetCell, SheetEdges, SheetLayout } from '@/lib/sheet-layout';
import { getRokuyo, getTodayIso, getWeekday } from '@/lib/crane-utils';
import { toHalfwidthTime } from '@/lib/time-text';

export type PrintKind = 'board' | 'instruction' | 'request';

export type PrintJob = {
  id: string;
  work_date: string;
  customer_name: string;
  site_name: string;
  site_address: string;
  site_code: string;
  requested_model: string;
  assigned_product: string;
  operator_name: string;
  supplier_name: string;
  entry_time: string;
  contact_name: string;
  contact_tel: string;
  notes: string;
  is_cancelled: boolean;
};

type SiteHit = { code: string; name: string; address: string };

const FILES: Record<PrintKind, string> = {
  board: '配車表.xlsx',
  instruction: '作業指示書.xlsx',
  request: '配車依頼書.xlsx',
};

const TITLES: Record<PrintKind, string> = {
  board: '配車表',
  instruction: '作業指示書',
  request: '配車依頼書',
};

function bookLabel(iso: string) {
  const match = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return iso || '';
  return `${Number(match[2])}月${Number(match[3])}日（${getWeekday(iso)}）${getRokuyo(iso)}`;
}

function createdLabel(iso: string) {
  const match = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return iso || '';
  return `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日(${getWeekday(iso)})`;
}

function workLabel(iso: string) {
  const match = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return iso || '';
  const rokuyo = getRokuyo(iso);
  return `${Number(match[2])}/${Number(match[3])}（${getWeekday(iso)}）${rokuyo ? ` ${rokuyo}` : ''}`;
}

function plainName(value: string) {
  return String(value || '')
    .replace(/株式会社|有限会社|㈱|㈲|（株）|（有）|\(株\)|\(有\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function clockLabel(value: string) {
  return toHalfwidthTime(value);
}

function minutes(value: string) {
  const text = toHalfwidthTime(value);
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 24 * 60 + 1;
  return Number(match[1]) * 60 + Number(match[2]);
}

function columnField(text: string) {
  const value = String(text || '').replace(/\s+/g, '');
  if (value.includes('お客様')) return 'customer';
  if (value.includes('現場')) return 'site';
  if (value.includes('機種')) return 'machine';
  if (value.includes('着')) return 'time';
  if (value.includes('備考')) return 'note';
  if (value.includes('オペレータ') || value.includes('庸車')) return 'who';
  return '';
}

function customerTone(name: string) {
  const text = String(name || '').replace(/[\s\u3000]+/g, '');
  if (text.includes('住友林業ホームエンジニアリング')) return '#f8d0dc';
  if (text.includes('東栄住宅千葉施工3課')) return '#ffb04a';
  if (text.includes('東栄住宅千葉施工2課')) return '#ffe566';
  return '';
}

function bookCss(cell: SheetCell, scale: number) {
  const valign = cell.valign === 'center' ? 'middle' : cell.valign === 'top' ? 'top' : 'bottom';
  const align = cell.align === 'center' || cell.align === 'right' ? cell.align : 'left';
  return {
    fontSize: `${(Number(cell.size) * scale) / 100}pt`,
    fontWeight: cell.bold ? 700 : 400,
    textAlign: align as 'left' | 'center' | 'right',
    verticalAlign: valign as 'middle' | 'top' | 'bottom',
    border: cell.border ? '0.75pt solid #000' : '0',
    whiteSpace: cell.wrap ? ('pre-wrap' as const) : ('nowrap' as const),
    padding: '0.3mm 1mm',
    lineHeight: 1.15,
  };
}

function edgeWidth(style: string) {
  if (!style || style === 'none') return '0';
  const width = style === 'medium' || style === 'thick' ? '1.5pt' : '0.6pt';
  return `${width} solid #000`;
}

function formEdges(cell: SheetCell | null | undefined): SheetEdges {
  if (cell?.edges) return cell.edges;
  const on = cell?.border ? 'thin' : '';
  return { left: on, right: on, top: on, bottom: on };
}

function strongerEdge(a: string, b: string) {
  const rank = (style: string) => {
    if (!style || style === 'none') return 0;
    if (style === 'thick') return 3;
    if (style === 'medium') return 2;
    return style ? 1 : 0;
  };
  return rank(a) >= rank(b) ? a || '' : b || '';
}

function outerEdges(layout: SheetLayout, merge: { r: number; c: number; rows: number; cols: number }) {
  const edges = { left: '', right: '', top: '', bottom: '' };
  const at = (r: number, c: number) => layout.rows[r]?.cells?.[c] || null;
  for (let c = 0; c < merge.cols; c++) {
    edges.top = strongerEdge(edges.top, formEdges(at(merge.r, merge.c + c)).top);
    edges.bottom = strongerEdge(edges.bottom, formEdges(at(merge.r + merge.rows - 1, merge.c + c)).bottom);
  }
  for (let r = 0; r < merge.rows; r++) {
    edges.left = strongerEdge(edges.left, formEdges(at(merge.r + r, merge.c)).left);
    edges.right = strongerEdge(edges.right, formEdges(at(merge.r + r, merge.c + merge.cols - 1)).right);
  }
  return edges;
}

function fillText(text: string, values: Record<string, string>) {
  return String(text || '').replace(/\{\{([^}]+)\}\}/g, (_, name: string) => {
    const value = values[String(name).trim()];
    return value == null ? '' : String(value);
  });
}

function siteAddress(job: PrintJob, sites: SiteHit[]) {
  if (job.site_address) return job.site_address;
  const hit = sites.find(
    (site) => (job.site_code && site.code === job.site_code) || (job.site_name && site.name === job.site_name)
  );
  return hit?.address || '';
}

function formValues(job: PrintJob, sites: SiteHit[]) {
  let machine = job.requested_model || '';
  if (!machine && job.assigned_product && job.assigned_product !== '庸車') machine = job.assigned_product;
  return {
    オペレーター: job.operator_name || '',
    作業日: workLabel(job.work_date),
    入場時間: clockLabel(job.entry_time),
    受付機種: machine,
    得意先名: job.customer_name || '',
    現場名: job.site_name || '',
    現場住所: siteAddress(job, sites),
    担当者: String(job.contact_name || '').replace(/様$/, '').trim(),
    携帯電話: job.contact_tel || '',
    備考: job.notes || '',
    庸車: job.supplier_name || '',
  };
}

function SheetSpill({ cell, text }: { cell: SheetCell; text: string }) {
  if (!text || cell.wrap) return <>{text}</>;
  const align = cell.align === 'center' || cell.align === 'right' ? cell.align : 'left';
  const middle = cell.valign === 'center';
  const style: CSSProperties = {
    position: 'absolute',
    whiteSpace: 'pre',
    width: 'max-content',
    zIndex: 2,
    left: align === 'right' ? 'auto' : align === 'center' ? '50%' : '1mm',
    right: align === 'right' ? '1mm' : 'auto',
    top: middle ? '50%' : cell.valign === 'top' ? '0.2mm' : 'auto',
    bottom: !middle && cell.valign !== 'top' ? '0.2mm' : 'auto',
    transform:
      align === 'center' && middle
        ? 'translate(-50%, -50%)'
        : align === 'center'
          ? 'translateX(-50%)'
          : middle
            ? 'translateY(-50%)'
            : undefined,
  };
  return <span style={style}>{text}</span>;
}

function FormPage({
  layout,
  job,
  sites = [],
  raw = false,
}: {
  layout: SheetLayout;
  job?: PrintJob;
  sites?: SiteHit[];
  raw?: boolean;
}) {
  const scale = Number(layout.scale) || 100;
  const values = raw || !job ? {} : formValues(job, sites);
  const today = raw ? '' : createdLabel(getTodayIso());
  const at: Record<number, number> = {};
  layout.rows.forEach((row, index) => {
    at[row.n || index + 1] = index;
  });
  const cover: Record<string, boolean> = {};
  const span: Record<string, { r: number; c: number; rows: number; cols: number }> = {};
  for (const merge of layout.merges || []) {
    const index = at[merge.r + 1];
    if (index == null) continue;
    const placed = { r: index, c: merge.c, rows: merge.rows, cols: merge.cols };
    span[`${index}:${merge.c}`] = placed;
    for (let r = 0; r < merge.rows; r++) {
      const rowIndex = at[merge.r + 1 + r];
      if (rowIndex == null) continue;
      for (let c = 0; c < merge.cols; c++) {
        if (rowIndex === index && !c) continue;
        cover[`${rowIndex}:${merge.c + c}`] = true;
      }
    }
  }
  const widths = layout.cols || [];
  const total = widths.reduce((sum, width) => sum + Number(width || 0), 0) || 1;
  const margin = layout.margin || { top: 12, right: 10, bottom: 12, left: 10 };
  return (
    <article
      className="dispatch-page"
      data-orient={layout.orientation === 'landscape' ? 'landscape' : 'portrait'}
      style={{
        width: layout.orientation === 'landscape' ? '297mm' : '210mm',
        minHeight: layout.orientation === 'landscape' ? '210mm' : '297mm',
        margin: '0 auto 16px',
        background: '#fff',
        color: '#000',
        padding: `${margin.top}mm ${margin.right}mm ${margin.bottom}mm ${margin.left}mm`,
        boxSizing: 'border-box',
        boxShadow: '0 8px 28px rgba(0,0,0,.18)',
        fontFamily: '"Yu Gothic","Yu Gothic UI","Hiragino Sans",Meiryo,sans-serif',
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', overflow: 'visible' }}>
        <colgroup>
          {widths.map((width, index) => (
            <col key={index} style={{ width: `${(Number(width) / total) * 100}%` }} />
          ))}
        </colgroup>
        <tbody>
          {layout.rows.map((row, index) => (
            <tr key={row.n} style={row.height ? { height: `${(Number(row.height) * scale) / 100}pt` } : undefined}>
              {row.cells.map((cell, col) => {
                if (cover[`${index}:${col}`]) return null;
                const merge = span[`${index}:${col}`];
                const edges = merge ? outerEdges(layout, merge) : formEdges(cell);
                let text = raw ? cell.text || '' : fillText(cell.text || '', values);
                if (!raw && /^\d{4}年\d{1,2}月\d{1,2}日/.test(text)) text = today;
                const flow = cell.wrap
                  ? { whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const }
                  : { whiteSpace: 'pre' as const, overflow: 'visible', wordBreak: 'normal' as const };
                return (
                  <td
                    key={col}
                    colSpan={merge && merge.cols > 1 ? merge.cols : undefined}
                    rowSpan={merge && merge.rows > 1 ? merge.rows : undefined}
                    style={{
                      ...bookCss({ ...cell, border: false, wrap: false }, scale),
                      borderLeft: edgeWidth(edges.left),
                      borderRight: edgeWidth(edges.right),
                      borderTop: edgeWidth(edges.top),
                      borderBottom: edgeWidth(edges.bottom),
                      ...flow,
                      position: text && !cell.wrap ? 'relative' : undefined,
                      overflow: text && !cell.wrap ? 'visible' : undefined,
                    }}
                  >
                    <SheetSpill cell={cell} text={text} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}

function BoardPage({ layout, jobs, date }: { layout: SheetLayout; jobs: PrintJob[]; date: string }) {
  const scale = Number(layout.scale) || 100;
  const ordered = [...jobs].sort((a, b) => minutes(a.entry_time) - minutes(b.entry_time));
  const mapped = ordered.map((job) => ({
    customer: plainName(job.customer_name),
    site: plainName(job.site_name),
    machine: plainName(job.requested_model || (job.assigned_product !== '庸車' ? job.assigned_product : '')),
    who: plainName(job.operator_name || job.supplier_name || ''),
    time: clockLabel(job.entry_time),
    note: plainName(job.notes),
    cancelled: job.is_cancelled,
  }));
  let fields: string[] = [];
  let headerIndex = -1;
  layout.rows.some((row, index) => {
    const names = (row.cells || []).map((cell) => columnField(cell.text));
    if (!names.includes('customer')) return false;
    fields = names;
    headerIndex = index;
    return true;
  });
  let slot = 0;
  let dataSlots = 0;
  layout.rows.forEach((row, index) => {
    if (index > headerIndex && headerIndex >= 0 && (row.cells || []).some((cell) => cell.border)) dataSlots += 1;
  });
  const widths = layout.cols || [];
  const total = widths.reduce((sum, width) => sum + Number(width || 0), 0) || 1;
  const margin = layout.margin || { top: 19, right: 6, bottom: 16, left: 6 };
  const overflow = mapped.length > dataSlots ? mapped.length - dataSlots : 0;
  return (
    <>
      {overflow > 0 && (
        <p className="no-print mb-3 text-center text-sm font-bold text-amber-800">
          {dataSlots}件まで表示しています。あふれた{overflow}件は入っていません。
        </p>
      )}
      <article
        className="dispatch-page"
        data-orient={layout.orientation === 'landscape' ? 'landscape' : 'portrait'}
        style={{
          width: layout.orientation === 'landscape' ? '297mm' : '210mm',
          minHeight: layout.orientation === 'landscape' ? '210mm' : '297mm',
          margin: '0 auto 16px',
          background: '#fff',
          color: '#000',
          padding: `${margin.top}mm ${margin.right}mm ${margin.bottom}mm ${margin.left}mm`,
          boxSizing: 'border-box',
          boxShadow: '0 8px 28px rgba(0,0,0,.18)',
          fontFamily: '"Yu Gothic","Yu Gothic UI","Hiragino Sans",Meiryo,sans-serif',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <colgroup>
            {widths.map((width, index) => (
              <col key={index} style={{ width: `${(Number(width) / total) * 100}%` }} />
            ))}
          </colgroup>
          <tbody>
            {layout.rows.map((row, index) => {
              const data = index > headerIndex && headerIndex >= 0 && (row.cells || []).some((cell) => cell.border);
              const job = data ? mapped[slot++] || null : null;
              const cells = (row.cells || []).map((cell, col) => {
                let text = cell.text || '';
                if (String(text).includes('{{日付}}')) text = bookLabel(date);
                else if (data) text = fields[col] ? (job ? String(job[fields[col] as keyof typeof job] || '') : '') : '';
                return { cell, text, field: fields[col] || '' };
              });
              const drawn: { cell: SheetCell; text: string; field: string; span: number }[] = [];
              for (let col = 0; col < cells.length; col++) {
                const item = cells[col];
                let span = 1;
                if (item.text && !item.cell.wrap && !item.cell.border) {
                  while (col + span < cells.length && !cells[col + span].text && !cells[col + span].cell.border) span += 1;
                }
                drawn.push({ ...item, span });
                col += span - 1;
              }
              return (
                <tr key={row.n} style={row.height ? { height: `${(Number(row.height) * scale) / 100}pt` } : undefined}>
                  {drawn.map((item, col) => {
                    const tone = data && item.field === 'customer' ? customerTone(item.text) : '';
                    return (
                      <td
                        key={col}
                        colSpan={item.span > 1 ? item.span : undefined}
                        style={{
                          ...bookCss(item.cell, scale),
                          background: job?.cancelled ? '#d9d9d9' : tone || undefined,
                          color: job?.cancelled ? '#4b5563' : undefined,
                          WebkitPrintColorAdjust: 'exact',
                          printColorAdjust: 'exact',
                        }}
                      >
                        {item.text}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </article>
    </>
  );
}

export function LayoutSheet({ layout }: { layout: SheetLayout }) {
  return <FormPage layout={layout} raw />;
}

export function printSheetPages() {
  printPages();
}

function printPages() {
  const pages = document.querySelectorAll('.dispatch-page');
  if (!pages.length || !pages[0].querySelector('table')) return;
  const orient = pages[0].getAttribute('data-orient') === 'landscape' ? 'landscape' : 'portrait';
  const css =
    `@page{size:A4 ${orient};margin:0}` +
    'html,body{margin:0;padding:0;background:#fff;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    'body{font-family:"Yu Gothic","Yu Gothic UI","Hiragino Sans",Meiryo,sans-serif}' +
    '.sheet{box-shadow:none !important;margin:0 !important;page-break-after:always}' +
    '.sheet:last-child{page-break-after:auto}' +
    'table{width:100%;border-collapse:collapse;table-layout:fixed}' +
    'td{-webkit-print-color-adjust:exact;print-color-adjust:exact}';
  let body = '';
  pages.forEach((page) => {
    if (!page.querySelector('table')) return;
    body += `<div class="sheet" style="${page.getAttribute('style') || ''}">${page.innerHTML}</div>`;
  });
  if (!body) return;
  const frame = document.createElement('iframe');
  frame.setAttribute('style', 'position:fixed;width:0;height:0;border:0');
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc || !frame.contentWindow) return;
  doc.open();
  doc.write(
    `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title> </title><style>${css}</style></head><body>${body}</body></html>`
  );
  doc.close();
  const printer = frame.contentWindow;
  printer.onafterprint = () => frame.remove();
  window.setTimeout(() => {
    printer.focus();
    printer.print();
  }, 300);
}

export default function PrintPreview({
  kind,
  date,
  jobs,
  sites,
  onClose,
}: {
  kind: PrintKind;
  date: string;
  jobs: PrintJob[];
  sites: SiteHit[];
  onClose: () => void;
}) {
  const [layout, setLayout] = useState<SheetLayout | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLayout(null);
    setError('');
    fetch(`/api/print/layout?file=${encodeURIComponent(FILES[kind])}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'ひな形を読めませんでした');
        if (!cancelled) setLayout(body.layout as SheetLayout);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || 'ひな形を読めませんでした');
      });
    return () => {
      cancelled = true;
    };
  }, [kind]);

  useEffect(() => {
    if (!layout) return;
    const timer = window.setTimeout(() => printPages(), 400);
    return () => window.clearTimeout(timer);
  }, [layout]);

  const pages = jobs;
  return (
    <div className="fixed inset-0 z-[60] overflow-auto bg-slate-300">
      <div className="no-print sticky top-0 z-10 flex items-center justify-between gap-3 bg-slate-900 px-4 py-3 text-white">
        <div className="font-extrabold">{TITLES[kind]}</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={printPages}
            className="h-10 px-4 rounded-lg bg-teal-500 font-extrabold text-slate-950"
          >
            印刷
          </button>
          <button type="button" onClick={onClose} className="h-10 px-4 rounded-lg bg-white font-extrabold text-slate-800">
            閉じる
          </button>
        </div>
      </div>
      <div className="overflow-x-auto px-4 py-6">
        {error && <p className="text-center font-bold text-rose-700">{error}</p>}
        {!layout && !error && <p className="text-center font-bold text-slate-700">ひな形を読み込んでいます。</p>}
        {layout && kind === 'board' && <BoardPage layout={layout} jobs={pages} date={date} />}
        {layout && kind !== 'board' && pages.length === 0 && (
          <p className="text-center font-bold text-slate-700">印刷する配車がありません。</p>
        )}
        {layout &&
          kind !== 'board' &&
          pages.map((job) => <FormPage key={job.id} layout={layout} job={job} sites={sites} />)}
      </div>
    </div>
  );
}
