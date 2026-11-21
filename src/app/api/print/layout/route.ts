import { connection } from 'next/server';
import { readPrintLayout } from '@/lib/sheet-layout';

export async function GET(request: Request) {
  await connection();
  const file = new URL(request.url).searchParams.get('file') || '';
  try {
    const layout = await readPrintLayout(file);
    return Response.json({ layout });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ひな形を読めませんでした';
    return Response.json({ error: message }, { status: 400 });
  }
}
