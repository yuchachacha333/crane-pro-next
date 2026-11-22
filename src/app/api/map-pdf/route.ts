import { connection } from 'next/server';

const STYLE = 'yahoojapan/ck7wr02yp09dr1jokvgfbsz7g';
let cachedToken = '';

async function mapToken() {
  if (cachedToken) return cachedToken;
  const page = await fetch(
    `https://map.yahoo.co.jp/embedmap/V3/embedmap?lat=35.68&lon=139.76&zoom=16&cond=${encodeURIComponent('action:place;maptype:twoTones')}`,
    { cache: 'no-store', headers: { 'User-Agent': 'Mozilla/5.0' } }
  );
  const html = await page.text();
  const scripts = [...html.matchAll(/https:\/\/map\.c\.yimg\.jp[^"'\\\s>]+\.js/g)].map((match) => match[0]);
  for (const source of [html, ...scripts]) {
    const text = source.startsWith('https://') ? await (await fetch(source, { cache: 'no-store' })).text() : source;
    const token = text.match(/pk\.ey[A-Za-z0-9._-]+/)?.[0];
    if (token) {
      cachedToken = token;
      return token;
    }
  }
  return '';
}

function project(lat: number, lng: number, zoom: number) {
  const scale = 256 * 2 ** zoom;
  const x = ((lng + 180) / 360) * scale;
  const sine = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * scale;
  return { x, y };
}

function safeName(value: string) {
  const cleaned = value.replace(/[\\/:*?"<>|\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 80) || '地図';
}

export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));
  const width = Math.min(900, Math.max(240, Math.round(Number(url.searchParams.get('w')) || 390)));
  const height = Math.min(1400, Math.max(240, Math.round(Number(url.searchParams.get('h')) || 640)));
  const name = safeName(url.searchParams.get('file') || '地図');
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return new Response(null, { status: 400 });

  const token = await mapToken();
  if (!token) return new Response(null, { status: 502 });
  const zoom = 17;
  const center = project(lat, lng, zoom);
  const left = center.x - width / 2;
  const top = center.y - height / 2;
  const x0 = Math.floor(left / 256);
  const y0 = Math.floor(top / 256);
  const x1 = Math.floor((left + width - 1) / 256);
  const y1 = Math.floor((top + height - 1) / 256);
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({
    unit: 'px',
    format: [width, height],
    orientation: width >= height ? 'l' : 'p',
    hotfixes: ['px_scaling'],
  });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const scaleX = pageW / width;
  const scaleY = pageH / height;

  let drawn = 0;
  for (let x = x0; x <= x1; x += 1) {
    for (let y = y0; y <= y1; y += 1) {
      try {
        const tile = await fetch(
          `https://api.mapbox.com/styles/v1/${STYLE}/tiles/${zoom}/${x}/${y}?access_token=${token}`,
          { headers: { Referer: 'https://map.yahoo.co.jp/' }, cache: 'no-store' }
        );
        if (!tile.ok) continue;
        const data = `data:image/png;base64,${Buffer.from(await tile.arrayBuffer()).toString('base64')}`;
        pdf.addImage(data, 'PNG', (x * 256 - left) * scaleX, (y * 256 - top) * scaleY, 256 * scaleX, 256 * scaleY);
        drawn += 1;
      } catch {
        // 1枚欠けても、取れた範囲でPDFにする
      }
    }
  }
  if (drawn === 0) return new Response(null, { status: 502 });

  const pinX = (width / 2) * scaleX;
  const pinY = (height / 2) * scaleY;
  pdf.setFillColor(255, 255, 255);
  pdf.circle(pinX, pinY, 8 * scaleX, 'F');
  pdf.setFillColor(17, 17, 17);
  pdf.circle(pinX, pinY, 5 * scaleX, 'F');

  const bytes = pdf.output('arraybuffer');
  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="map.pdf"; filename*=UTF-8''${encodeURIComponent(`${name}.pdf`)}`,
      'Cache-Control': 'no-store',
    },
  });
}
