export type Point = { lat: number; lng: number };

export function distanceKm(from: Point, to: Point) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const latDelta = toRad(to.lat - from.lat);
  const lngDelta = toRad(to.lng - from.lng);
  const chord =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(lngDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(chord), Math.sqrt(1 - chord));
}

export function formatDistance(km: number) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

export function formatCoordinate(value: number) {
  return value.toFixed(6);
}

export async function geocodeAddress(address: string): Promise<Point | null> {
  const query = address.trim();
  if (query.length < 2) return null;
  const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
  const found = (await response.json()) as { lat: number | null; lng: number | null };
  if (found.lat == null || found.lng == null) return null;
  return { lat: found.lat, lng: found.lng };
}

export function errorMessage(err: unknown, fallback: string) {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string' && err.message) {
    return err.message;
  }
  return fallback;
}

export function missingCoordinateColumn(message: string) {
  return /latitude|longitude|column/i.test(message);
}
