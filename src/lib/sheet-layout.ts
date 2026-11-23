import { readFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

export type SheetEdges = { left: string; right: string; top: string; bottom: string };

export type SheetCell = {
  text: string;
  size: number;
  bold: boolean;
  align: string;
  valign: string;
  border: boolean;
  edges: SheetEdges;
  wrap: boolean;
  formula: boolean;
  fill?: string;
  color?: string;
  diag?: boolean;
};

export type SheetDrawing = {
  kind: 'image' | 'text';
  src: string;
  lines: string[];
  size: number;
  x: number; // 表の幅に対する割合 0〜1
  w: number;
  y: number; // 表の上端からの pt
  h: number;
  // 行に対する位置（行番号・行内オフセット EMU）。画面上の実際の行の位置に合わせるために使う
  r1: number;
  ro1: number;
  r2: number;
  ro2: number;
};

export type SheetLayout = {
  drawings: SheetDrawing[];
  scale: number;
  orientation: string;
  defaultRowHeight: number;
  margin: { top: number; right: number; bottom: number; left: number };
  cols: number[];
  rows: { n: number; height: number; cells: SheetCell[] }[];
  merges: { r: number; c: number; rows: number; cols: number }[];
};

const FILES = new Set([
  '配車表.xlsx',
  '作業指示書.xlsx',
  '配車依頼書.xlsx',
  '自社請求書.xlsx',
  '住友林業ホームエンジニアリング請求書.xlsx',
]);

function attr(tag: string, name: string) {
  const match = String(tag || '').match(new RegExp(name + '="([^"]*)"'));
  return match ? match[1] : '';
}

function decodeXml(value: string) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#10;/g, '\n')
    .replace(/&amp;/g, '&');
}

function colIndex(ref: string) {
  const letters = String(ref || '').replace(/\d+/g, '');
  if (!letters) return -1;
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function mm(tag: string, name: string, fallback: number) {
  const value = Number(attr(tag, name));
  return value ? Math.round(value * 254) / 10 : fallback;
}

const THEME_COLORS: Record<string, string> = { '0': '#ffffff', '1': '#000000' };

function colorOf(tag: string): string {
  if (!tag) return '';
  const rgb = tag.match(/rgb="([0-9A-Fa-f]{6,8})"/);
  if (rgb) return '#' + rgb[1].slice(-6);
  const theme = tag.match(/theme="(\d+)"/);
  if (theme && THEME_COLORS[theme[1]]) return THEME_COLORS[theme[1]];
  return '';
}

function fillsOf(styles: string) {
  const block = (styles.match(/<fills[\s\S]*?<\/fills>/) || [''])[0];
  return block.split(/<fill>/).slice(1).map((part) => {
    if (!/patternType="solid"/.test(part)) return '';
    return colorOf((part.match(/<fgColor\b[^>]*\/?>/) || [''])[0]);
  });
}

function fontsOf(styles: string) {
  const block = (styles.match(/<fonts[\s\S]*?<\/fonts>/) || [''])[0];
  return block.split(/<font\b[^>]*>/).slice(1).map((part) => {
    const size = part.match(/<sz[^>]*val="([\d.]+)"/);
    return {
      size: size ? Number(size[1]) : 11,
      bold: /<b\/>/.test(part) || /<b [^>]*val="(?:1|true)"/.test(part),
      color: colorOf((part.match(/<color\b[^>]*\/?>/) || [''])[0]),
    };
  });
}

function bordersOf(styles: string) {
  const block = (styles.match(/<borders[\s\S]*?<\/borders>/) || [''])[0];
  return block.split(/<border\b[^>]*>/).slice(1).map((part) => {
    const side = (name: string) => {
      const tag = part.match(new RegExp('<' + name + '\\b[^>]*>'));
      if (!tag) return '';
      const style = tag[0].match(/style="([^"]+)"/);
      return style ? style[1] : '';
    };
    return { left: side('left'), right: side('right'), top: side('top'), bottom: side('bottom'), diag: !!side('diagonal') };
  });
}

