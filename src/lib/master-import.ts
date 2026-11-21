import ExcelJS from 'exceljs';

export type TableName = 'customers' | 'sites' | 'operators' | 'machine_models' | 'products' | 'customer_contacts';
export type FieldType = 'text' | 'number' | 'bool' | 'date';

type FieldDef = {
  column: string;
  type: FieldType;
  headers: string[];
};

type TableDef = {
  table: TableName;
  label: string;
  sheetNames: string[];
  fields: FieldDef[];
};

export type MappedHeader = { header: string; column: string };

export type ParsedSheet = {
  sheetName: string;
  table: TableName | null;
  label: string;
  importable: number;
  skippedNoCode: number;
  skippedNoName: number;
  duplicateCodes: number;
  mapped: MappedHeader[];
  unmapped: string[];
  ignoredDuplicateHeaders: string[];
  warnings: string[];
  sample: Record<string, string | number | boolean | null>[];
  rows: Record<string, unknown>[];
  error?: string;
};

export type ParsedWorkbook = {
  filename: string;
  sheets: ParsedSheet[];
};

const TABLES: TableDef[] = [
  {
    table: 'customers',
    label: '取引先マスタ',
    sheetNames: ['取引先マスタ', '得意先マスタ', 'customers'],
    fields: [
      { column: 'code', type: 'text', headers: ['得意先コード', '取引先コード', 'code'] },
      { column: 'name', type: 'text', headers: ['得意先名', '取引先名', 'name'] },
      { column: 'kana', type: 'text', headers: ['得意先名フリガナ', 'フリガナ', 'kana'] },
      { column: 'search_word', type: 'text', headers: ['検索ワード', 'search_word'] },
      { column: 'postal_code', type: 'text', headers: ['郵便番号', 'postal_code'] },
      { column: 'address1', type: 'text', headers: ['住所上段', 'address1'] },
      { column: 'address2', type: 'text', headers: ['住所下段', 'address2'] },
      { column: 'tel', type: 'text', headers: ['電話番号', 'tel'] },
      { column: 'tel2', type: 'text', headers: ['電話番号2', 'tel2'] },
      { column: 'fax', type: 'text', headers: ['FAX番号', 'fax'] },
      { column: 'email', type: 'text', headers: ['メールアドレス', 'email'] },
      { column: 'website', type: 'text', headers: ['ホームページ', 'website'] },
      { column: 'sales_staff_code', type: 'text', headers: ['営業担当者コード', 'sales_staff_code'] },
      { column: 'sales_staff_name', type: 'text', headers: ['営業担当者名', 'sales_staff_name'] },
      { column: 'closing_day', type: 'number', headers: ['請求書締日1', 'closing_day'] },
      { column: 'payment_closing_day', type: 'number', headers: ['支払締日', 'payment_closing_day'] },
      { column: 'collection_day', type: 'number', headers: ['回収日1', 'collection_day'] },
      { column: 'collection_month', type: 'number', headers: ['回収月1', 'collection_month'] },
      { column: 'collection_month_name', type: 'text', headers: ['回収月1名称', 'collection_month_name'] },
      { column: 'collection_method', type: 'text', headers: ['回収方法', 'collection_method'] },
      { column: 'status', type: 'text', headers: ['得意先状態区分', 'status'] },
      { column: 'partner_type', type: 'text', headers: ['取引先区分', 'partner_type'] },
      { column: 'notes', type: 'text', headers: ['備考', 'notes'] },
    ],
  },
  {
    table: 'sites',
    label: '現場マスタ',
    sheetNames: ['現場マスタ', 'sites'],
    fields: [
      { column: 'code', type: 'text', headers: ['現場コード', 'code'] },
      { column: 'name', type: 'text', headers: ['現場名', 'name'] },
      { column: 'postal_code', type: 'text', headers: ['〒', '郵便番号', 'postal_code'] },
      { column: 'address', type: 'text', headers: ['住所1', '住所', 'address'] },
      { column: 'tel', type: 'text', headers: ['電話番号', 'tel'] },
      { column: 'office_postal_code', type: 'text', headers: ['事務所〒', '事務所郵便番号', 'office_postal_code'] },
      { column: 'office_address1', type: 'text', headers: ['事務所住所', 'office_address1'] },
      { column: 'office_address2', type: 'text', headers: ['事務所住所下段', 'office_address2'] },
      { column: 'office_tel', type: 'text', headers: ['事務所TEL', 'office_tel'] },
      { column: 'office_fax', type: 'text', headers: ['事務所FAX', 'office_fax'] },
      { column: 'contact_name', type: 'text', headers: ['担当者氏名', 'contact_name'] },
      { column: 'contact_tel', type: 'text', headers: ['担当者TEL', 'contact_tel'] },
      { column: 'contact_name2', type: 'text', headers: ['担当者氏名2', 'contact_name2'] },
      { column: 'contact_tel2', type: 'text', headers: ['担当者TEL2', 'contact_tel2'] },
      { column: 'default_entry_time', type: 'text', headers: ['標準入場時間', 'default_entry_time'] },
      { column: 'customer_name', type: 'text', headers: ['得意先名', 'customer_name'] },
      { column: 'customer_code', type: 'text', headers: ['得意先コード', 'customer_code'] },
      { column: 'notes', type: 'text', headers: ['備考', 'notes'] },
      { column: 'client_site_code', type: 'text', headers: ['客先現場コード', 'client_site_code'] },
      { column: 'construction_no', type: 'text', headers: ['工事番号', 'construction_no'] },
    ],
  },
  {
    table: 'operators',
    label: 'オペレータマスタ',
    sheetNames: ['オペレータマスタ', 'オペレーターマスタ', 'operators'],
    fields: [
      { column: 'code', type: 'text', headers: ['オペレータコード', 'オペレーターコード', 'code'] },
      { column: 'sort_order', type: 'number', headers: ['オペソート順', '表示順', 'sort_order'] },
      { column: 'name', type: 'text', headers: ['オペレータ名', 'オペレーター名', 'name'] },
      { column: 'kana', type: 'text', headers: ['オペレータフリガナ', 'オペレーターフリガナ', 'kana'] },
      { column: 'mobile_tel', type: 'text', headers: ['携帯番号', 'mobile_tel'] },
      { column: 'qualifications', type: 'text', headers: ['資格', 'qualifications'] },
      { column: 'licenses', type: 'text', headers: ['免許', 'licenses'] },
      { column: 'default_product_code', type: 'text', headers: ['標準商品コード', 'default_product_code'] },
      { column: 'large_class', type: 'text', headers: ['オペ大型区分', 'large_class'] },
    ],
  },
  {
    table: 'machine_models',
    label: '機種マスタ',
    sheetNames: ['機種マスタ', 'machine_models'],
    fields: [
      { column: 'code', type: 'text', headers: ['機種ID', '機種コード', 'code'] },
      { column: 'name', type: 'text', headers: ['機種名', 'name'] },
      { column: 'sort_order', type: 'number', headers: ['表示順', 'sort_order'] },
      { column: 'quote_sort_order', type: 'number', headers: ['見積書表示順', 'quote_sort_order'] },
      { column: 'night_standard_price', type: 'number', headers: ['夜間標準単価', 'night_standard_price'] },
      { column: 'owned_count', type: 'number', headers: ['標準保有台数', 'owned_count'] },
    ],
  },
  {
    table: 'products',
    label: '商品マスタ',
    sheetNames: ['商品マスタ', 'products'],
    fields: [
      { column: 'code', type: 'text', headers: ['商品コード', 'code'] },
      { column: 'name', type: 'text', headers: ['商品名', 'name'] },
      { column: 'name2', type: 'text', headers: ['商品名2', 'name2'] },
      { column: 'kana', type: 'text', headers: ['商品名ふりがな', '商品名フリガナ', 'kana'] },
      { column: 'management_no', type: 'text', headers: ['管理番号', 'management_no'] },
      { column: 'category1', type: 'text', headers: ['商品分類1', 'category1'] },
      { column: 'category2', type: 'text', headers: ['商品分類2', 'category2'] },
      { column: 'category3', type: 'text', headers: ['商品分類3', 'category3'] },
      { column: 'dispatch_sort_order', type: 'number', headers: ['自社機配車表ソート順番号', 'dispatch_sort_order'] },
      { column: 'unit_name', type: 'text', headers: ['単位名1', '単位', 'unit_name'] },
      { column: 'operator_code', type: 'text', headers: ['オペレータコード', 'オペレーターコード', 'operator_code'] },
      { column: 'operator_name', type: 'text', headers: ['オペレータ名', 'オペレーター名', 'operator_name'] },
      { column: 'ownership_type', type: 'text', headers: ['自社他社区分', 'ownership_type'] },
      { column: 'base_management_fee', type: 'number', headers: ['基本管理料', 'base_management_fee'] },
      { column: 'insurance_daily', type: 'number', headers: ['保険料日額', 'insurance_daily'] },
      { column: 'insurance_monthly', type: 'number', headers: ['保険料月額', 'insurance_monthly'] },
      { column: 'notes', type: 'text', headers: ['備考1', '備考', 'notes'] },
      { column: 'status', type: 'text', headers: ['商品状態区分', 'status'] },
      { column: 'product_type', type: 'text', headers: ['商品種別', 'product_type'] },
      { column: 'is_scrapped', type: 'bool', headers: ['廃車チェック', 'is_scrapped'] },
      { column: 'inspection_expiry', type: 'date', headers: ['車検満了日', 'inspection_expiry'] },
      { column: 'crane_inspection_expiry', type: 'date', headers: ['クレーン検査満了日', 'crane_inspection_expiry'] },
      { column: 'model_type', type: 'text', headers: ['型式', 'model_type'] },
      { column: 'tonnage', type: 'number', headers: ['t数', 'tonnage'] },
      { column: 'capacity', type: 'text', headers: ['能力', 'capacity'] },
      { column: 'engine', type: 'text', headers: ['エンジン', 'engine'] },
      { column: 'model_year', type: 'text', headers: ['年式', 'model_year'] },
      { column: 'vehicle_large_class', type: 'text', headers: ['車輌大型区分', '車両大型区分', 'vehicle_large_class'] },
      { column: 'tonnage_text', type: 'text', headers: ['t数文字列', 'tonnage_text'] },
      { column: 'lower_inspection_expiry', type: 'date', headers: ['下車検満了日', 'lower_inspection_expiry'] },
      { column: 'upper_inspection_expiry', type: 'date', headers: ['上車検満了日', 'upper_inspection_expiry'] },
    ],
  },
  {
    table: 'customer_contacts',
    label: '担当者マスタ',
    sheetNames: ['担当者マスタ', 'customer_contacts'],
    fields: [
      { column: 'code', type: 'text', headers: ['担当者コード', 'code'] },
      { column: 'customer_code', type: 'text', headers: ['得意先コード', 'customer_code'] },
      { column: 'customer_name', type: 'text', headers: ['得意先名', 'customer_name'] },
      { column: 'name', type: 'text', headers: ['担当者名', 'name'] },
      { column: 'tel', type: 'text', headers: ['電話番号', '携帯番号', 'tel'] },
    ],
  },
];

