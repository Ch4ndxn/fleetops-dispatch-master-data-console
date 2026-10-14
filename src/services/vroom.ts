/**
 * VROOM (vroom-project.org) — open-source vehicle-routing solver, run as a
 * separate service (vroom-express, see render.yaml). The app sends the day's
 * problem with its own distance/time matrices (OSRM road data when available),
 * so the VROOM service needs no map data of its own.
 */
import type { Center, Technician, Ticket, TechnicianRoutePlan, RouteStop } from '../types';
import type { RoadMatrix } from './roadRouting';

const URL_KEY = 'fo_vroom_url';
/** This deployment's VROOM service on Render (can be changed in the VROOM Routes tab). */
const DEFAULT_VROOM_URL = 'https://fleetops-vroom-engine.onrender.com';

/** Service URL: build-time VITE_VROOM_URL, or one saved in this browser. */
export function getVroomUrl(): string {
  let u = '';
  try { u = localStorage.getItem(URL_KEY) || ''; } catch { /* ignore */ }
  if (!u) u = (import.meta.env.VITE_VROOM_URL as string | undefined) || '';
  if (!u) u = DEFAULT_VROOM_URL;
  u = u.trim().replace(/\/health\/?$/i, '');
  if (!u) return '';
  if (!/^https?:\/\//.test(u)) u = `https://${u}`;
  return u.endsWith('/') ? u : `${u}/`;
}
export function setVroomUrl(url: string): void {
  try { url.trim() ? localStorage.setItem(URL_KEY, url.trim()) : localStorage.removeItem(URL_KEY); } catch { /* ignore */ }
}

export type VroomCheck = { status: 'ok' | 'down' | 'unset'; detail: string };

/** Test the service: GET /health, falling back to a tiny real solve. Explains failures in plain words. */
export async function checkVroom(url = getVroomUrl()): Promise<VroomCheck> {
  if (!url) return { status: 'unset', detail: '' };
  const explain = (code: number) =>
    code === 404 ? 'Render can\'t find a running service at this address (404). Check the URL, and that the service shows "Live" in Render.'
    : code === 502 || code === 503 ? `The service is starting up or has crashed (${code}). Wait a minute and test again, or check its Logs in Render.`
    : `The service answered with an error (${code}).`;
  let lastDetail = '';
  try {
    const r = await fetch(`${url}health`, { signal: AbortSignal.timeout(70_000) }); // a sleeping free server can take ~1 min to wake
    if (r.ok) return { status: 'ok', detail: 'Health check passed' };
    lastDetail = explain(r.status);
  } catch (e) {
    lastDetail = (e as Error).name === 'TimeoutError'
      ? 'No answer within 70 seconds. The service may still be waking up — test again.'
      : 'Can\'t reach this address from the browser (wrong URL, service not running, or blocked).';
  }
  // Fallback: a minimal real problem (some setups don't expose /health)
  try {
    const r = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ vehicles: [{ id: 1, start_index: 0 }], jobs: [{ id: 1, location_index: 1 }], matrices: { car: { durations: [[0, 60], [60, 0]] } } }),
    });
    const d = await r.json().catch(() => null);
    if (r.ok && d && d.code === 0) return { status: 'ok', detail: 'Test solve passed' };
  } catch { /* keep the health-check explanation */ }
  return { status: 'down', detail: lastDetail };
}

export interface VroomInput {
  techs: Technician[];
  tickets: Ticket[];
  centers: Center[];
  maxStops: number;
  maxKm: number;
  shiftStart: number;
  shiftEnd: number;
  /** 'short' = only the stop limit; 'balanced' / 'even' = per-technician caps near the fair share */
  mode: 'short' | 'balanced' | 'even';
  roadMatrix: RoadMatrix | null;
}
export interface VroomResult {
  plans: TechnicianRoutePlan[];
  unrouted: Ticket[];
  /** stop cap per technician that VROOM was finally run with */
  capUsed: number;
  solveMs: number;
}

const SERVICE_MIN: Record<string, number> = { CRITICAL: 70, HIGH: 55, MEDIUM: 45, LOW: 45 };
const PRIORITY: Record<string, number> = { CRITICAL: 100, HIGH: 60, MEDIUM: 30, LOW: 0 };

function hav(aLat: number, aLng: number, bLat: number, bLng: number) {
  const t = Math.PI / 180;
  const x = Math.sin((bLat - aLat) * t / 2) ** 2 + Math.cos(aLat * t) * Math.cos(bLat * t) * Math.sin((bLng - aLng) * t / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(x));
}