function xfsOf(styles: string) {
  const borders = bordersOf(styles);
  const fills = fillsOf(styles);
  const block = (styles.match(/<cellXfs[\s\S]*?<\/cellXfs>/) || [''])[0];
  return block.split(/<xf\b/).slice(1).map((part) => {
    const fontId = part.match(/fontId="(\d+)"/);
    const fillId = part.match(/fillId="(\d+)"/);
    const borderId = part.match(/borderId="(\d+)"/);
    const align = part.match(/horizontal="([^"]+)"/);
    const valign = part.match(/vertical="([^"]+)"/);
    const edges = borders[borderId ? Number(borderId[1]) : 0] || { left: '', right: '', top: '', bottom: '' };
    return {
      fontId: fontId ? Number(fontId[1]) : 0,
      fill: fills[fillId ? Number(fillId[1]) : 0] || '',
      diag: !!(borders[borderId ? Number(borderId[1]) : 0] as { diag?: boolean } | undefined)?.diag,
      border: !!(edges.left || edges.right || edges.top || edges.bottom),
      edges,
      align: align ? align[1] : 'left',
      valign: valign ? valign[1] : 'bottom',
      wrap: /wrapText="1"/.test(part),
    };
  });
}

function stringsOf(xml: string) {
  const body = String(xml || '').replace(/<rPh[\s\S]*?<\/rPh>/g, '');
  return body.split(/<si\b[^>]*>/).slice(1).map((part) => {
    let text = '';
    const re = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(part))) text += decodeXml(match[1]);
    return text;
  });
}

function colsOf(sheet: string, count: number) {
  const widths = Array.from({ length: count }, () => 8.43);
  const block = (sheet.match(/<cols>[\s\S]*?<\/cols>/) || [''])[0];
  for (const tag of block.match(/<col\b[^>]*\/?>/g) || []) {
    const min = Number(attr(tag, 'min')) - 1;
    const max = Number(attr(tag, 'max')) - 1;
    const width = Number(attr(tag, 'width')) || 8.43;
    for (let col = min; col <= max && col < widths.length; col++) if (col >= 0) widths[col] = width;
  }
  return widths;
}

function cellStyle(
  index: number,
  xfs: ReturnType<typeof xfsOf>,
  fonts: ReturnType<typeof fontsOf>,
  text: string
): SheetCell {
  const xf = xfs[index] || {
    fontId: 0,
    fill: '',
    diag: false,
    border: false,
    edges: { left: '', right: '', top: '', bottom: '' },
    align: 'left',
    valign: 'bottom',
    wrap: false,
  };
  const font = fonts[xf.fontId] || { size: 11, bold: false, color: '' };
  return {
    text,
    size: font.size,
    bold: !!font.bold,
    align: xf.align || 'left',
    valign: xf.valign || 'bottom',
    border: !!xf.border,
    edges: xf.edges || { left: '', right: '', top: '', bottom: '' },
    wrap: !!xf.wrap,
    formula: false,
    fill: (xf as { fill?: string }).fill || '',
    color: font.color || '',
    diag: !!(xf as { diag?: boolean }).diag,
  };
}

function cellsOf(
  rowXml: string,
  strings: string[],
  xfs: ReturnType<typeof xfsOf>,
  fonts: ReturnType<typeof fontsOf>,
  count: number,
  rowStyle: string
) {
  const fallback = rowStyle === '' || rowStyle == null ? 0 : Number(rowStyle);
  const grid = Array.from({ length: count }, () => cellStyle(fallback, xfs, fonts, ''));
  for (const part of String(rowXml || '').split(/<c\b/).slice(1)) {
    const head = part.slice(0, part.indexOf('>'));
    const col = colIndex(attr(head, 'r'));
    if (col < 0 || col >= count) continue;
    const kind = attr(head, 't');
    const styleIndex = attr(head, 's');
    const formula = /<f[\s>]/.test(part);
    let text = '';
    if (kind === 's') {
      const shared = part.match(/<v>([\s\S]*?)<\/v>/);
      text = strings[shared ? Number(shared[1]) : -1] || '';
    } else if (kind === 'inlineStr') {
      const inline = part.match(/<t[^>]*>([\s\S]*?)<\/t>/);
      text = inline ? decodeXml(inline[1]) : '';
    } else {
      const value = part.match(/<v>([\s\S]*?)<\/v>/);
      text = value ? value[1] : '';
    }
    const styled = cellStyle(styleIndex === '' ? 0 : Number(styleIndex), xfs, fonts, text);
    styled.formula = formula;
    grid[col] = styled;
  }
  return grid;
}

