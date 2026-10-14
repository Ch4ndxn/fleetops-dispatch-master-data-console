import { Technician, Center, Ticket, TechnicianRoutePlan, RouteStop } from '../types';
import { getCenters, getTechnicians, getTickets, getAttendance } from './storage';
import { localDate } from '../lib/date';
import type { RoadMatrix } from './roadRouting';

// ─── Delhi NCR traffic corridor congestion multipliers ────────────
function getCongestionFactor(fromLat: number, fromLng: number, toLat: number, toLng: number, hourOfDay: number): number {
  // NH48 (Delhi–Gurgaon): roughly lat 28.45–28.62, lng 77.00–77.12
  const usesNH48 = (
    (fromLng < 77.13 || toLng < 77.13) &&
    (fromLat < 28.63 && toLat < 28.63) &&
    (fromLat > 28.44 || toLat > 28.44)
  );
  // Noida–Delhi via Mayur Vihar: roughly lng 77.28–77.36, lat 28.58–28.65
  const usesMayurVihar = (
    (fromLng > 77.27 && toLng > 77.27) &&
    (fromLat > 28.57 || toLat > 28.57)
  );

  const isPeakMorning = hourOfDay >= 8 && hourOfDay < 10;
  const isPeakEvening = hourOfDay >= 17 && hourOfDay < 20;

  if ((usesNH48 || usesMayurVihar) && isPeakMorning) return 1.6;
  if ((usesNH48 || usesMayurVihar) && isPeakEvening) return 1.5;
  if (isPeakMorning || isPeakEvening) return 1.3;
  return 1.0;
}

/** Estimated travel time in minutes between two points given a departure hour */
export function travelTimeMins(lat1: number, lng1: number, lat2: number, lng2: number, hourOfDay = 10): number {
  const straightKm = calculateDistanceKmStraight(lat1, lng1, lat2, lng2);
  const congestion = getCongestionFactor(lat1, lng1, lat2, lng2, hourOfDay);
  // Base speed 24 km/h in city traffic; with congestion multiplier applied to time not distance
  const adjustedTimeMins = (straightKm * 1.3 / 24) * 60 * congestion;
  return Math.round(adjustedTimeMins);
}

/** Raw straight-line km (no detour factor) — used internally */
function calculateDistanceKmStraight(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Calculates Haversine distance between two coordinates in Kilometers
 * Applies Delhi NCR city routing detour factor (~1.3×)
 */
export function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const straight = calculateDistanceKmStraight(lat1, lon1, lat2, lon2);
  return Math.round(straight * 1.3 * 10) / 10;
}

/**
 * Route Optimizer algorithm:
 * Uses technician's starting coordinates (Requirement 2: "The route optimizer must use this location as the technician's starting point")
 * and Center coordinates for tickets to build an optimal sequence.
 */
