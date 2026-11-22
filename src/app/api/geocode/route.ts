import { connection } from 'next/server';

type GsiFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: { title?: string };
};

async function fromGsi(query: string) {
  const response = await fetch(
    `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(query)}`,
    { cache: 'no-store', headers: { Accept: 'application/json' } }
  );
  const items = JSON.parse(await response.text()) as GsiFeature[];
  const first = Array.isArray(items) ? items[0] : undefined;
  const coords = first?.geometry?.coordinates;
  if (!coords || coords.length < 2) return null;
  return {
    lng: Number(coords[0]),
    lat: Number(coords[1]),
    label: first?.properties?.title || query,
  };
}

async function fromGeocodingJp(query: string) {
  const response = await fetch(`https://www.geocoding.jp/api/?q=${encodeURIComponent(query)}`, {
    cache: 'no-store',
    headers: { 'User-Agent': 'crane-pro-next' },
  });
  const xml = await response.text();
  const lat = Number(xml.match(/<lat>([^<]+)<\/lat>/)?.[1]);
  const lng = Number(xml.match(/<lng>([^<]+)<\/lng>/)?.[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  return { lat, lng, label: xml.match(/<address>([^<]*)<\/address>/)?.[1] || query };
}

export async function GET(request: Request) {
  await connection();
  const query = new URL(request.url).searchParams.get('q')?.trim() || '';
  if (query.length < 2) return Response.json({ lat: null, lng: null, label: '' });

  try {
    const found = (await fromGsi(query).catch(() => null)) || (await fromGeocodingJp(query).catch(() => null));
    return Response.json(found || { lat: null, lng: null, label: '' });
  } catch {
    return Response.json({ lat: null, lng: null, label: '' });
  }
}
