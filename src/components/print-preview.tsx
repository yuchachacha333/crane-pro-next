'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
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
  request_notes?: string;
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

function crewRank(name: string) {
  const text = String(name || '').replace(/[\s\u3000]/g, '');
  if (text.includes('山科裕行')) return 0;
  if (text.includes('外山')) return 1;
  if (text.includes('山科康行')) return 2;
  return 100;
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
    fontWeight: cell.bold ? 800 : 400,
    textAlign: align as 'left' | 'center' | 'right',
    verticalAlign: valign as 'middle' | 'top' | 'bottom',
    border: cell.border ? '0.75pt solid #000' : '0',
    whiteSpace: cell.wrap ? ('pre-wrap' as const) : ('nowrap' as const),
    padding: '0 0.3mm',
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

function formValues(job: PrintJob, sites: SiteHit[], kind?: PrintKind) {
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
    備考: kind === 'request' ? job.request_notes || '' : job.notes || '',
    庸車: job.supplier_name || '',
  };
}

function CellText({ cell, text, scale }: { cell: SheetCell; text: string; scale: number }) {
  const runs = cell.runs;
  if (!runs?.length || runs.map((run) => run.text).join('') !== cell.text) return <>{text}</>;
  return (
    <>
      {runs.map((run, index) => (
        <span
          key={index}
          style={{
            fontSize: `${((run.size || cell.size) * scale) / 100}pt`,
            fontWeight: run.bold ? 800 : 400,
          }}
        >
          {run.text}
        </span>
      ))}
    </>
  );
}

function SheetSpill({ cell, text, scale }: { cell: SheetCell; text: string; scale: number }) {
  if (!text || cell.wrap) return <CellText cell={cell} text={text} scale={scale} />;
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
  return (
    <span style={style}>
      <CellText cell={cell} text={text} scale={scale} />
    </span>
  );
}