export function planTodayRoutes(): TechnicianRoutePlan[] {
  const technicians = getTechnicians();
  const centers = getCenters();
  const tickets = getTickets();
  const attendance = getAttendance();
  const today = localDate();

  // Map centers for quick lookup
  const centerMap = new Map<string, Center>();
  centers.forEach(c => {
    centerMap.set(c.normalizedName, c);
    centerMap.set(c.name.trim().toLowerCase(), c);
  });

  // Filter available technicians: Active + have coordinates + not excluded from routing
  const techsWithCoords = technicians.filter(t =>
    t.status === 'Active' && !t.excludeFromRouting &&
    t.startingLatitude !== undefined && t.startingLongitude !== undefined
  );

  const attendanceFiltered = techsWithCoords.filter(t => {
    const att = attendance.find(a => a.employeeId.toUpperCase() === t.employeeId.toUpperCase() && a.date === today);
    if (att && att.status !== 'Present' && att.status !== 'Half-Day') return false;
    return true;
  });

  // Technicians explicitly marked Absent / On Leave today are never dispatched.
  // Unmarked technicians are treated as available.
  const availableTechs = attendanceFiltered;

  if (availableTechs.length === 0) {
    return [];
  }

  // Filter active tickets that need routing (Open or Assigned)
  const routableTickets = tickets.filter(tk => {
    if (tk.status === 'Resolved' || tk.status === 'Closed' || tk.ignoreForRouting) return false;
    const center = centerMap.get(tk.centerName.trim().toLowerCase());
    return Boolean(center && center.latitude && center.longitude);
  });

  // Sort tickets by priority score
  const priorityWeights: Record<string, number> = {
    CRITICAL: 100,
    HIGH: 50,
    MEDIUM: 20,
    LOW: 10
  };

  routableTickets.sort((a, b) => {
    return (priorityWeights[b.priority] || 0) - (priorityWeights[a.priority] || 0);
  });

  // Prepare technician plan buckets
  const plans: TechnicianRoutePlan[] = availableTechs.map(tech => ({
    technicianId: tech.id,
    technicianName: tech.name,
    employeeId: tech.employeeId,
    startLat: tech.startingLatitude!,
    startLng: tech.startingLongitude!,
    defaultDc: tech.defaultDc,
    stops: [],
    totalDistanceKm: 0,
    totalEstimatedMins: 0,
    status: 'Draft'
  }));

  // Distribute tickets to closest technician using greedy heuristic
  const unassigned = [...routableTickets];

  for (const ticket of unassigned) {
    const center = centerMap.get(ticket.centerName.trim().toLowerCase())!;

    // Find closest technician (considering current last stop or start point)
    let bestTechIndex = 0;
    let minDistance = Infinity;

    for (let i = 0; i < plans.length; i++) {
      const plan = plans[i];
      // Cap at 5 cases per technician for realistic daily workload
      if (plan.stops.length >= 5) continue;

      const lastLat = plan.stops.length > 0 ? plan.stops[plan.stops.length - 1].latitude : plan.startLat;
      const lastLng = plan.stops.length > 0 ? plan.stops[plan.stops.length - 1].longitude : plan.startLng;

      const dist = calculateDistanceKm(lastLat, lastLng, center.latitude, center.longitude);
      if (dist < minDistance) {
        minDistance = dist;
        bestTechIndex = i;
      }
    }

    if (minDistance < Infinity) {
      const targetPlan = plans[bestTechIndex];
      const stopOrder = targetPlan.stops.length + 1;
      // Estimate arrival: base 09:30 AM + transit time + 45 min per prior job
      const elapsedMins = 30 + (targetPlan.stops.length * 60) + Math.round(minDistance * 2.5); // ~24 km/h Delhi traffic
      const arrivalHour = Math.floor(9 + elapsedMins / 60);
      const arrivalMinute = elapsedMins % 60;
      const arrivalTimeStr = `${String(arrivalHour).padStart(2, '0')}:${String(arrivalMinute).padStart(2, '0')}`;

      const stop: RouteStop = {
        stopOrder,
        ticketId: ticket.ticketId,
        centerName: ticket.centerName,
        vehicleNumber: ticket.vehicleNumber,
        issue: ticket.issue,
        priority: ticket.priority,
        latitude: center.latitude,
        longitude: center.longitude,
        estimatedArrival: arrivalTimeStr,
        estimatedDurationMins: ticket.priority === 'CRITICAL' ? 60 : 45
      };

      targetPlan.stops.push(stop);
      targetPlan.totalDistanceKm = Math.round((targetPlan.totalDistanceKm + minDistance) * 10) / 10;
      targetPlan.totalEstimatedMins += Math.round(minDistance * 2.5) + stop.estimatedDurationMins;
    }
  }

  return plans;
}

// ─────────────────────────────────────────────────────────────────────────────
// BALANCED ROUTE PLANNER
// Proximity-aware + workload-balanced dispatcher:
//   • Assigns tickets to the nearest tech whose cumulative load is under limit
//   • Applies a "load penalty" so an overloaded tech loses the bid even if nearer
//   • Respects maxStopsPerTech and maxKmPerTech constraints
//   • Applies congestion-aware travel-time estimates
//   • Returns { plans, timeSavedMins, balanceScore } for the UI to display
// ─────────────────────────────────────────────────────────────────────────────

