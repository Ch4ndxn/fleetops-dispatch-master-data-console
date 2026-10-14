/**
 * Road routing (OSRM) — real driving distance and time instead of straight-line
 * displacement.
 *
 *  • fetchRoadMatrix(points): road km + minutes between every pair of points in
 *    ONE request (OSRM /table). Used by the optimizer to plan by road distance.
 *  • fetchRoadRoute(points): the road path through a sequence of points, with
 *    its road km and minutes (OSRM /route). Used to draw routes on maps.
 *
 * Both are cached, retried on a second server, and return null on failure so
 * callers can fall back to the estimate (straight line × 1.3).
 */

export type LatLng = [number, number];

const SERVERS = [
  'https://router.project-osrm.org',
  'https://routing.openstreetmap.de/routed-car',
];
/** Public OSRM servers reject very large tables. */
const MAX_TABLE_POINTS = 100;
const TIMEOUT_MS = 12_000;

const key = ([lat, lng]: LatLng) => `${lat.toFixed(5)},${lng.toFixed(5)}`;
const toOsrm = (pts: LatLng[]) => pts.map(([lat, lng]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';');

// Requests go one at a time with a short gap — the public servers rate-limit bursts.
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.then(() => new Promise(r => setTimeout(r, 250)), () => new Promise(r => setTimeout(r, 250)));
  return run;
}

async function getJson(path: string): Promise<any | null> { // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const server of SERVERS) {
    try {
      const res = await fetch(`${server}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) continue;
      const data = await res.json();
      if (data && data.code === 'Ok') return data;
    } catch { /* try the next server */ }
  }
  return null;
}

// ── Distance matrix ──────────────────────────────────────────────
export interface RoadMatrix {
  /** Road km from a to b, or undefined if either point wasn't in the matrix. */
  km(aLat: number, aLng: number, bLat: number, bLng: number): number | undefined;
  /** Free-flow driving minutes from a to b. */
  mins(aLat: number, aLng: number, bLat: number, bLng: number): number | undefined;
  pointCount: number;
}

const matrixCache = new Map<string, Promise<RoadMatrix | null>>();

export function fetchRoadMatrix(points: LatLng[]): Promise<RoadMatrix | null> {
  const unique = [...new Map(points.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1])).map(p => [key(p), p])).values()];
  if (unique.length < 2 || unique.length > MAX_TABLE_POINTS) return Promise.resolve(null);
  const cacheKey = unique.map(key).sort().join('|');
  if (!matrixCache.has(cacheKey)) {
    const job = enqueue(async () => {
      const data = await getJson(`/table/v1/driving/${toOsrm(unique)}?annotations=distance,duration`);
      if (!data?.distances || !data?.durations) return null;
      const index = new Map(unique.map((p, i) => [key(p), i]));
      const at = (table: (number | null)[][], aLat: number, aLng: number, bLat: number, bLng: number) => {
        const i = index.get(key([aLat, aLng])), j = index.get(key([bLat, bLng]));
        if (i === undefined || j === undefined) return undefined;
        const v = table[i]?.[j];
        return v == null ? undefined : v;
      };
      const matrix: RoadMatrix = {
        pointCount: unique.length,
        km: (a, b, c, d) => { const m = at(data.distances, a, b, c, d); return m === undefined ? undefined : Math.round(m / 100) / 10; },
        mins: (a, b, c, d) => { const s = at(data.durations, a, b, c, d); return s === undefined ? undefined : s / 60; },
      };
      return matrix;
    });
    matrixCache.set(cacheKey, job);
    job.then(m => { if (!m) matrixCache.delete(cacheKey); }); // don't cache failures
  }
  return matrixCache.get(cacheKey)!;
}

// ── Route geometry ───────────────────────────────────────────────
export interface RoadRoute { path: LatLng[]; km: number; mins: number }
const routeCache = new Map<string, Promise<RoadRoute | null>>();

export function fetchRoadRoute(points: LatLng[]): Promise<RoadRoute | null> {
  const pts = points.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (pts.length < 2) return Promise.resolve(null);
  const cacheKey = pts.map(key).join('>');
  if (!routeCache.has(cacheKey)) {
    const job = enqueue(async () => {
      const data = await getJson(`/route/v1/driving/${toOsrm(pts)}?overview=full&geometries=geojson`);
      const r = data?.routes?.[0];
      if (!r?.geometry?.coordinates) return null;
      return {
        path: (r.geometry.coordinates as [number, number][]).map(([lng, lat]) => [lat, lng] as LatLng),
        km: Math.round(r.distance / 100) / 10,
        mins: Math.round(r.duration / 60),
      };
    });
    routeCache.set(cacheKey, job);
    job.then(r => { if (!r) routeCache.delete(cacheKey); });
  }
  return routeCache.get(cacheKey)!;
}