const TABLE_ORDER: TableName[] = ['customers', 'machine_models', 'operators', 'products', 'sites', 'customer_contacts'];

export function normalizeHeader(raw: string): string {
  return raw.normalize('NFKC').replace(/\s+/g, '').trim();
}

function headerAliases(raw: string): string[] {
  const normalized = normalizeHeader(raw);
  if (!normalized) return [];
  const aliases = [normalized];
  const parts = normalized.split('::');
  if (parts.length > 1 && parts[parts.length - 1]) aliases.push(parts[parts.length - 1]);
  return aliases;
}

function tableBySheetName(sheetName: string): TableDef | null {
  const normalized = normalizeHeader(sheetName);
  return TABLES.find((table) => table.sheetNames.some((name) => normalizeHeader(name) === normalized)) ?? null;
}

function tableByHeaders(headers: string[]): TableDef | null {
  let best: { table: TableDef; score: number; hasCode: boolean } | null = null;
  for (const table of TABLES) {
    const lookup = buildLookup(table);
    let score = 0;
    let hasCode = false;
    const seen = new Set<string>();
    for (const header of headers) {
      const field = headerAliases(header).map((key) => lookup.get(key)).find(Boolean);
      if (!field || seen.has(field.column)) continue;
      seen.add(field.column);
      score += 1;
      if (field.column === 'code') hasCode = true;
    }
    if (hasCode && score >= 3 && (!best || score > best.score)) {
      best = { table, score, hasCode };
    }
  }
  return best?.table ?? null;
}

