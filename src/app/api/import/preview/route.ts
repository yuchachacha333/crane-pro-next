import { connection } from 'next/server';
import { parseMasterFile, publicSheet } from '@/lib/master-import';

export async function POST(request: Request) {
  await connection();
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return Response.json({ error: 'ファイルがありません' }, { status: 400 });
  }

  try {
    const parsed = await parseMasterFile(file.name, await file.arrayBuffer());
    return Response.json({
      filename: parsed.filename,
      sheets: parsed.sheets.map(publicSheet),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ファイルを読み取れませんでした';
    return Response.json({ error: message }, { status: 400 });
  }
}
