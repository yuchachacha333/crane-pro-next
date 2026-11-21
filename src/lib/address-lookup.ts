export type PostalHit = { zip: string; address: string };

export async function lookupPostal(input: { zip?: string; address?: string }): Promise<PostalHit> {
  const params = new URLSearchParams();
  if (input.zip) params.set('zip', input.zip);
  if (input.address) params.set('address', input.address);
  const response = await fetch(`/api/postal?${params.toString()}`);
  if (!response.ok) return { zip: '', address: '' };
  const body = (await response.json()) as Partial<PostalHit>;
  return { zip: body.zip || '', address: body.address || '' };
}