function buildLookup(table: TableDef): Map<string, FieldDef> {
  const lookup = new Map<string, FieldDef>();
  for (const field of table.fields) {
    for (const header of field.headers) lookup.set(normalizeHeader(header), field);
  }
  return lookup;
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function coerce(raw: string, type: FieldType): string | number | boolean | null {
  const value = type === 'text' ? raw.trim() : raw.normalize('NFKC').trim();
  if (!value) return null;
  if (type === 'number') {
    const numeric = Number(value.replace(/,/g, '').replace(/円/g, ''));
    return Number.isFinite(numeric) ? numeric : null;
  }
  if (type === 'bool') {
    const token = value.toLowerCase();
    if (['1', 'true', 'yes', 'y', 'はい', '有', '済', 'チェック', '廃車', 'on'].includes(token)) return true;
    if (['0', 'false', 'no', 'n', 'いいえ', '無', 'off'].includes(token)) return false;
    return null;
  }
  if (type === 'date') {
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
    const match = value.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})/);
    if (!match) return null;
    return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  }
  return value;
}

function formatExcelDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function readCell(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value == null || value === '') return '';
  if (value instanceof Date) return formatExcelDate(value);
  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('').trim();
    }
    if ('result' in value && value.result != null) {
      const result = value.result;
      if (result instanceof Date) return formatExcelDate(result);
      return String(result).trim();
    }
    if ('text' in value && typeof value.text === 'string') return value.text.trim();
  }
  const text = typeof cell.text === 'string' ? cell.text.trim() : '';
  if (text) return text;
  return String(value).trim();
}