export interface BalancedPlanConstraints {
  maxStopsPerTech: number;  // default 8
  maxKmPerTech: number;     // default 80
  priorityFilter: 'critical_high' | 'all';
  skillMatch: boolean;
  shiftStartHour: number;   // e.g. 9
  shiftEndHour: number;     // e.g. 18
  /** When set, only technicians whose city matches are included */
  cityFilter?: string;
  /** Ticket IDs to skip entirely — user excluded them from the plan */
  excludedTicketIds?: Set<string>;
  /** Real road distances/times (OSRM). When given, planning uses road km instead of straight line × 1.3. */
  roadMatrix?: RoadMatrix | null;
  /**
   * Even workload vs short drives: how many extra km a technician is "charged" for each stop
   * above their fair share. Higher = spread work more evenly; lower = less driving. Default 8.
   */
  balanceKm?: number;
}

// ─── Per-city routing constraint presets ─────────────────────────────────────
// Tuned to fleet density, road conditions, and team size per city.
export interface CityConstraintPreset {
  label: string;
  maxStopsPerTech: number;
  maxKmPerTech: number;
  shiftStartHour: number;
  shiftEndHour: number;
  /** Detour factor for road routing (straight-line × factor) */
  detourFactor: number;
  /** Base city traffic speed km/h */
  baseSpeedKmh: number;
  congestionMultiplierPeak: number;
}

export const CITY_PRESETS: Record<string, CityConstraintPreset> = {
  // Delhi NCR — large team (16 techs), dense EV deployment, heavy traffic
  'Delhi NCR': {
    label: 'Delhi NCR',
    maxStopsPerTech: 6,
    maxKmPerTech: 60,
    shiftStartHour: 9,
    shiftEndHour: 18,
    detourFactor: 1.35,
    baseSpeedKmh: 22,
    congestionMultiplierPeak: 1.6,
  },
  // Mumbai — mid team (7 techs), sprawl + suburban rail zones
  'Mumbai': {
    label: 'Mumbai',
    maxStopsPerTech: 5,
    maxKmPerTech: 50,
    shiftStartHour: 9,
    shiftEndHour: 18,
    detourFactor: 1.4,
    baseSpeedKmh: 20,
    congestionMultiplierPeak: 1.7,
  },
  // Bangalore — small team (3 techs), notorious traffic
  'Bangalore': {
    label: 'Bangalore',
    maxStopsPerTech: 4,
    maxKmPerTech: 45,
    shiftStartHour: 9,
    shiftEndHour: 18,
    detourFactor: 1.45,
    baseSpeedKmh: 18,
    congestionMultiplierPeak: 1.8,
  },
  // Pune — default mid-size
  'Pune': {
    label: 'Pune',
    maxStopsPerTech: 6,
    maxKmPerTech: 55,
    shiftStartHour: 9,
    shiftEndHour: 18,
    detourFactor: 1.3,
    baseSpeedKmh: 24,
    congestionMultiplierPeak: 1.4,
  },
  // Hyderabad
  'Hyderabad': {
    label: 'Hyderabad',
    maxStopsPerTech: 6,
    maxKmPerTech: 60,
    shiftStartHour: 9,
    shiftEndHour: 18,
    detourFactor: 1.3,
    baseSpeedKmh: 24,
    congestionMultiplierPeak: 1.4,
  },
  // Chennai
  'Chennai': {
    label: 'Chennai',
    maxStopsPerTech: 6,
    maxKmPerTech: 60,
    shiftStartHour: 9,
    shiftEndHour: 18,
    detourFactor: 1.3,
    baseSpeedKmh: 24,
    congestionMultiplierPeak: 1.4,
  },
};

/** Normalise any city string to a preset key */
export function normaliseCityToPreset(city: string): string {
  const c = city.trim().toLowerCase();
  if (['delhi', 'gurugram', 'gurgaon', 'noida', 'faridabad', 'ghaziabad', 'ncr', 'delhi ncr'].some(k => c.includes(k))) return 'Delhi NCR';
  if (['mumbai', 'thane', 'bhiwandi', 'navi mumbai'].some(k => c.includes(k))) return 'Mumbai';
  if (['bangalore', 'bengaluru'].some(k => c.includes(k))) return 'Bangalore';
  if (c.includes('pune')) return 'Pune';
  if (c.includes('hyderabad')) return 'Hyderabad';
  if (c.includes('chennai')) return 'Chennai';
  return 'Delhi NCR'; // safe default
}