function FormPage({
  layout,
  job,
  sites = [],
  raw = false,
  clip = false,
  kind,
}: {
  layout: SheetLayout;
  job?: PrintJob;
  sites?: SiteHit[];
  raw?: boolean;
  clip?: boolean;
  kind?: PrintKind;
}) {
  const scale = Number(layout.scale) || 100;
  const values = raw || !job ? {} : formValues(job, sites, kind);
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
  const centered = Boolean(layout.center);
  // 中央寄せの請求書は、表の幅を用紙いっぱい（左右12mm）に広げて表示する。
  // 文字だけ元の大きさのままだと枠に対して小さく見えるので、広げた分だけ文字も大きくする
  const naturalPx = widths.reduce((sum, width) => sum + Math.trunc(((256 * Number(width || 0) + Math.trunc(128 / 7)) / 256) * 7), 0);
  const pageMm = layout.orientation === 'landscape' ? 297 : 210;
  const stretch = centered && naturalPx > 0 ? (((pageMm - 24) / 25.4) * 96) / ((naturalPx * scale) / 100) : 1;
  const fontScale = scale * Math.min(1.15, Math.max(1, stretch));
  const totalH =
    layout.rows.reduce((sum, row) => sum + (Number(row.height) || layout.defaultRowHeight || 18), 0) || 1;
  const wrap = useRef<HTMLDivElement>(null);
  const [boxes, setBoxes] = useState<Record<number, { top: number; height: number }>>({});
  const [imageLeft, setImageLeft] = useState<Record<number, number>>({});
  useLayoutEffect(() => {
    const root = wrap.current;
    if (!root) return;
    const measure = () => {
      const trs = root.querySelectorAll('tbody > tr');
      const next: Record<number, { top: number; height: number }> = {};
      (layout.drawings || []).forEach((d, i) => {
        const at = (row: number, off: number) => {
          const tr = trs[row] as HTMLElement | undefined;
          if (!tr) return null;
          const nominal = (layout.rows[row]?.height || layout.defaultRowHeight || 18) * 12700;
          return tr.offsetTop + Math.min(1, Math.max(0, off / nominal)) * tr.offsetHeight;
        };
        const top = at(d.r1, d.ro1);
        const bottom = at(d.r2, d.ro2);
        if (top != null && bottom != null) next[i] = { top, height: Math.max(0, bottom - top) };
      });
      setBoxes(next);
      const imgs = [...root.querySelectorAll('img')];
      const rootR = root.getBoundingClientRect();
      const imageIndexes = (layout.drawings || []).flatMap((item, index) => (item.kind === 'image' ? [index] : []));
      const nudged: Record<number, number> = {};
      imgs.forEach((img, ordinal) => {
        const drawingIndex = imageIndexes[ordinal];
        if (drawingIndex == null) return;
        const ir = img.getBoundingClientRect();
        let nameRight = -1;
        let nameTop = Infinity;
        for (const td of root.querySelectorAll('td')) {
          const raw = [...td.childNodes].find((node) => node.nodeType === 3 && (node.textContent || '').trim());
          if (!raw) continue;
          const range = document.createRange();
          range.selectNodeContents(raw);
          for (const rect of range.getClientRects()) {
            if (rect.width < 24) continue;
            const gap = ir.left - rect.right;
            const beside = rect.top < ir.top + ir.height * 0.4 && rect.bottom > ir.top + 2;
            if (!beside || gap > 90 || gap < -24) continue;
            if (rect.top < nameTop) {
              nameTop = rect.top;
              nameRight = rect.right;
            }
          }
        }
        if (nameRight > 0 && rootR.width) {
          nudged[drawingIndex] = (nameRight - 16 - rootR.left) / rootR.width;
        }
      });
      setImageLeft((prev) => {
        const keys = Object.keys(nudged);
        if (keys.length === Object.keys(prev).length && keys.every((key) => Math.abs((prev[Number(key)] || 0) - nudged[Number(key)]) < 0.004)) return prev;
        return nudged;
      });
    };
    measure();
    window.addEventListener('resize', measure);
    document.fonts?.ready.then(measure);
    const table = root.querySelector('table');
    const observer = table && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (table && observer) observer.observe(table);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [layout]);
  return (
    <article
      className="dispatch-page"
      data-orient={layout.orientation === 'landscape' ? 'landscape' : 'portrait'}
      style={{
        ...pageFrame(layout),
      }}
    >
      <div ref={wrap} style={{ position: 'relative', width: '100%', flex: centered ? '1 1 auto' : '0 0 auto', minHeight: centered ? 0 : undefined, height: centered ? '100%' : undefined }}>
      <table style={{ width: '100%', height: centered ? '100%' : undefined, borderCollapse: 'collapse', tableLayout: 'fixed', overflow: 'visible' }}>
        <colgroup>
          {widths.map((width, index) => (
            <col key={index} style={{ width: `${(Number(width) / total) * 100}%` }} />
          ))}
        </colgroup>
        <tbody>
          {layout.rows.map((row, index) => (
            <tr
              key={row.n}
              data-row={index}
              style={rowHeight(
                row.height,
                raw ? layout.defaultRowHeight : 0,
                scale,
                centered ? ((Number(row.height) || layout.defaultRowHeight || 18) / totalH) * 100 : undefined
              )}
            >
              {row.cells.map((cell, col) => {
                if (cover[`${index}:${col}`]) return null;
                const merge = span[`${index}:${col}`];
                const edges = merge ? outerEdges(layout, merge) : formEdges(cell);
                let text = raw ? cell.text || '' : fillText(cell.text || '', values);
                if (!raw && /^\d{4}年\d{1,2}月\d{1,2}日/.test(text)) text = today;
                // 罫線のある表のマス目だけ切り詰め、罫線のない文章（振込先・会社情報など）は折り返し／はみ出して表示する
                const clipCell = clip && Boolean(edges.left || edges.right || edges.top || edges.bottom);
                const flow = cell.wrap
                  ? { whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const, overflow: 'hidden' as const }
                  : { whiteSpace: 'pre' as const, overflow: 'visible' as const, wordBreak: 'normal' as const };
                return (
                  <td
                    key={col}
                    colSpan={merge && merge.cols > 1 ? merge.cols : undefined}
                    rowSpan={merge && merge.rows > 1 ? merge.rows : undefined}
                    style={{
                      ...bookCss({ ...cell, border: false, wrap: false }, fontScale),
                      borderLeft: edgeWidth(edges.left),
                      borderRight: edgeWidth(edges.right),
                      borderTop: edgeWidth(edges.top),
                      borderBottom: edgeWidth(edges.bottom),
                      ...flow,
                      ...(cell.fill ? { background: cell.fill } : {}),
                      ...(cell.color ? { color: cell.color } : {}),
                      ...(cell.diag
                        ? {
                            backgroundImage: 'linear-gradient(to top left, transparent calc(50% - 0.5px), #000 calc(50% - 0.5px), #000 calc(50% + 0.5px), transparent calc(50% + 0.5px))',
                          }
                        : {}),
                      WebkitPrintColorAdjust: 'exact',
                      printColorAdjust: 'exact',
                      position: !clipCell && text && !cell.wrap ? 'relative' : undefined,
                      ...(clipCell || cell.wrap
                        ? { overflow: 'hidden' as const }
                        : text
                          ? { overflow: 'visible' as const }
                          : {}),
                      textOverflow: clipCell ? 'clip' : undefined,
                    }}
                  >
                    {clipCell ? (
                      <CellText cell={cell} text={text} scale={fontScale} />
                    ) : (
                      <SheetSpill cell={cell} text={text} scale={fontScale} />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {(layout.drawings || []).map((item, index, all) => {
        // 挨拶文の枠は、文字の行数にぴったり合わせる（枠だけが縦に伸びて余白が空くのを防ぐ）
        const fitted = (target: SheetLayout['drawings'][number]) =>
          ((target.lines.length * 1.35 * target.size * fontScale) / 100 + 9) * (96 / 72);
        let fitHeight = 0;
        if (centered && item.kind === 'text') fitHeight = fitted(item);
        if (centered && item.kind === 'box') {
          const owner = all.find(
            (other) =>
              other.kind === 'text' &&
              other.lines.length > 0 &&
              Math.abs(other.x - item.x) < 0.03 &&
              Math.abs(other.r1 - item.r1) <= 1 &&
              Math.abs(other.r2 - item.r2) <= 1
          );
          if (owner) fitHeight = fitted(owner);
        }
        // 文字の枠と罫線の枠は別々に保存されていて少しずれるので、文字は罫線の枠に重ねる
        let geoIndex = index;
        if (item.kind === 'text') {
          const frame = all.findIndex(
            (other) =>
              other.kind === 'box' &&
              Boolean(other.stroke) &&
              Math.abs(other.x - item.x) < 0.03 &&
              Math.abs(other.r1 - item.r1) <= 1 &&
              Math.abs(other.r2 - item.r2) <= 1
          );
          if (frame >= 0) geoIndex = frame;
        }
        const geo = all[geoIndex];
        const geoBox = boxes[geoIndex];
        const boxHeight = geoBox && fitHeight ? Math.min(geoBox.height, fitHeight) : geoBox?.height;
        const box: CSSProperties = {
          position: 'absolute',
          left: `${(item.kind === 'image' && imageLeft[index] != null ? imageLeft[index] : geo.x) * 100}%`,
          width: `${geo.w * 100}%`,
          top: geoBox ? `${geoBox.top}px` : `${(geo.y * scale) / 100}pt`,
          height: boxHeight != null ? `${boxHeight}px` : `${(geo.h * scale) / 100}pt`,
          pointerEvents: 'none',
        };
        if (item.kind === 'image') {
          // eslint-disable-next-line @next/next/no-img-element
          return <img key={index} src={item.src} alt="" style={{ ...box, objectFit: 'contain', zIndex: 2 }} />;
        }
        if (item.kind === 'box') {
          return (
            <div
              key={index}
              style={{
                ...box,
                zIndex: 1,
                boxSizing: 'border-box',
                background: item.fill || 'transparent',
                border: item.stroke ? `${item.strokeWidth || 1}px solid ${item.stroke}` : undefined,
                borderRadius: item.radius ? `${item.radius}%` : undefined,
              }}
            />
          );
        }
        return (
          <div
            key={index}
            style={{
              ...box,
              zIndex: 3,
              boxSizing: 'border-box',
              padding: '2pt 7pt',
              overflow: 'hidden',
              fontSize: `${(item.size * fontScale) / 100}pt`,
              fontWeight: 500,
              lineHeight: 1.35,
              whiteSpace: 'pre-wrap',
              color: '#000',
            }}
          >
            {item.lines.map((line, i) => {
              const parked = /^[\s\u3000]{6,}(\S{1,12})$/.exec(line);
              if (parked) {
                return (
                  <div key={i} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {parked[1]}
                  </div>
                );
              }
              return <div key={i}>{line || '\u00a0'}</div>;
            })}
          </div>
        );
      })}
      </div>
    </article>
  );
}

function BoardPage({ layout, jobs, date }: { layout: SheetLayout; jobs: PrintJob[]; date: string }) {
  const scale = Number(layout.scale) || 100;
  const ordered = [...jobs].sort((a, b) => {
    const rank = crewRank(a.operator_name) - crewRank(b.operator_name);
    if (rank !== 0) return rank;
    return minutes(a.entry_time) - minutes(b.entry_time);
  });
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
          ...pageFrame(layout),
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
                <tr key={row.n} data-row={index} style={rowHeight(row.height, 0, scale)}>
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

export function LayoutSheet({ layout, clip = false }: { layout: SheetLayout; clip?: boolean }) {
  return <FormPage layout={layout} raw clip={clip} />;
}

async function sheetsToPdf(title: string) {
  const pages = Array.from(document.querySelectorAll<HTMLElement>('.dispatch-page')).filter((page) => page.querySelector('table'));
  if (!pages.length) return null;
  const { toJpeg } = await import('html-to-image');
  const { jsPDF } = await import('jspdf');
  const orient = pages[0].getAttribute('data-orient') === 'landscape' ? 'l' : 'p';
  const pdf = new jsPDF({ orientation: orient, unit: 'mm', format: 'a4' });
  pdf.setProperties({ title: title || ' ', author: ' ', creator: ' ', subject: ' ' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  // 画面の縮小表示を使わず、原寸の複製を撮る。1枚のひな形はPDFも1ページにする
  const stage = document.createElement('div');
  stage.setAttribute('style', 'position:fixed;left:-20000px;top:0;pointer-events:none;background:#fff');
  document.body.appendChild(stage);
  try {
    for (let i = 0; i < pages.length; i++) {
      const clone = pages[i].cloneNode(true) as HTMLElement;
      const landscape = clone.getAttribute('data-orient') === 'landscape';
      clone.style.margin = '0';
      clone.style.boxShadow = 'none';
      clone.style.transform = 'none';
      clone.style.width = landscape ? '297mm' : '210mm';
      clone.style.height = landscape ? '210mm' : '297mm';
      clone.style.minHeight = '0';
      clone.style.overflow = 'hidden';
      clone.style.display = 'flex';
      clone.style.flexDirection = 'column';
      clone.style.justifyContent = 'center';
      stage.innerHTML = '';
      stage.appendChild(clone);
      await new Promise((resolve) => window.setTimeout(resolve, 60));
      const image = await toJpeg(clone, {
        pixelRatio: 2,
        quality: 0.98,
        backgroundColor: '#ffffff',
      });
      if (i > 0) pdf.addPage('a4', orient);
      pdf.addImage(image, 'JPEG', 0, 0, pageW, pageH);
    }
  } finally {
    stage.remove();
  }
  return pdf;
}

export async function createSheetFile(title: string) {
  const pdf = await sheetsToPdf(title);
  if (!pdf) return null;
  const blob = pdf.output('blob');
  return new File([blob], `${title}.pdf`, { type: 'application/pdf' });
}

export async function shareSheetPages(title: string, prepared?: File | null) {
  const file = prepared || (await createSheetFile(title));
  if (!file) return;
  if (navigator.share) {
    try {
      // Safariには canShare がない版もあるため、share を直接試す。
      await navigator.share({ files: [file], title });
      return;
    } catch (error) {
      // ユーザー自身が共有画面を閉じた場合は、ダウンロードへ切り替えない。
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  URL.revokeObjectURL(url);
}

/** 画面が狭いとき（スマホ・iPad）は、A4の版面をそのまま縮小して全体を見せる */
export function FitPages({ children }: { children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  useLayoutEffect(() => {
    const fit = () => {
      const root = box.current;
      if (!root) return;
      const page = root.querySelector('.dispatch-page');
      const natural = page?.getAttribute('data-orient') === 'landscape' ? 1122.5 : 793.7;
      const room = (root.parentElement?.clientWidth || window.innerWidth) - 32;
      const next = Math.min(1, Math.max(0.2, room / natural));
      setZoom((prev) => (Math.abs(prev - next) < 0.005 ? prev : next));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  });
  const page = box.current?.querySelector('.dispatch-page');
  const tall = page?.getAttribute('data-orient') === 'landscape' ? 793.7 : 1122.5;
  return (
    <div ref={box} style={{ width: '100%', overflow: 'hidden', display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: zoom < 1 ? `${(page?.getAttribute('data-orient') === 'landscape' ? 1122.5 : 793.7) * zoom}px` : undefined, height: zoom < 1 ? tall * zoom : undefined }}>
        <div style={zoom < 1 ? { width: page?.getAttribute('data-orient') === 'landscape' ? 1122.5 : 793.7, transform: `scale(${zoom})`, transformOrigin: 'top left' } : undefined}>
          {children}
        </div>
      </div>
    </div>
  );
}

export function printSheetPages(prepared?: File | null, title = '書類') {
  if (isMobilePrint()) {
    void openPdfForMobilePrint(prepared, title);
    return;
  }
  printPages();
}

let printInProgress = false;

async function openPdfForMobilePrint(prepared?: File | null, title = '書類') {
  // 非同期生成後の window.open はSafariにブロックされるため、タップ直後にタブを確保する。
  const tab = window.open('about:blank', '_blank');
  const file = prepared || (await createSheetFile(title));
  if (!file) {
    tab?.close();
    return;
  }
  const url = URL.createObjectURL(file);
  if (tab) tab.location.replace(url);
  else window.location.href = url;
  window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
}

function isMobilePrint() {
  if (typeof navigator === 'undefined') return false;
  return (
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function printPages() {
  if (printInProgress) return;
  const pages = Array.from(document.querySelectorAll<HTMLElement>('.dispatch-page')).filter((page) => page.querySelector('table'));
  if (!pages.length) return;
  printInProgress = true;
  const orient = pages[0].getAttribute('data-orient') === 'landscape' ? 'landscape' : 'portrait';
  const sheetW = orient === 'landscape' ? '297mm' : '210mm';
  const sheetH = orient === 'landscape' ? '210mm' : '297mm';
  // Chromium の端数による空白ページだけを避けるため、縮小は目立たない2%に留める。
  const frameH = orient === 'landscape' ? '206mm' : '292mm';
  document.querySelector('.native-print-stage')?.remove();
  document.querySelector('#native-print-style')?.remove();
  const style = document.createElement('style');
  style.id = 'native-print-style';
  style.textContent =
    `.native-print-stage{display:none}` +
    `@media print{` +
    `@page{size:A4 ${orient};margin:0}` +
    `html,body{margin:0!important;padding:0!important;background:#fff!important;color:#000!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}` +
    `body>*:not(.native-print-stage){display:none!important}` +
    `.native-print-stage{display:block!important;font-family:"Yu Gothic","Yu Gothic UI","Hiragino Sans",Meiryo,sans-serif}` +
    `.native-print-stage.native-single{position:fixed!important;inset:0!important;width:${sheetW}!important;height:${sheetH}!important;overflow:hidden!important}` +
    `.native-print-page{position:relative;width:${sheetW};height:${frameH};overflow:hidden;break-inside:avoid;page-break-inside:avoid}` +
    `.native-single .native-print-page{position:absolute!important;inset:0!important;width:${sheetW}!important;height:${sheetH}!important;overflow:hidden!important}` +
    `.native-print-page+.native-print-page{break-before:page;page-break-before:always}` +
    `.native-print-sheet{position:absolute!important;left:1%!important;top:0!important;box-shadow:none!important;margin:0!important;overflow:hidden!important;box-sizing:border-box!important;width:${sheetW}!important;height:${sheetH}!important;min-height:0!important;transform:scale(.98)!important;transform-origin:top left!important}` +
    `.native-single .native-print-sheet{left:0!important;transform:none!important}` +
    `.native-print-sheet table{width:100%!important;border-collapse:collapse!important;table-layout:fixed!important}` +
    `.native-print-sheet td{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}` +
    `}`;
  document.head.appendChild(style);
  const stage = document.createElement('div');
  stage.className = pages.length === 1 ? 'native-print-stage native-single' : 'native-print-stage';
  pages.forEach((page) => {
    const frame = document.createElement('div');
    frame.className = 'native-print-page';
    const sheet = page.cloneNode(true) as HTMLElement;
    sheet.className = 'native-print-sheet';
    frame.appendChild(sheet);
    stage.appendChild(frame);
  });
  document.body.appendChild(stage);
  const clean = () => {
    printInProgress = false;
    stage.remove();
    style.remove();
    window.removeEventListener('afterprint', clean);
  };
  window.addEventListener('afterprint', clean);
  window.setTimeout(() => {
    if (document.body.contains(stage)) clean();
  }, 60_000);
  window.print();
}

function pageFrame(layout: SheetLayout): CSSProperties {
  const margin = layout.margin || { top: 12, right: 10, bottom: 12, left: 10 };
  const landscape = layout.orientation === 'landscape';
  const pageW = landscape ? '297mm' : '210mm';
  const pageH = landscape ? '210mm' : '297mm';
  if (layout.center) {
    return {
      width: pageW,
      height: pageH,
      minHeight: pageH,
      margin: '0 auto 16px',
      background: '#fff',
      color: '#000',
      padding: '12mm',
      boxSizing: 'border-box',
      boxShadow: '0 8px 28px rgba(0,0,0,.18)',
      fontFamily: '"Yu Gothic","Yu Gothic UI","Hiragino Sans",Meiryo,sans-serif',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'stretch',
      overflow: 'hidden',
    };
  }
  const padY = (Number(margin.top) + Number(margin.bottom)) / 2;
  const padX = (Number(margin.left) + Number(margin.right)) / 2;
  return {
    width: pageW,
    minHeight: pageH,
    margin: '0 auto 16px',
    background: '#fff',
    color: '#000',
    padding: `${padY}mm ${padX}mm`,
    boxSizing: 'border-box',
    boxShadow: '0 8px 28px rgba(0,0,0,.18)',
    fontFamily: '"Yu Gothic","Yu Gothic UI","Hiragino Sans",Meiryo,sans-serif',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
  };
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
  const [shareFile, setShareFile] = useState<File | null>(null);

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

  const pages = jobs;
  useEffect(() => {
    if (!layout) return;
    let cancelled = false;
    setShareFile(null);
    const timer = window.setTimeout(() => {
      createSheetFile(TITLES[kind]).then((file) => {
        if (!cancelled) setShareFile(file);
      }).catch(() => undefined);
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [layout, kind, jobs]);

  return (
    <div className="fixed inset-0 z-[60] overflow-auto bg-slate-300">
      <div className="no-print sticky top-0 z-10 flex items-center justify-between gap-3 bg-slate-900 px-4 py-3 text-white">
        <div className="font-extrabold">{TITLES[kind]}</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => printSheetPages(shareFile, TITLES[kind])}
            className="h-10 px-4 rounded-lg bg-teal-500 font-extrabold text-slate-950"
          >
            印刷
          </button>
          <button
            type="button"
            onClick={() => shareSheetPages(TITLES[kind], shareFile).catch(() => undefined)}
            className="h-10 px-4 rounded-lg bg-white font-extrabold text-slate-800"
          >
            共有
          </button>
          <button type="button" onClick={onClose} className="h-10 px-4 rounded-lg bg-white font-extrabold text-slate-800">
            閉じる
          </button>
        </div>
      </div>
      <div className="px-4 py-6">
        {error && <p className="text-center font-bold text-rose-700">{error}</p>}
        {!layout && !error && <p className="text-center font-bold text-slate-700">ひな形を読み込んでいます。</p>}
        <FitPages>
        {layout && kind === 'board' && <BoardPage layout={layout} jobs={pages} date={date} />}
        {layout && kind !== 'board' && pages.length === 0 && (
          <p className="text-center font-bold text-slate-700">印刷する配車がありません。</p>
        )}
        {layout &&
          kind !== 'board' &&
          pages.map((job) => <FormPage key={job.id} layout={layout} job={job} sites={sites} kind={kind} />)}
        </FitPages>
      </div>
    </div>
  );
}

function rowHeight(height: unknown, fallback: unknown, scale: number, share?: number): CSSProperties | undefined {
  if (share) return { height: `${share}%` };
  const h = Number(height) || Number(fallback) || 0;
  return h ? { height: `${(h * scale) / 100}pt` } : undefined;
}