function parseTable(sheetName: string, headerRow: string[], dataRows: { line: number; cells: string[] }[], forced?: TableDef | null): ParsedSheet {
  const named = tableBySheetName(sheetName);
  const detected = named ?? forced ?? (headerRow.length ? tableByHeaders(headerRow) : null);
  const base: ParsedSheet = {
    sheetName,
    table: detected?.table ?? null,
    label: detected?.label ?? sheetName,
    importable: 0,
    skippedNoCode: 0,
    skippedNoName: 0,
    duplicateCodes: 0,
    mapped: [],
    unmapped: [],
    ignoredDuplicateHeaders: [],
    warnings: [],
    sample: [],
    rows: [],
  };

  if (!detected) {
    return {
      ...base,
      error: 'マスタのシート名または列見出しを判別できませんでした',
    };
  }

  const lookup = buildLookup(detected);
  const used = new Set<string>();
  const columns: { index: number; field: FieldDef; header: string }[] = [];

  headerRow.forEach((header, index) => {
    const label = header.trim();
    if (!label) return;
    const field = headerAliases(label).map((key) => lookup.get(key)).find(Boolean);
    if (!field) {
      base.unmapped.push(label);
      return;
    }
    if (used.has(field.column)) {
      base.ignoredDuplicateHeaders.push(label);
      return;
    }
    used.add(field.column);
    columns.push({ index, field, header: label });
    base.mapped.push({ header: label, column: field.column });
  });

  if (!used.has('code')) {
    return { ...base, error: 'コード列が見つかりません。取込にはコードが必要です。' };
  }

  const byCode = new Map<string, Record<string, unknown>>();
  const filledNames: string[] = [];
  for (const dataRow of dataRows) {
    const record: Record<string, unknown> = {};
    let code = '';
    let anyValue = false;
    for (const column of columns) {
      const raw = dataRow.cells[column.index] ?? '';
      if (raw.trim()) anyValue = true;
      const value = coerce(raw, column.field.type);
      if (raw.trim() && value == null && (column.field.type === 'number' || column.field.type === 'date' || column.field.type === 'bool')) {
        if (base.warnings.length < 30) {
          base.warnings.push(`${dataRow.line}行目の「${column.header}」は空として取り込みます（${raw.trim()}）`);
        }
      }
      record[column.field.column] = value;
      if (column.field.column === 'code' && typeof value === 'string') code = value.trim();
    }
    if (!anyValue) continue;
    if (!code) {
      base.skippedNoCode += 1;
      continue;
    }
    if (!textValue(record.name)) {
      const fallback = textValue(record.address) || textValue(record.address1);
      if (fallback) {
        record.name = fallback;
        filledNames.push(code);
      } else if (detected.table === 'sites') {
        record.name = '名称未設定';
        filledNames.push(code);
      } else {
        base.skippedNoName += 1;
        continue;
      }
    }
    if (byCode.has(code)) base.duplicateCodes += 1;
    byCode.set(code, record);
  }

  if (filledNames.length > 0) {
    const sample = filledNames.slice(0, 8).join('、');
    base.warnings.unshift(
      `名称が空の${filledNames.length}件は、住所を名称にして保存します。住所も空の現場は「名称未設定」にします（${sample}）`
    );
  }

  base.rows = [...byCode.values()];
  base.importable = base.rows.length;
  base.sample = base.rows.slice(0, 5).map((row) => {
    const sample: Record<string, string | number | boolean | null> = {};
    for (const [key, value] of Object.entries(row)) {
      if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        sample[key] = value ?? null;
      }
    }
    return sample;
  });
  return base;
}