function mergesOf(sheet: string) {
  const tags = sheet.match(/<mergeCell\b[^>]*\/?>/g) || [];
  const merges: SheetLayout['merges'] = [];
  for (const tag of tags) {
    const pair = attr(tag, 'ref').split(':');
    if (pair.length !== 2) continue;
    const c1 = colIndex(pair[0]);
    const c2 = colIndex(pair[1]);
    const r1 = Number(String(pair[0]).replace(/[A-Z]/g, ''));
    const r2 = Number(String(pair[1]).replace(/[A-Z]/g, ''));
    if (c1 < 0 || c2 < c1 || !r1 || r2 < r1) continue;
    merges.push({ r: r1 - 1, c: c1, rows: r2 - r1 + 1, cols: c2 - c1 + 1 });
  }
  return merges;
}

function layoutOf(sheet: string, styles: string, stringsXml: string): SheetLayout {
  const fonts = fontsOf(styles);
  const xfs = xfsOf(styles);
  const strings = stringsOf(stringsXml);
  const dim = (sheet.match(/<dimension[^>]*ref="[^"]*"/) || [''])[0];
  const end = dim.match(/:([A-Z]+)/);
  let count = end ? colIndex(end[1] + '1') + 1 : 7;
  if (count < 1) count = 7;
  // 手動の改ページ位置までが印刷範囲（はみ出す文字が見切れないよう列を足す）
  const brk = sheet.match(/<colBreaks[\s\S]*?<brk id="(\d+)"/);
  if (brk && Number(brk[1]) > count) count = Number(brk[1]);
  const format = (sheet.match(/<sheetFormatPr\b[^>]*\/?>/) || [''])[0];
  const defaultHeight = Number(attr(format, 'defaultRowHeight')) || 18;
  const endRow = dim.match(/:([A-Z]+)(\d+)/);
  const rowRe = /<row\b([^>]*)\/>|<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  const byNumber: Record<number, SheetLayout['rows'][number]> = {};
  let maxRow = endRow ? Number(endRow[2]) : 0;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(sheet))) {
    const attrs = rowMatch[1] != null ? rowMatch[1] : rowMatch[2];
    const inner = rowMatch[1] != null ? '' : rowMatch[3];
    let rowNo = Number(attr(attrs, 'r')) || 0;
    if (!rowNo) rowNo = maxRow + 1;
    if (rowNo > maxRow) maxRow = rowNo;
    const height = attr(attrs, 'ht');
    const rowStyle = attr(attrs, 's');
    byNumber[rowNo] = {
      n: rowNo,
      height: height ? Number(height) : 0,
      cells: cellsOf(inner, strings, xfs, fonts, count, rowStyle),
    };
  }
  const rows: SheetLayout['rows'] = [];
  for (let rowNo = 1; rowNo <= maxRow; rowNo++) {
    rows.push(byNumber[rowNo] || { n: rowNo, height: defaultHeight, cells: cellsOf('', strings, xfs, fonts, count, '') });
  }
  const setup = (sheet.match(/<pageSetup\b[^>]*\/?>/) || [''])[0];
  const margins = (sheet.match(/<pageMargins\b[^>]*\/?>/) || [''])[0];
  return {
    scale: Number(attr(setup, 'scale')) || 100,
    orientation: attr(setup, 'orientation') || 'portrait',
    defaultRowHeight: defaultHeight,
    margin: {
      top: mm(margins, 'top', 19),
      right: mm(margins, 'right', 6),
      bottom: mm(margins, 'bottom', 16),
      left: mm(margins, 'left', 6),
    },
    cols: colsOf(sheet, count),
    rows,
    merges: mergesOf(sheet),
    drawings: [],
  };
}

// Excel の列幅(文字数)→ EMU
function colEmu(width: number) {
  const px = Math.trunc(((256 * width + Math.trunc(128 / 7)) / 256) * 7);
  return px * 9525;
}

type Anchor = { col: number; colOff: number; row: number; rowOff: number };

function anchorOf(block: string, tag: 'from' | 'to'): Anchor | null {
  const m = block.match(
    new RegExp(
      `<xdr:${tag}><xdr:col>(\\d+)</xdr:col><xdr:colOff>(-?\\d+)</xdr:colOff><xdr:row>(\\d+)</xdr:row><xdr:rowOff>(-?\\d+)</xdr:rowOff></xdr:${tag}>`
    )
  );
  if (!m) return null;
  return { col: Number(m[1]), colOff: Number(m[2]), row: Number(m[3]), rowOff: Number(m[4]) };
}

