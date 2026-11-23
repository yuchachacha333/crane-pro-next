import type { SheetCell, SheetLayout } from '@/lib/sheet-layout';

export type InvoiceCustomer = {
  name: string;
  postal: string;
  address: string;
};

export type InvoiceLine = {
  date: string;
  machine: string;
  site: string;
  no: string;
  detail: string;
  qty: number | '';
  price: number | '';
  amount: number | '';
  note: string;
  start: string;
  end: string;
};

function plain(text: string) {
  return String(text || '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[\s\u3000]/g, '')
    .toLowerCase();
}

function roleOf(label: string) {
  const key = plain(label);
  if (!key) return '';
  if (key === '日付' || key === '年月日') return 'date';
  if (key.includes('現場no') || key.includes('現場番号')) return 'no';
  if (key.includes('現場名')) return 'site';
  if (key.includes('内訳')) return 'detail';
  if (key.includes('工事内容') || key === '機種' || key.includes('品名')) return 'machine';
  if (key.includes('数量')) return 'qty';
  if (key.includes('単価')) return 'price';
  if (key.includes('金額') && !key.includes('合計') && !key.includes('請求')) return 'amount';
  if (key.includes('備考')) return 'note';
  if (key.includes('開始')) return 'start';
  if (key.includes('完了') || key.includes('終了')) return 'end';
  return '';
}

function headerRoles(row: { cells: SheetCell[] }) {
  const roles: Record<string, number> = {};
  row.cells.forEach((cell, col) => {
    const role = roleOf(cell.text);
    if (role && roles[role] == null) roles[role] = col;
  });
  const named = roles.date != null || roles.site != null || roles.machine != null || roles.no != null;
  const money = roles.qty != null || roles.price != null || roles.amount != null;
  return named && money ? roles : null;
}

function summaryKind(row: { cells: SheetCell[] }) {
  let kind = '';
  for (const cell of row.cells) {
    const key = plain(cell.text);
    if (!key) continue;
    if (key.includes('ご請求')) kind = 'bill';
    else if (key.includes('消費税')) kind = 'tax';
    else if (key.includes('小計')) kind = 'net';
    else if (key.includes('合計金額')) kind = 'gross';
    else if (key.startsWith('合計')) kind = kind || 'total';
  }
  return kind;
}

function moneyText(text: string) {
  const value = String(text ?? '').replace(/[,，\s\u3000円￥¥]/g, '');
  return /^-?\d+(\.\d+)?$/.test(value);
}

function comma(value: number) {
  return String(Math.round(Number(value) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function fillInvoiceLayout(
  source: SheetLayout,
  lines: InvoiceLine[],
  customer: InvoiceCustomer,
  rate = 10,
  included = false
) {
  const layout = JSON.parse(JSON.stringify(source)) as SheetLayout;
  for (const row of layout.rows) {
    for (const cell of row.cells) {
      cell.text = String(cell.text || '')
        .replaceAll('【得意先郵便番号】', customer.postal || '')
        .replaceAll('【得意先住所】', customer.address || '')
        .replaceAll('【得意先名】', customer.name || '')
        .replaceAll('{{企業名}}', customer.name || '');
    }
  }
  // 発行日（タイトル「請求書」の下の日付欄が空なら、今日の日付を入れる）
  {
    const dateRow = layout.rows[2];
    if (dateRow && dateRow.cells[5] && !String(dateRow.cells[5].text || '').trim()) {
      const now = new Date();
      dateRow.cells[5].text = [now.getFullYear() + '年', now.getMonth() + 1 + '月', now.getDate() + '日'].join('');
      dateRow.cells[5].align = 'center';
    }
  }
  let headerIndex = -1;
  let roles: Record<string, number> | null = null;
  layout.rows.some((row, index) => {
    const found = headerRoles(row);
    if (!found) return false;
    headerIndex = index;
    roles = found;
    return true;
  });
  if (!roles) return { layout, omitted: lines.length, warning: '明細の見出しが見つかりません' };
  const slots = [];
  for (let index = headerIndex + 1; index < layout.rows.length; index++) {
    if (summaryKind(layout.rows[index])) break;
    slots.push(layout.rows[index]);
  }
  const fields = ['date', 'machine', 'site', 'no', 'detail', 'qty', 'price', 'amount', 'note', 'start', 'end'] as const;
  slots.forEach((row, lineIndex) => {
    for (const field of fields) {
      const col = roles?.[field];
      if (col == null) continue;
      if (row.cells[col]) row.cells[col].text = '';
    }
    for (const cell of row.cells) {
      if (plain(cell.text) === '残金') cell.text = '';
    }
    const line = lines[lineIndex];
    if (!line) return;
    for (const field of fields) {
      const col = roles?.[field];
      if (col == null) continue;
      const cell = row.cells[col];
      if (!cell) continue;
      const value = line[field];
      cell.text = value == null || value === '' ? '' : field === 'price' || field === 'amount' ? comma(Number(value)) : String(value);
      if (field === 'site' && cell.text.includes('\n')) {
        cell.wrap = true;
        row.height = Math.max(Number(row.height) || 18, 32);
      }
    }
  });
  // 機種が見切れないよう、現場名の列から幅を分けてもらう（現場名は短くなってよい）
  {
    const machineCol = (roles as Record<string, number> | null)?.machine;
    const siteCol = (roles as Record<string, number> | null)?.site;
    if (machineCol != null && siteCol != null && machineCol !== siteCol && Array.isArray(layout.cols)) {
      const units = (text: string) => Array.from(text).reduce((sum, ch) => sum + (/[\u0000-\u00ff\uff61-\uff9f]/.test(ch) ? 1 : 2), 0);
      const longest = Math.max(0, ...lines.map((line) => units(String(line.machine || ''))));
      const cols = layout.cols as unknown as number[];
      let need = longest * 0.85 + 1.5 - Number(cols[machineCol] || 0);
      for (let c = siteCol; need > 0 && c < siteCol + 3 && c < cols.length; c++) {
        const give = Math.min(need, Math.max(0, Number(cols[c]) - 2));
        cols[c] = Number(cols[c]) - give;
        cols[machineCol] = Number(cols[machineCol]) + give;
        need -= give;
      }
    }
  }
  let base = 0;
  for (const line of lines) {
    const amount = Number(String(line.amount ?? '').replace(/,/g, ''));
    if (!Number.isNaN(amount)) base += amount;
  }
  base = Math.round(base);
  const tax = included ? Math.round((base * rate) / (100 + rate)) : Math.round((base * rate) / 100);
  const net = included ? base - tax : base;
  const gross = included ? base : base + tax;
  const kinds = layout.rows.map(summaryKind);
  const hasBill = kinds.includes('bill');
  const summaryValue = (kind: string) => {
    if (kind === 'tax') return tax;
    if (kind === 'net') return net;
    if (kind === 'bill' || kind === 'gross') return gross;
    if (kind === 'total') return hasBill ? net : gross;
    return null;
  };
  for (const row of layout.rows) {
    const kind = summaryKind(row);
    const value = summaryValue(kind);
    if (value == null) continue;
    for (const cell of row.cells) {
      if (moneyText(cell.text) || cell.formula) cell.text = (kind === 'bill' ? '¥' : '') + comma(value);
    }
  }
  return { layout, omitted: Math.max(0, lines.length - slots.length), warning: '' };
}