export interface BalancedPlanResult {
  plans: TechnicianRoutePlan[];
  unrouted: Ticket[];
  /** Estimated km saved vs naive round-robin */
  kmSaved: number;
  /** 0–100. 100 = perfectly equal stops per tech */
  balanceScore: number;
  /** Time saved in minutes vs naive assignment (no proximity) */
  timeSavedMins: number;
}

const SPECIALISATION_MAP: Record<string, string[]> = {
  'Battery Specialist': ['battery', 'bms', 'cell', 'charge', 'charging', 'range'],
  'Electrical':         ['electrical', 'wiring', 'motor', 'controller', 'harness', 'fuse'],
  'Mechanical':         ['tyre', 'tire', 'brake', 'suspension', 'axle', 'frame'],
  'General':            [], // handles everything
};

function techCanHandleIssue(tech: Technician, issue: string): boolean {
  const issueL = issue.toLowerCase();
  const spec: string = tech.specialisation || 'General';
  if (spec === 'General' || !spec) return true;
  const keywords = SPECIALISATION_MAP[spec] || [];
  if (keywords.length === 0) return true;
  return keywords.some(kw => issueL.includes(kw));
}

export function planBalancedRoutes(constraints: BalancedPlanConstraints): BalancedPlanResult {
  // Distance / time between two points: real road values when available, otherwise the estimate
  const road = constraints.roadMatrix ?? null;
  const distKmOf = (aLat: number, aLng: number, bLat: number, bLng: number): number =>
    road?.km(aLat, aLng, bLat, bLng) ?? calculateDistanceKm(aLat, aLng, bLat, bLng);
  const travelMinsOf = (aLat: number, aLng: number, bLat: number, bLng: number, hour: number): number => {
    const m = road?.mins(aLat, aLng, bLat, bLng);
    return m === undefined ? travelTimeMins(aLat, aLng, bLat, bLng, hour)
      : Math.round(m * getCongestionFactor(aLat, aLng, bLat, bLng, hour));
  };
  const technicians = getTechnicians();
  const centers = getCenters();
  const tickets = getTickets();
  const attendance = getAttendance();
  const today = localDate();

  // Build center lookup
  const centerMap = new Map<string, Center>();
  centers.forEach(c => {
    centerMap.set(c.name.trim().toLowerCase(), c);
    if (c.normalizedName) centerMap.set(c.normalizedName, c);
  });

  // Available techs: Active + not excluded from routing + Present/unmarked + have coordinates
  const techsWithCoords = technicians.filter(t => {
    if (t.status !== 'Active' || t.excludeFromRouting) return false;
    if (!t.startingLatitude || !t.startingLongitude) return false;
    if (constraints.cityFilter && normaliseCityToPreset(t.city) !== constraints.cityFilter) return false;
    return true;
  });

  const attendanceFilteredTechs = techsWithCoords.filter(t => {
    const att = attendance.find(
      a => a.employeeId.toUpperCase() === t.employeeId.toUpperCase() && a.date === today
    );
    // If attendance marked, must be Present or Half-Day; if not marked yet, include
    if (att && att.status !== 'Present' && att.status !== 'Half-Day') return false;
    return true;
  });

  // Only fall back to unfiltered list if NO attendance records exist for today at all
  // (i.e. attendance hasn't been marked yet). If records exist but everyone is absent, respect that.
  const todayHasAnyAttendance = techsWithCoords.some(t =>
    attendance.some(a => a.employeeId.toUpperCase() === t.employeeId.toUpperCase() && a.date === today)
  );
  const availableTechs = todayHasAnyAttendance
    ? attendanceFilteredTechs
    : techsWithCoords;

  if (availableTechs.length === 0) {
    return { plans: [], unrouted: [], kmSaved: 0, balanceScore: 0, timeSavedMins: 0 };
  }

  // Routable tickets: not closed, center has coordinates, not excluded by user
  const excludedIds = constraints.excludedTicketIds || new Set<string>();
  const priorityWeights: Record<string, number> = { CRITICAL: 1000, HIGH: 100, MEDIUM: 10, LOW: 1 };
  let routableTickets = tickets.filter(tk => {
    if (tk.status === 'Resolved' || tk.status === 'Closed' || tk.ignoreForRouting) return false;
    if (excludedIds.has(tk.ticketId)) return false;
    const center = centerMap.get(tk.centerName.trim().toLowerCase());
    // Planning one city: only that city's tickets (not just its technicians)
    if (constraints.cityFilter && (!center || normaliseCityToPreset(center.city || '') !== constraints.cityFilter)) return false;
    return Boolean(center?.latitude && center?.longitude);
  });

  if (constraints.priorityFilter === 'critical_high') {
    routableTickets = routableTickets.filter(
      tk => tk.priority === 'CRITICAL' || tk.priority === 'HIGH'
    );
  }

  // Sort by priority descending (CRITICAL first)
  routableTickets.sort((a, b) => (priorityWeights[b.priority] || 0) - (priorityWeights[a.priority] || 0));

  // ═══════════════════════════════════════════════════════════════════════
  // Assignment + routing
  //   1. Assign tickets to technicians by distance from BASE, with a fair-share
  //      capacity (tickets ÷ technicians), CRITICAL first. Within a priority, the
  //      ticket that loses most by not getting its nearest technician (regret)
  //      is placed first. Nearest technicians fill up, overflow goes to the next
  //      nearest — so everyone gets work and nobody is sent across the city
  //      while a closer technician has room.
  //   2. Order each route: nearest-next from base, then 2-opt (removes crossings).
  //   3. Enforce km / shift limits: drop the lowest-priority, most costly stop;
  //      try to fit dropped stops into another route (cheapest insertion).
  //   4. Improve: move single stops between technicians when it cuts total km
  //      without unbalancing loads.
  // ═══════════════════════════════════════════════════════════════════════
  type Job = { ticket: Ticket; lat: number; lng: number; mins: number; rank: number };
  const RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  const jobs: Job[] = routableTickets.map(t => {
    const c = centerMap.get(t.centerName.trim().toLowerCase())!;
    return { ticket: t, lat: c.latitude, lng: c.longitude, rank: RANK[t.priority] ?? 3,
      mins: t.priority === 'CRITICAL' ? 70 : t.priority === 'HIGH' ? 55 : 45 };
  });
  const T = availableTechs.length;
  const base: [number, number][] = availableTechs.map(t => [t.startingLatitude!, t.startingLongitude!]);
  const shiftMins = (constraints.shiftEndHour - constraints.shiftStartHour) * 60 + 30; // 30-min overtime buffer
  const baseDist = jobs.map(j => base.map(([la, ln]) => distKmOf(la, ln, j.lat, j.lng)));
  const skillOk = (ji: number, ti: number) => !constraints.skillMatch || techCanHandleIssue(availableTechs[ti], jobs[ji].ticket.issue);
  const reachable = (ji: number, ti: number) => baseDist[ji][ti] <= constraints.maxKmPerTech;

  /** km and minutes (from shift start, incl. 30-min start buffer) of a route */
  function evalRoute(ti: number, seq: number[]): { km: number; mins: number } {
    let km = 0, mins = 30, [la, ln] = base[ti];
    for (const ji of seq) {
      const j = jobs[ji];
      const hour = constraints.shiftStartHour + Math.floor(mins / 60);
      km += distKmOf(la, ln, j.lat, j.lng);
      mins += travelMinsOf(la, ln, j.lat, j.lng, hour) + j.mins;
      la = j.lat; ln = j.lng;
    }
    return { km, mins };
  }
  const feasible = (ti: number, seq: number[]) => {
    if (seq.length > constraints.maxStopsPerTech) return false;
    const r = evalRoute(ti, seq);
    return r.km <= constraints.maxKmPerTech + 1e-9 && r.mins <= shiftMins;
  };
  const routeKm = (ti: number, seq: number[]) => evalRoute(ti, seq).km;

  /** Visit order: nearest-next from base, then 2-opt on the open path */
  function sequence(ti: number, set: number[]): number[] {
    if (set.length < 2) return [...set];
    const rest = [...set];
    let seq: number[] = [];
    let [la, ln] = base[ti];
    while (rest.length) {
      let bi = 0, bd = Infinity;
      rest.forEach((ji, k) => { const d = distKmOf(la, ln, jobs[ji].lat, jobs[ji].lng); if (d < bd) { bd = d; bi = k; } });
      const ji = rest.splice(bi, 1)[0];
      seq.push(ji); la = jobs[ji].lat; ln = jobs[ji].lng;
    }
    let best = routeKm(ti, seq), improved = true, guard = 0;
    while (improved && guard++ < 30) {
      improved = false;
      for (let i = 0; i < seq.length - 1; i++) {
        for (let k = i + 1; k < seq.length; k++) {
          const cand = [...seq.slice(0, i), ...seq.slice(i, k + 1).reverse(), ...seq.slice(k + 1)];
          const km = routeKm(ti, cand);
          if (km < best - 1e-6) { seq = cand; best = km; improved = true; }
        }
      }
    }
    return seq;
  }

  /** Put job ji at the position in seq that adds the least km (feasibility checked by caller) */
  function insertAtBest(ti: number, seq: number[], ji: number): number[] {
    let best = seq, bestKm = Infinity;
    for (let pos = 0; pos <= seq.length; pos++) {
      const cand = [...seq.slice(0, pos), ji, ...seq.slice(pos)];
      const km = routeKm(ti, cand);
      if (km < bestKm) { bestKm = km; best = cand; }
    }
    return best;
  }

  /** Cheapest feasible position for job ji in technician ti's route */
  function bestInsertion(ti: number, seq: number[], ji: number): { seq: number[]; deltaKm: number } | null {
    if (seq.length >= constraints.maxStopsPerTech || !skillOk(ji, ti) || !reachable(ji, ti)) return null;
    const before = routeKm(ti, seq);
    let best: { seq: number[]; deltaKm: number } | null = null;
    for (let pos = 0; pos <= seq.length; pos++) {
      const cand = [...seq.slice(0, pos), ji, ...seq.slice(pos)];
      if (!feasible(ti, cand)) continue;
      const d = routeKm(ti, cand) - before;
      if (!best || d < best.deltaKm) best = { seq: cand, deltaKm: d };
    }
    return best;
  }

  // ── 1. Balanced assignment by distance from base ─────────────────────────
  // Everyone's fair minimum is floor(tickets ÷ technicians), at least 1. Each stop
  // beyond that costs EXTRA_STOP_KM, so a nearby technician only takes another
  // stop when every less-loaded technician is more than that much further away.
  const EXTRA_STOP_KM = constraints.balanceKm ?? 8;
  const target = Math.max(1, Math.ceil(jobs.length / Math.max(1, T)));
  const fairFloor = Math.max(1, Math.floor(jobs.length / Math.max(1, T)));
  const assigned: number[][] = availableTechs.map(() => []);
  const pending = new Set(jobs.map((_, i) => i));
  const unroutedJobs: number[] = [];
  const cost = (ji: number, ti: number) =>
    baseDist[ji][ti] + EXTRA_STOP_KM * Math.max(0, assigned[ti].length + 1 - fairFloor);
  for (let rank = 0; rank <= 3; rank++) {
    for (;;) {
      const tierJobs = [...pending].filter(ji => jobs[ji].rank === rank);
      if (!tierJobs.length) break;
      let pick = -1, pickTech = -1, pickRegret = -Infinity;
      for (const ji of tierJobs) {
        const opts: Array<[number, number]> = [];
        for (let ti = 0; ti < T; ti++) {
          if (assigned[ti].length < constraints.maxStopsPerTech && reachable(ji, ti) && skillOk(ji, ti)) opts.push([ti, cost(ji, ti)]);
        }
        if (!opts.length) { pending.delete(ji); unroutedJobs.push(ji); continue; }
        opts.sort((x, y) => x[1] - y[1]);
        const regret = opts.length > 1 ? opts[1][1] - opts[0][1] : 1e6 - opts[0][1];
        if (regret > pickRegret) { pickRegret = regret; pick = ji; pickTech = opts[0][0]; }
      }
      if (pick === -1) continue; // every remaining ticket in this tier was unreachable (moved to unrouted above)
      assigned[pickTech].push(pick);
      pending.delete(pick);
    }
  }

  // ── 2 + 3. Order routes; enforce km / shift limits ───────────────────────
  const routes: number[][] = assigned.map((set, ti) => sequence(ti, set));
  const dropped: number[] = [];
  routes.forEach((seq, ti) => {
    while (seq.length && !feasible(ti, seq)) {
      // drop the lowest-priority stop whose removal saves the most km
      const worstRank = Math.max(...seq.map(ji => jobs[ji].rank));
      const full = routeKm(ti, seq);
      let bestK = -1, bestSave = -Infinity;
      seq.forEach((ji, k) => {
        if (jobs[ji].rank !== worstRank) return;
        const save = full - routeKm(ti, [...seq.slice(0, k), ...seq.slice(k + 1)]);
        if (save > bestSave) { bestSave = save; bestK = k; }
      });
      dropped.push(seq[bestK]);
      seq.splice(bestK, 1);
    }
    routes[ti] = sequence(ti, seq);
  });
  dropped.sort((x, y) => jobs[x].rank - jobs[y].rank).forEach(ji => {
    let best: { ti: number; seq: number[]; cost: number } | null = null;
    for (let ti = 0; ti < T; ti++) {
      const ins = bestInsertion(ti, routes[ti], ji);
      if (!ins) continue;
      const cost = ins.deltaKm + EXTRA_STOP_KM * Math.max(0, routes[ti].length + 1 - fairFloor); // prefer less-loaded techs
      if (!best || cost < best.cost) best = { ti, seq: ins.seq, cost };
    }
    if (best) routes[best.ti] = best.seq; else unroutedJobs.push(ji);
  });

  // ── 4. Improve: relocate single stops when it cuts total km and keeps balance ─
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (let a = 0; a < T; a++) {
      for (const ji of [...routes[a]]) {
        const fromSeq = routes[a].filter(x => x !== ji);
        const fromNow = routeKm(a, routes[a]);
        const fromAfter = routeKm(a, fromSeq);
        let best: { b: number; seq: number[]; gain: number } | null = null;
        for (let b = 0; b < T; b++) {
          if (b === a) continue;
          // balance guards: never leave a technician idle, never make loads more uneven
          if (routes[a].length <= 1) continue;
          if (routes[b].length + 1 > Math.max(fairFloor, routes[a].length - 1)) continue;
          const ins = bestInsertion(b, routes[b], ji);
          if (!ins) continue;
          const gain = (fromNow - fromAfter) - ins.deltaKm;
          if (gain > 0.5 && (!best || gain > best.gain)) best = { b, seq: ins.seq, gain };
        }
        if (best) {
          routes[a] = sequence(a, fromSeq);
          routes[best.b] = sequence(best.b, best.seq);
          moved = true;
        }
      }
    }
    // Swap: exchange one stop between two technicians — loads stay the same, km drops
    for (let a = 0; a < T; a++) {
      for (let b = a + 1; b < T; b++) {
        if (!routes[a].length || !routes[b].length) continue;
        const kmA = routeKm(a, routes[a]), kmB = routeKm(b, routes[b]);
        let best: { ra: number[]; rb: number[]; gain: number } | null = null;
        for (const x of routes[a]) {
          for (const y of routes[b]) {
            if (!skillOk(y, a) || !skillOk(x, b) || !reachable(y, a) || !reachable(x, b)) continue;
            // each incoming stop goes to its best position; full re-order only if accepted
            const ra = insertAtBest(a, routes[a].filter(v => v !== x), y);
            const rb = insertAtBest(b, routes[b].filter(v => v !== y), x);
            const gain = kmA + kmB - routeKm(a, ra) - routeKm(b, rb);
            if (gain > 0.5 && (!best || gain > best.gain) && feasible(a, ra) && feasible(b, rb)) best = { ra, rb, gain };
          }
        }
        if (best) {
          const ra = sequence(a, best.ra), rb = sequence(b, best.rb);
          routes[a] = feasible(a, ra) ? ra : best.ra;
          routes[b] = feasible(b, rb) ? rb : best.rb;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  // ── Build plans (ETAs from road/estimated travel time) ───────────────────
  const unrouted: Ticket[] = unroutedJobs.map(ji => jobs[ji].ticket);
  const techStates = availableTechs.map((tech, ti) => {
    let mins = 30, km = 0, [la, ln] = base[ti];
    const stops: RouteStop[] = routes[ti].map((ji, k) => {
      const j = jobs[ji];
      const hour = constraints.shiftStartHour + Math.floor(mins / 60);
      km += distKmOf(la, ln, j.lat, j.lng);
      mins += travelMinsOf(la, ln, j.lat, j.lng, hour);
      const arrival = constraints.shiftStartHour * 60 + mins;
      mins += j.mins;
      la = j.lat; ln = j.lng;
      return {
        stopOrder: k + 1, ticketId: j.ticket.ticketId, centerName: j.ticket.centerName,
        vehicleNumber: j.ticket.vehicleNumber, issue: j.ticket.issue, priority: j.ticket.priority as RouteStop['priority'],
        latitude: j.lat, longitude: j.lng, estimatedDurationMins: j.mins,
        estimatedArrival: `${String(Math.floor(arrival / 60)).padStart(2, '0')}:${String(Math.round(arrival % 60)).padStart(2, '0')}`,
      };
    });
    const plan: TechnicianRoutePlan = {
      technicianId: tech.id, technicianName: tech.name, employeeId: tech.employeeId,
      startLat: base[ti][0], startLng: base[ti][1], defaultDc: tech.defaultDc ?? '',
      stops, totalDistanceKm: Math.round(km * 10) / 10, totalEstimatedMins: Math.round(mins), status: 'Draft',
    };
    return { plan, stopCount: stops.length };
  });

  const plans = techStates
    .map(ts => ts.plan)
    .filter(p => p.stops.length > 0);

  // ── Compute balance score ──────────────────────────────────────
  const stopCounts = techStates.map(ts => ts.stopCount).filter(n => n > 0);
  const avgStops  = stopCounts.length ? stopCounts.reduce((a, b) => a + b, 0) / stopCounts.length : 0;
  const variance  = stopCounts.length ? stopCounts.reduce((a, c) => a + (c - avgStops) ** 2, 0) / stopCounts.length : 0;
  const stdDev    = Math.sqrt(variance);
  const balanceScore = avgStops > 0 ? Math.max(0, Math.round(100 - (stdDev / avgStops) * 100)) : 100;

  // ── Compute km saved vs naive round-robin ──────────────────────
  // Naive: ticket[i] → tech[i % N], sorted by priority only
  let naiveKm = 0;
  const naiveLat = availableTechs.map(t => t.startingLatitude!);
  const naiveLng = availableTechs.map(t => t.startingLongitude!);
  routableTickets.forEach((tk, i) => {
    const idx = i % availableTechs.length;
    const c = centerMap.get(tk.centerName.trim().toLowerCase());
    if (!c) return;
    naiveKm += distKmOf(naiveLat[idx], naiveLng[idx], c.latitude, c.longitude);
    naiveLat[idx] = c.latitude; naiveLng[idx] = c.longitude;
  });
  const actualKm = plans.reduce((a, p) => a + p.totalDistanceKm, 0);
  const kmSaved  = Math.round(Math.max(0, naiveKm - actualKm) * 10) / 10;

  // ── Time saved (assume 24 km/h average) ───────────────────────
  const timeSavedMins = Math.round(kmSaved / 24 * 60);

  return { plans, unrouted, kmSaved, balanceScore, timeSavedMins };
}