export function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(current);
      current = '';
    } else if (char === '\n') {
      row.push(current);
      rows.push(row);
      row = [];
      current = '';
    } else {
      current += char;
    }
  }
  if (current.length > 0 || row.length > 0) {
    row.push(current);
    rows.push(row);
  }
  return rows;
}

function decodeCsv(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (!utf8.includes('\uFFFD')) return utf8;
  try {
    return new TextDecoder('shift_jis').decode(bytes);
  } catch {
    return utf8;
  }
}

function rowsFromMatrix(matrix: string[][]): { header: string[]; data: { line: number; cells: string[] }[] } {
  const header = matrix[0] ?? [];
  const data = matrix.slice(1).map((cells, index) => ({ line: index + 2, cells }));
  return { header, data };
}

export async function parseMasterFile(filename: string, buffer: ArrayBuffer): Promise<ParsedWorkbook> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv')) {
    const matrix = parseCsv(decodeCsv(buffer));
    const { header, data } = rowsFromMatrix(matrix);
    return { filename, sheets: [parseTable(filename, header, data)] };
  }

  if (!lower.endsWith('.xlsx')) {
    return {
      filename,
      sheets: [
        {
          sheetName: filename,
          table: null,
          label: filename,
          importable: 0,
          skippedNoCode: 0,
          skippedNoName: 0,
          duplicateCodes: 0,
          mapped: [],
          unmapped: [],
          ignoredDuplicateHeaders: [],
          warnings: [],
          sample: [],
          rows: [],
          error: 'xlsx または csv を指定してください',
        },
      ],
    };
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(buffer) as unknown as ExcelJS.Buffer);
  const singleSheet = workbook.worksheets.length === 1;
  const sheets = workbook.worksheets.map((worksheet) => {
    const header: string[] = [];
    const data: { line: number; cells: string[] }[] = [];
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells: string[] = [];
      const width = worksheet.actualColumnCount || worksheet.columnCount || row.cellCount;
      const last = Math.min(80, Math.max(width, row.cellCount));
      for (let col = 1; col <= last; col += 1) cells.push(readCell(row.getCell(col)));
      if (rowNumber === 1) {
        header.push(...cells);
        return;
      }
      data.push({ line: rowNumber, cells });
    });
    const named = tableBySheetName(worksheet.name);
    if (!named && !singleSheet) {
      return {
        sheetName: worksheet.name,
        table: null,
        label: worksheet.name,
        importable: 0,
        skippedNoCode: 0,
        skippedNoName: 0,
        duplicateCodes: 0,
        mapped: [],
        unmapped: [],
        ignoredDuplicateHeaders: [],
        warnings: [],
        sample: [],
        rows: [],
        error: 'マスタ以外のシートのため取り込み対象外です',
      } satisfies ParsedSheet;
    }
    return parseTable(worksheet.name, header, data, named);
  });

  return { filename, sheets };
}

export function publicSheet(sheet: ParsedSheet): Omit<ParsedSheet, 'rows'> {
  const { rows: _rows, ...rest } = sheet;
  return rest;
}

export function importOrder(names: string[]): TableName[] {
  const selected = new Set(names);
  return TABLE_ORDER.filter((name) => selected.has(name));
}

export const IMPORT_CHUNK_SIZE = 300;
