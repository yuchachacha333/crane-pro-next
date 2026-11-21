import ExcelJS from 'exceljs';

export type ExportJob = {
  work_date: string;
  customer_name: string;
  site_name: string;
  site_address: string;
  requested_model: string;
  assigned_product: string;
  operator_name: string;
  supplier_name: string;
  entry_time: string;
  start_time: string;
  end_time: string;
  work_hours: number | null;
  work_location: string;
  prime_contractor: string;
  contact_name: string;
  contact_tel: string;
  notes: string;
  is_cancelled: boolean;
};

function plainName(value: string): string {
  return String(value || '')
    .replace(/株式会社|有限会社|㈱|㈲|（株）|（有）|\(株\)|\(有\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function minutesOf(value: string): number {
  const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
  if (!match) return 9999;
  return Number(match[1]) * 60 + Number(match[2]);
}

function machineOf(job: ExportJob): string {
  return job.requested_model || (job.assigned_product && job.assigned_product !== '庸車' ? job.assigned_product : '');
}

function whoOf(job: ExportJob): string {
  return job.operator_name || job.supplier_name || '';
}

export function activeJobs(jobs: ExportJob[]): ExportJob[] {
  return jobs
    .filter((job) => !job.is_cancelled)
    .sort((a, b) => minutesOf(a.entry_time) - minutesOf(b.entry_time));
}

function paint(cell: ExcelJS.Cell, fill: string, bold = false) {
  cell.font = { name: 'Yu Gothic', bold, size: bold ? 12 : 11 };
  cell.alignment = { vertical: 'middle', wrapText: true };
  cell.border = {
    top: { style: 'thin' },
    left: { style: 'thin' },
    bottom: { style: 'thin' },
    right: { style: 'thin' },
  };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
}

export async function buildDispatchBook(label: string, jobs: ExportJob[]): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('配車表', { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1 } });
  sheet.columns = [
    { width: 6 },
    { width: 22 },
    { width: 28 },
    { width: 18 },
    { width: 16 },
    { width: 10 },
    { width: 28 },
  ];
  sheet.mergeCells('A1:C1');
  sheet.getCell('A1').value = label;
  sheet.getCell('A1').font = { name: 'Yu Gothic', bold: true, size: 18 };
  sheet.mergeCells('D1:G1');
  sheet.getCell('D1').value = '配車表';
  sheet.getCell('D1').font = { name: 'Yu Gothic', bold: true, size: 18 };
  const headers = ['', 'お客様', '現場', '機種', 'オペレータ／庸車', '着時間', '備考'];
  headers.forEach((header, index) => {
    const cell = sheet.getCell(2, index + 1);
    cell.value = header;
    paint(cell, 'FFD6EAF8', true);
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  sheet.getRow(2).height = 28;
  activeJobs(jobs).forEach((job, index) => {
    const row = sheet.getRow(index + 3);
    row.height = 32;
    const values = [
      index + 1,
      plainName(job.customer_name),
      job.site_name,
      machineOf(job),
      whoOf(job),
      job.entry_time,
      job.notes,
    ];
    values.forEach((value, column) => {
      const cell = row.getCell(column + 1);
      cell.value = value;
      paint(cell, 'FFFFFFFF');
      if (column === 0 || column === 5) cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
  });
  const buffer = await book.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function buildInstructionBook(label: string, jobs: ExportJob[]): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const rows = activeJobs(jobs);
  const targets = rows.length > 0 ? rows : [];
  if (targets.length === 0) {
    book.addWorksheet('作業指示書');
  }
  targets.forEach((job, index) => {
    const title = `${index + 1} ${whoOf(job) || job.site_name || '指示'}`.slice(0, 31);
    const sheet = book.addWorksheet(title || `指示${index + 1}`, {
      pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1 },
    });
    sheet.columns = [{ width: 18 }, { width: 48 }];
    sheet.mergeCells('A1:B1');
    sheet.getCell('A1').value = '作業指示書';
    sheet.getCell('A1').font = { name: 'Yu Gothic', bold: true, size: 20 };
    sheet.getCell('A2').value = label;
    sheet.getCell('A2').font = { name: 'Yu Gothic', size: 12 };
    const hours = [job.start_time, job.end_time].filter(Boolean).join(' – ');
    const hourText = hours + (job.work_hours != null ? `（${job.work_hours}時間）` : '');
    const lines: [string, string][] = [
      ['作業日', job.work_date],
      ['入場時間', job.entry_time],
      ['オペレーター', job.operator_name],
      ['作業時間', hourText],
      ['作業場所', job.work_location || job.site_address],
      ['現場名', job.site_name],
      ['元請', job.prime_contractor || job.customer_name],
      ['機種', machineOf(job)],
      ['担当者', [job.contact_name, job.contact_tel].filter(Boolean).join(' ')],
      ['備考', job.notes],
    ];
    lines.forEach(([caption, value], line) => {
      const rowNumber = line + 4;
      const labelCell = sheet.getCell(rowNumber, 1);
      const valueCell = sheet.getCell(rowNumber, 2);
      labelCell.value = caption;
      valueCell.value = value;
      paint(labelCell, 'FFD6EAF8', true);
      paint(valueCell, 'FFFFFFFF');
      sheet.getRow(rowNumber).height = caption === '備考' ? 48 : 24;
    });
  });
  const buffer = await book.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
