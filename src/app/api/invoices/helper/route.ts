import { readFile } from 'fs/promises';
import path from 'path';
import { connection } from 'next/server';
import JSZip from 'jszip';

export async function GET() {
  await connection();
  const root = process.cwd();
  const [cmd, installer, helper] = await Promise.all([
    readFile(path.join(root, 'scripts', 'install-invoice-pdf.cmd')),
    readFile(path.join(root, 'scripts', 'install-invoice-pdf.ps1')),
    readFile(path.join(root, 'scripts', 'invoice-pdf-helper.ps1')),
  ]);
  const note = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(
      '1. このフォルダを解凍する。\r\n2. install-invoice-pdf.cmd をダブルクリックする（一度だけ）。\r\n3. 「設定しました」と出れば完了。以後は自動で始まり、窓は出ません。\r\nExcelが入っているパソコンで行ってください。\r\n',
      'utf8'
    ),
  ]);
  const zip = new JSZip();
  zip.file('install-invoice-pdf.cmd', cmd);
  zip.file('install-invoice-pdf.ps1', installer);
  zip.file('invoice-pdf-helper.ps1', helper);
  zip.file('はじめに.txt', note);
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="invoice-pdf-setup.zip"',
      'Cache-Control': 'no-store',
    },
  });
}
