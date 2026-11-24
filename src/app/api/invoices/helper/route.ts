import { readFile } from 'fs/promises';
import path from 'path';
import { connection } from 'next/server';
import JSZip from 'jszip';

export async function GET() {
  await connection();
  const root = process.cwd();
  const [cmd, helper] = await Promise.all([
    readFile(path.join(root, 'scripts', 'start-invoice-pdf.cmd')),
    readFile(path.join(root, 'scripts', 'invoice-pdf-helper.ps1')),
  ]);
  const note = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(
      '解凍したフォルダの start-invoice-pdf.cmd を開いたままにしてください。\r\nこの窓を閉じると、請求書のPDFは作れません。\r\nExcelが入っている必要があります。\r\n',
      'utf8'
    ),
  ]);
  const zip = new JSZip();
  zip.file('start-invoice-pdf.cmd', cmd);
  zip.file('invoice-pdf-helper.ps1', helper);
  zip.file('はじめに.txt', note);
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="invoice-pdf-helper.zip"',
      'Cache-Control': 'no-store',
    },
  });
}
