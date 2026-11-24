import { readFile } from 'fs/promises';
import path from 'path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { excelSerial, fitMoney, fitText, shortDate, taxOf, yenText } from '@/lib/invoice-fit';
import type { InvoiceDraft, InvoiceLine, InvoiceTemplate } from '@/lib/invoice-templates';

function templatePath(fileName: string) {
  return path.join(process.cwd(), 'templates', fileName);
}

async function loadSheet(template: InvoiceTemplate) {
  const workbook = new ExcelJS.Workbook();
  const bytes = await readFile(templatePath(template.fileName));
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  const sheet = workbook.getWorksheet(template.sheetName);
  if (!sheet) throw new Error(`ひな形にシート「${template.sheetName}」がありません`);
  return { workbook, sheet };
}

function writeText(sheet: ExcelJS.Worksheet, address: string, text: string) {
  if (!text) return;
  sheet.getCell(address).value = text;
}

function writeYen(sheet: ExcelJS.Worksheet, address: string, value: number, maxDigits: number, label: string) {
  const cell = sheet.getCell(address);
  cell.value = yenText(fitMoney(value, maxDigits, label));
  cell.numFmt = '@';
  cell.alignment = { horizontal: 'right', vertical: 'middle', wrapText: false, shrinkToFit: true };
}

function writeMoney(sheet: ExcelJS.Worksheet, address: string, value: number, maxDigits: number, label: string) {
  const cell = sheet.getCell(address);
  cell.value = fitMoney(value, maxDigits, label);
  cell.alignment = { ...(cell.alignment ?? {}), horizontal: 'right', vertical: 'middle', wrapText: false };
}

function descriptionOf(line: InvoiceLine) {
  return [line.site, line.machine].filter(Boolean).join(' ');
}

function fillLines(sheet: ExcelJS.Worksheet, template: InvoiceTemplate, lines: InvoiceLine[]) {
  const { startRow, columns } = template.lines;
  lines.forEach((line, index) => {
    const row = startRow + index;
    if (columns.date) {
      writeText(sheet, `${columns.date.column}${row}`, fitText(shortDate(line.date), columns.date.maxChars));
    }
    if (columns.description) {
      writeText(
        sheet,
        `${columns.description.column}${row}`,
        fitText(descriptionOf(line), columns.description.maxChars)
      );
    }
    if (columns.site) writeText(sheet, `${columns.site.column}${row}`, fitText(line.site, columns.site.maxChars));
    if (columns.machine) {
      writeText(sheet, `${columns.machine.column}${row}`, fitText(line.machine, columns.machine.maxChars));
    }
    if (columns.qty && line.qty != null) {
      sheet.getCell(`${columns.qty.column}${row}`).value = fitMoney(line.qty, columns.qty.maxDigits, '数量');
    }
    if (columns.price && line.price != null) {
      sheet.getCell(`${columns.price.column}${row}`).value = fitMoney(line.price, columns.price.maxDigits, '単価');
    }
    if (columns.amount) {
      writeMoney(sheet, `${columns.amount.column}${row}`, line.amount, columns.amount.maxDigits, '金額');
    }
    if (columns.note) writeText(sheet, `${columns.note.column}${row}`, fitText(line.note, columns.note.maxChars));
  });
}

async function fillPage(template: InvoiceTemplate, draft: InvoiceDraft, lines: InvoiceLine[], page: number, pageCount: number) {
  const { workbook, sheet } = await loadSheet(template);
  const cells = template.cells;
  const net = draft.lines.reduce((sum, line) => sum + line.amount, 0);
  const tax = taxOf(net);
  const gross = net + tax;
  const pageNet = lines.reduce((sum, line) => sum + line.amount, 0);
  const last = page === pageCount - 1;

  if (cells.customerName) {
    const base = draft.customerName.replace(/[　\s]*御中\s*$/, '').trim();
    writeText(sheet, cells.customerName.cell, fitText(`${base}　御中`, cells.customerName.maxChars));
  }
  if (cells.issueDate) sheet.getCell(cells.issueDate.cell).value = excelSerial(draft.issueDate);
  if (cells.period) writeText(sheet, cells.period.cell, fitText(draft.periodLabel, cells.period.maxChars));
  if (cells.projectName) writeText(sheet, cells.projectName.cell, fitText(draft.projectName, cells.projectName.maxChars));
  if (cells.staffName && draft.staffName) {
    const person = draft.staffName.replace(/様$/, '').trim();
    const cell = sheet.getCell(cells.staffName.cell);
    cell.value = fitText(`${person}様`, cells.staffName.maxChars);
    cell.alignment = { horizontal: 'center', vertical: 'middle', shrinkToFit: true };
  }
  if (cells.headerGross) writeYen(sheet, cells.headerGross.cell, gross, cells.headerGross.maxDigits, '請求金額');
  fillLines(sheet, template, lines);
  if (last) {
    if (cells.net) writeMoney(sheet, cells.net.cell, net, cells.net.maxDigits, '税抜合計');
    if (cells.tax) writeMoney(sheet, cells.tax.cell, tax, cells.tax.maxDigits, '消費税');
    if (cells.gross) writeMoney(sheet, cells.gross.cell, gross, cells.gross.maxDigits, '税込合計');
  } else if (cells.net) {
    writeMoney(sheet, cells.net.cell, pageNet, cells.net.maxDigits, '税抜合計');
    if (cells.carryNote) writeText(sheet, cells.carryNote.cell, fitText('次ページへ繰越', cells.carryNote.maxChars));
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return centerInvoicePage(Buffer.from(buffer));
}

/** 84%縮小だと右だけ余る。用紙の左右中央に置く */
async function centerInvoicePage(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const sheetPath = 'xl/worksheets/sheet1.xml';
  let xml = await zip.file(sheetPath)!.async('string');
  xml = xml.replace(/<printOptions\b[^>]*\/>/g, '');
  xml = xml.replace('<pageMargins', '<printOptions horizontalCentered="1"/><pageMargins');
  xml = xml.replace(
    /<pageSetup\b[^>]*\/>/,
    '<pageSetup paperSize="9" scale="84" orientation="portrait"/>'
  );
  zip.file(sheetPath, xml);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

function sharedItems(xml: string): string[] {
  return xml.match(/<si\b[^>]*>[\s\S]*?<\/si>/g) ?? [];
}

function rewriteShared(sheetXml: string, map: Map<number, number>) {
  return sheetXml.replace(/<c r="[^"]+"[^>]*\bt="s"[^>]*>\s*<v>(\d+)<\/v>\s*<\/c>/g, (full, index) => {
    const next = map.get(Number(index));
    if (next == null) return full;
    return full.replace(`<v>${index}</v>`, `<v>${next}</v>`);
  });
}

