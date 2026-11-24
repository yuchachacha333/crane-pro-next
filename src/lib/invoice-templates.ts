export type InvoiceLine = {
  date: string;
  site: string;
  machine: string;
  qty: number | null;
  price: number | null;
  amount: number;
  note: string;
};

export type InvoiceDraft = {
  customerName: string;
  issueDate: string;
  periodLabel: string;
  projectName: string;
  staffName: string;
  staffEmail: string;
  lines: InvoiceLine[];
};

type TextCell = { cell: string; maxChars: number };
type MoneyCell = { cell: string; maxDigits: number };
type LineText = { column: string; maxChars: number };
type LineMoney = { column: string; maxDigits: number };

/**
 * 得意先指定の請求書。値を書き込むセルだけを持つ。
 * 数量・単価の列が無い用紙は、その項目を書かない。
 */
export type InvoiceTemplate = {
  id: string;
  fileName: string;
  sheetName: string;
  match: { nameIncludes?: string[]; codes?: string[] };
  cells: {
    customerName?: TextCell;
    issueDate?: { cell: string };
    period?: TextCell;
    projectName?: TextCell;
    staffName?: TextCell;
    headerGross?: MoneyCell;
    net?: MoneyCell;
    tax?: MoneyCell;
    gross?: MoneyCell;
    carryNote?: TextCell;
  };
  lines: {
    startRow: number;
    pageSize: number;
    columns: {
      date?: LineText;
      /** 品名／仕様のように、現場と機種を1つの欄へ入れるとき */
      description?: LineText;
      site?: LineText;
      machine?: LineText;
      qty?: LineMoney;
      price?: LineMoney;
      amount?: LineMoney;
      note?: LineText;
    };
  };
};

export const INVOICE_TEMPLATES: InvoiceTemplate[] = [
  {
    id: 'satsuma',
    fileName: '薩摩建設株式会社請求書.xlsx',
    sheetName: '請求書',
    match: { nameIncludes: ['薩摩建設'] },
    cells: {
      customerName: { cell: 'A4', maxChars: 22 },
      issueDate: { cell: 'L3' },
      projectName: { cell: 'C13', maxChars: 20 },
      staffName: { cell: 'L13', maxChars: 16 },
      headerGross: { cell: 'C10', maxDigits: 8 },
      net: { cell: 'H25', maxDigits: 8 },
      tax: { cell: 'H26', maxDigits: 8 },
      gross: { cell: 'H27', maxDigits: 8 },
      carryNote: { cell: 'K25', maxChars: 12 },
    },
    lines: {
      startRow: 17,
      pageSize: 8,
      columns: {
        date: { column: 'A', maxChars: 5 },
        description: { column: 'B', maxChars: 18 },
        amount: { column: 'H', maxDigits: 8 },
        note: { column: 'K', maxChars: 12 },
      },
    },
  },
];

function sameCode(left: string, right: string) {
  if (left === right) return true;
  return /^\d+$/.test(left) && /^\d+$/.test(right) && Number(left) === Number(right);
}

export function invoiceTemplateFor(name: string, code: string): InvoiceTemplate | undefined {
  return INVOICE_TEMPLATES.find((template) => {
    const codes = template.match.codes ?? [];
    if (codes.some((item) => sameCode(item, code))) return true;
    return (template.match.nameIncludes ?? []).some((key) => name.includes(key));
  });
}
