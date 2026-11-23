export const MAP_STYLE = 'yahoojapan/ck7wr02yp09dr1jokvgfbsz7g';

let cachedToken = '';

export async function mapToken() {
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