function rebuildShared(original: string, items: string[]) {
  const declaration = original.startsWith('<?xml') ? original.slice(0, original.indexOf('?>') + 2) : '';
  const open = original.match(/<sst\b[^>]*>/)?.[0];
  if (!open) throw new Error('ひな形の文字列表を読めません');
  let tag = open;
  tag = /uniqueCount="/.test(tag)
    ? tag.replace(/uniqueCount="\d+"/, `uniqueCount="${items.length}"`)
    : tag.replace('<sst', `<sst uniqueCount="${items.length}"`);
  tag = /count="/.test(tag)
    ? tag.replace(/count="\d+"/, `count="${items.length}"`)
    : tag.replace('<sst', `<sst count="${items.length}"`);
  return `${declaration}${tag}${items.join('')}</sst>`;
}

/** ページごとの完成ブックを、同じ印刷設定の複数シートにまとめる */
async function combinePages(buffers: Buffer[], printArea: string) {
  if (buffers.length === 1) return buffers[0];
  const base = await JSZip.loadAsync(buffers[0]);
  const items = sharedItems(await base.file('xl/sharedStrings.xml')!.async('string'));
  let workbookXml = await base.file('xl/workbook.xml')!.async('string');
  let relsXml = await base.file('xl/_rels/workbook.xml.rels')!.async('string');
  let typesXml = await base.file('[Content_Types].xml')!.async('string');
  const used = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map((match) => Number(match[1]));
  let nextRid = Math.max(0, ...used) + 1;

  for (let index = 1; index < buffers.length; index += 1) {
    const extra = await JSZip.loadAsync(buffers[index]);
    const extraItems = sharedItems(await extra.file('xl/sharedStrings.xml')!.async('string'));
    const map = new Map<number, number>();
    extraItems.forEach((item, itemIndex) => {
      map.set(itemIndex, items.length);
      items.push(item);
    });
    const sheetName = `sheet${index + 1}.xml`;
    const sheetXml = rewriteShared(await extra.file('xl/worksheets/sheet1.xml')!.async('string'), map);
    base.file(`xl/worksheets/${sheetName}`, sheetXml);
    const rels = await extra.file('xl/worksheets/_rels/sheet1.xml.rels')!.async('string');
    base.file(`xl/worksheets/_rels/sheet${index + 1}.xml.rels`, rels);
    const title = `請求書${index + 1}`;
    const rid = `rId${nextRid}`;
    nextRid += 1;
    workbookXml = workbookXml.replace(
      '</sheets>',
      `<sheet sheetId="${index + 1}" name="${title}" state="visible" r:id="${rid}"/></sheets>`
    );
    workbookXml = workbookXml.replace(
      '</definedNames>',
      `<definedName name="_xlnm.Print_Area" localSheetId="${index}">&apos;${title}&apos;!${printArea}</definedName></definedNames>`
    );
    relsXml = relsXml.replace(
      '</Relationships>',
      `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/${sheetName}"/></Relationships>`
    );
    typesXml = typesXml.replace(
      '</Types>',
      `<Override PartName="/xl/worksheets/${sheetName}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`
    );
  }

  const originalSst = await base.file('xl/sharedStrings.xml')!.async('string');
  base.file('xl/sharedStrings.xml', rebuildShared(originalSst, items));
  base.file('xl/workbook.xml', workbookXml);
  base.file('xl/_rels/workbook.xml.rels', relsXml);
  base.file('[Content_Types].xml', typesXml);
  return Buffer.from(await base.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

export async function buildInvoiceXlsx(template: InvoiceTemplate, draft: InvoiceDraft) {
  const size = template.lines.pageSize;
  const pages: InvoiceLine[][] = [];
  for (let index = 0; index < draft.lines.length; index += size) pages.push(draft.lines.slice(index, index + size));
  if (pages.length === 0) pages.push([]);
  const buffers: Buffer[] = [];
  for (let page = 0; page < pages.length; page += 1) {
    buffers.push(await fillPage(template, draft, pages[page], page, pages.length));
  }
  return combinePages(buffers, '$A1:$N43');
}