export async function solveWithVroom(input: VroomInput, url = getVroomUrl()): Promise<VroomResult> {
  if (!url) throw new Error('VROOM service URL is not set');
  const centerOf = new Map(input.centers.map(c => [c.name.trim().toLowerCase(), c]));
  const jobsAll = input.tickets
    .map(t => ({ t, c: centerOf.get(t.centerName.trim().toLowerCase()) }))
    .filter((x): x is { t: Ticket; c: Center } => Boolean(x.c && Number.isFinite(x.c.latitude) && Number.isFinite(x.c.longitude)));
  const techs = input.techs.filter(t => t.startingLatitude != null && t.startingLongitude != null);
  if (!techs.length || !jobsAll.length) return { plans: [], unrouted: input.tickets, capUsed: 0, solveMs: 0 };

  // Locations: technician bases, then ticket centers (deduplicated)
  const locs: [number, number][] = [];
  const locIndex = new Map<string, number>();
  const idx = (lat: number, lng: number) => {
    const k = `${lat.toFixed(6)},${lng.toFixed(6)}`;
    if (!locIndex.has(k)) { locIndex.set(k, locs.length); locs.push([lat, lng]); }
    return locIndex.get(k)!;
  };
  const techLoc = techs.map(t => idx(t.startingLatitude!, t.startingLongitude!));
  const jobLoc = jobsAll.map(j => idx(j.c.latitude, j.c.longitude));

  // Matrices: road distance/time when available, else estimate (straight line × 1.3 at 24 km/h)
  const n = locs.length;
  const distances: number[][] = [], durations: number[][] = [];
  for (let i = 0; i < n; i++) {
    distances.push([]); durations.push([]);
    for (let j = 0; j < n; j++) {
      const [a, b] = [locs[i], locs[j]];
      const km = i === j ? 0 : (input.roadMatrix?.km(a[0], a[1], b[0], b[1]) ?? Math.round(hav(a[0], a[1], b[0], b[1]) * 1.3 * 10) / 10);
      const mins = i === j ? 0 : (input.roadMatrix?.mins(a[0], a[1], b[0], b[1]) ?? (km / 24) * 60);
      distances[i].push(Math.round(km * 1000));
      durations[i].push(Math.round(mins * 60));
    }
  }

  const fair = Math.ceil(jobsAll.length / techs.length);
  let cap = input.mode === 'short' ? input.maxStops
    : Math.min(input.maxStops, input.mode === 'even' ? fair : fair + 1);
  const started = performance.now();
  // Best answer so far: raising the cap is only worth it if it plans MORE tickets
  let bestData: any = null, bestCap = cap, bestUnassigned = Infinity; // eslint-disable-line @typescript-eslint/no-explicit-any

  for (;;) {
    const body = {
      vehicles: techs.map((t, i) => ({
        id: i + 1, profile: 'car', description: t.id,
        start_index: techLoc[i],                         // open route: no return to base
        time_window: [input.shiftStart * 3600, input.shiftEnd * 3600 + 1800], // 30-min overtime buffer, as the built-in planner
        max_tasks: cap,
        max_distance: Math.round(input.maxKm * 1000),
      })),
      jobs: jobsAll.map((j, k) => ({
        id: k + 1, description: j.t.ticketId, location_index: jobLoc[k],
        service: (SERVICE_MIN[j.t.priority] ?? 45) * 60,
        priority: PRIORITY[j.t.priority] ?? 0,
      })),
      matrices: { car: { durations, distances, costs: distances } }, // minimise km driven
    };
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(90_000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.code !== 0) throw new Error(data?.error || `VROOM error (HTTP ${res.status})`);

    const unassigned = (data.unassigned ?? []).length;
    if (unassigned < bestUnassigned) { bestData = data; bestCap = cap; bestUnassigned = unassigned; }
    // Tickets left out and room to loosen the fair-share cap → try once more,
    // but stop as soon as loosening no longer plans additional tickets
    if (unassigned && cap < input.maxStops && unassigned <= bestUnassigned && bestData === data) { cap++; continue; }
    const final = bestData; cap = bestCap;

    const plans: TechnicianRoutePlan[] = (final.routes ?? []).map((r: { vehicle: number; steps: Array<{ type: string; id?: number; arrival: number }> }) => {
      const ti = r.vehicle - 1, tech = techs[ti];
      let km = 0, prev = techLoc[ti];
      const stops: RouteStop[] = r.steps.filter(s => s.type === 'job').map((s, k) => {
        const j = jobsAll[(s.id ?? 0) - 1];
        km += distances[prev][jobLoc[(s.id ?? 0) - 1]] / 1000; prev = jobLoc[(s.id ?? 0) - 1];
        const mins = Math.round(s.arrival / 60);
        return {
          stopOrder: k + 1, ticketId: j.t.ticketId, centerName: j.t.centerName, vehicleNumber: j.t.vehicleNumber,
          issue: j.t.issue, priority: j.t.priority as RouteStop['priority'], latitude: j.c.latitude, longitude: j.c.longitude,
          estimatedDurationMins: SERVICE_MIN[j.t.priority] ?? 45, ticketStatus: j.t.status,
          estimatedArrival: `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`,
        };
      });
      const last = r.steps[r.steps.length - 1];
      return {
        technicianId: tech.id, technicianName: tech.name, employeeId: tech.employeeId,
        startLat: tech.startingLatitude!, startLng: tech.startingLongitude!, defaultDc: tech.defaultDc ?? '',
        stops, totalDistanceKm: Math.round(km * 10) / 10,
        totalEstimatedMins: Math.round(((last?.arrival ?? 0) - input.shiftStart * 3600) / 60), status: 'Draft',
      } as TechnicianRoutePlan;
    }).filter((p: TechnicianRoutePlan) => p.stops.length > 0);

    const routedIds = new Set(plans.flatMap(p => p.stops.map(s => s.ticketId)));
    return {
      plans,
      unrouted: input.tickets.filter(t => !routedIds.has(t.ticketId)),
      capUsed: cap,
      solveMs: Math.round(performance.now() - started),
    };
  }
}
