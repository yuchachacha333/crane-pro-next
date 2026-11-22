import { connection } from 'next/server';

export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const z = Number(url.searchParams.get('z'));
  const x = Number(url.searchParams.get('x'));
  const y = Number(url.searchParams.get('y'));
  const max = 2 ** z;
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y) || z < 5 || z > 18 || x < 0 || y < 0 || x >= max || y >= max) {
    return new Response(null, { status: 400 });
  }

  const sources = [
    `https://cyberjapandata.gsi.go.jp/xyz/std/${z}/${x}/${y}.png`,
    `https://maps.gsi.go.jp/xyz/std/${z}/${x}/${y}.png`,
  ];
  for (const source of sources) {
    try {
      const upstream = await fetch(source, { cache: 'no-store' });
      if (!upstream.ok) continue;
      return new Response(await upstream.arrayBuffer(), {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=86400',
        },
      });
    } catch {
      // 地理院の配信が切れることがあるので、もう一方を試す
    }
  }
  return new Response(null, { status: 502 });
}
