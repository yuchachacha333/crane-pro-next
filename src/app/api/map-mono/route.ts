import { connection } from 'next/server';
import { MAP_STYLE, mapToken } from '@/lib/map-token';

export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const z = Number(url.searchParams.get('z'));
  const x = Number(url.searchParams.get('x'));
  const y = Number(url.searchParams.get('y'));
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 20) return new Response(null, { status: 400 });
  const size = 2 ** z;
  if (x < 0 || y < 0 || x >= size || y >= size) return new Response(null, { status: 404 });
  const token = await mapToken();
  if (!token) return new Response(null, { status: 502 });
  const tile = await fetch(
    `https://api.mapbox.com/styles/v1/${MAP_STYLE}/tiles/${z}/${x}/${y}@2x?access_token=${token}`,
    { headers: { Referer: 'https://map.yahoo.co.jp/' } }
  );
  if (!tile.ok) return new Response(null, { status: 502 });
  return new Response(await tile.arrayBuffer(), {
    headers: {
      'Content-Type': tile.headers.get('content-type') || 'image/png',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
