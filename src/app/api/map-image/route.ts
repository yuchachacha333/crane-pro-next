import { connection } from 'next/server';
import { MAP_STYLE, mapToken } from '@/lib/map-token';

export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));
  const zoom = Number(url.searchParams.get('zoom'));
  const width = Math.min(1280, Math.max(200, Math.round(Number(url.searchParams.get('w')) || 1000)));
  const height = Math.min(1280, Math.max(200, Math.round(Number(url.searchParams.get('h')) || 700)));
  const pinLat = Number(url.searchParams.get('plat'));
  const pinLng = Number(url.searchParams.get('plng'));
  if (![lat, lng, zoom].every(Number.isFinite)) return new Response(null, { status: 400 });

  const token = await mapToken();
  if (!token) return new Response(null, { status: 502 });

  const overlay = Number.isFinite(pinLat) && Number.isFinite(pinLng) ? `pin-m+111(${pinLng.toFixed(6)},${pinLat.toFixed(6)})/` : '';
  const imageUrl =
    `https://api.mapbox.com/styles/v1/${MAP_STYLE}/static/${overlay}` +
    `${lng.toFixed(6)},${lat.toFixed(6)},${Math.min(22, Math.max(0, zoom)).toFixed(3)},0/` +
    `${width}x${height}@2x?access_token=${token}`;
  const image = await fetch(imageUrl, { cache: 'no-store', headers: { Referer: 'https://map.yahoo.co.jp/' } });
  if (!image.ok) return new Response(null, { status: 502 });
  return new Response(await image.arrayBuffer(), {
    headers: {
      'Content-Type': image.headers.get('content-type') || 'image/png',
      'Cache-Control': 'no-store',
    },
  });
}
