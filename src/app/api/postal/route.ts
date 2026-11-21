import { connection } from 'next/server';

type ZipItem = { zipcode?: string; pref?: string; address?: string };

function formatZip(digits: string): string {
  const clean = digits.replace(/\D/g, '');
  if (clean.length !== 7) return '';
  return `${clean.slice(0, 3)}-${clean.slice(3)}`;
}

function pickZip(query: string, items: ZipItem[]): string {
  const text = query.replace(/\s+/g, '');
  let best = '';
  let bestLength = 0;
  for (const item of items) {
    const town = String(item.address || '').replace(/\s+/g, '');
    const full = `${String(item.pref || '').replace(/\s+/g, '')}${town}`;
    let matched = '';
    if (full && text.includes(full)) matched = full;
    else if (town.length >= 3 && text.includes(town)) matched = town;
    if (matched.length > bestLength) {
      bestLength = matched.length;
      best = String(item.zipcode || '').replace(/\D/g, '');
    }
  }
  return formatZip(best);
}

export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const zip = (url.searchParams.get('zip') || '').replace(/\D/g, '');
  const address = (url.searchParams.get('address') || '').replace(/\s+/g, '');

  try {
    if (zip.length === 7) {
      const response = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip}`);
      const json = (await response.json()) as { results?: { address1: string; address2: string; address3: string }[] | null };
      const found = json.results?.[0];
      return Response.json({
        zip: formatZip(zip),
        address: found ? `${found.address1}${found.address2}${found.address3}` : '',
      });
    }

    if (address.length >= 4) {
      const response = await fetch(`https://zipcoda.net/api?address=${encodeURIComponent(address)}`);
      const json = (await response.json()) as { items?: ZipItem[] };
      return Response.json({ zip: pickZip(address, json.items || []), address: '' });
    }
  } catch {
    return Response.json({ zip: '', address: '' });
  }

  return Response.json({ zip: '', address: '' });
}