// 図形（テキストボックス）と画像（印鑑など）を読み取る
async function drawingsOf(zip: JSZip, layout: SheetLayout, fileName: string) {
  const xml = await zipText(zip, /xl\/drawings\/drawing\d+\.xml$/i);
  if (!xml) return [];
  const relsXml = await zipText(zip, /xl\/drawings\/_rels\/drawing\d+\.xml\.rels$/i);
  const targets: Record<string, string> = {};
  for (const tag of relsXml.match(/<Relationship\b[^>]*\/?>/g) || []) targets[attr(tag, 'Id')] = attr(tag, 'Target');

  const widths = layout.cols.map(colEmu);
  const totalWidth = widths.reduce((sum, w) => sum + w, 0) || 1;
  const heights = layout.rows.map((row) => (row.height || layout.defaultRowHeight) * 12700);
  const xAt = (a: Anchor) => {
    let sum = 0;
    for (let c = 0; c < a.col && c < widths.length; c++) sum += widths[c];
    return sum + a.colOff;
  };
  const yAt = (a: Anchor) => {
    let sum = 0;
    for (let r = 0; r < a.row; r++) sum += heights[r] ?? layout.defaultRowHeight * 12700;
    return sum + a.rowOff;
  };

  const out: SheetDrawing[] = [];
  const blocks = xml.split(/<xdr:twoCellAnchor\b[^>]*>/).slice(1);
  for (const block of blocks) {
    const from = anchorOf(block, 'from');
    const to = anchorOf(block, 'to');
    if (!from || !to) continue;
    const geometry = {
      x: xAt(from) / totalWidth,
      w: Math.max(0, xAt(to) - xAt(from)) / totalWidth,
      y: yAt(from) / 12700,
      h: Math.max(0, yAt(to) - yAt(from)) / 12700,
      r1: from.row,
      ro1: from.rowOff,
      r2: to.row,
      ro2: to.rowOff,
    };
    if (/<xdr:pic>/.test(block)) {
      const rid = block.match(/r:embed="([^"]+)"/)?.[1] || '';
      const target = targets[rid] || '';
      const ext = target.split('.').pop()?.toLowerCase() || '';
      const base = fileName.replace(/\.xlsx$/i, '');
      let bytes: Buffer | null = null;
      let mime = 'image/png';
      if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') {
        const entry = zip.file('xl/' + target.replace(/^\.\.\//, ''));
        if (entry) bytes = await entry.async('nodebuffer');
        mime = ext === 'png' ? 'image/png' : 'image/jpeg';
      } else {
        // EMF/WMF はブラウザで表示できないため、あらかじめ PNG にしたものを templates に置く
        try {
          bytes = await readFile(path.join(process.cwd(), 'templates', `${base}-stamp.png`));
        } catch {
          bytes = null;
        }
      }
      if (bytes) out.push({ kind: 'image', src: `data:${mime};base64,${bytes.toString('base64')}`, lines: [], size: 0, ...geometry });
    } else if (/<xdr:sp\b/.test(block)) {
      const body = block.match(/<xdr:txBody>([\s\S]*?)<\/xdr:txBody>/)?.[1] || '';
      const lines = (body.match(/<a:p>[\s\S]*?<\/a:p>|<a:p\/>/g) || []).map((p) =>
        decodeXml([...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(''))
      );
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      if (!lines.length) continue;
      const size = Number(body.match(/\bsz="(\d+)"/)?.[1] || 1000) / 100;
      out.push({ kind: 'text', src: '', lines, size, ...geometry });
    }
  }
  return out;
}

async function zipText(zip: JSZip, pattern: RegExp) {
  const found = zip.file(pattern);
  if (!found.length) return '';
  return found[0].async('string');
}

export async function readPrintLayout(fileName: string): Promise<SheetLayout> {
  if (!FILES.has(fileName)) throw new Error('ひな形の指定が不正です');
  const filePath = path.join(process.cwd(), 'templates', fileName);
  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch {
    throw new Error(`ひな形「${fileName}」が templates フォルダにありません`);
  }
  const zip = await JSZip.loadAsync(bytes);
  const sheet = await zipText(zip, /sheet1\.xml$/i);
  const styles = await zipText(zip, /styles\.xml$/i);
  const strings = await zipText(zip, /sharedStrings\.xml$/i);
  if (!sheet || !styles) throw new Error('ひな形のシートが見つかりません');
  const layout = layoutOf(sheet, styles, strings);
  try {
    layout.drawings = await drawingsOf(zip, layout, fileName);
  } catch {
    layout.drawings = [];
  }
  return layout;
}
