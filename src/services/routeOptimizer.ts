import { Technician, Center, Ticket, TechnicianRoutePlan, RouteStop } from '../types';
import { getCenters, getTechnicians, getTickets, getAttendance } from './storage';

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
  const today = new Date().toISOString().split('T')[0];

  // Map centers for quick lookup
  const centerMap = new Map<string, Center>();
  centers.forEach(c => {
    centerMap.set(c.normalizedName, c);
    centerMap.set(c.name.trim().toLowerCase(), c);
  });

  // Filter available technicians: Active + have coordinates
  const techsWithCoords = technicians.filter(t =>
    t.status === 'Active' && t.startingLatitude !== undefined && t.startingLongitude !== undefined
  );

  const attendanceFiltered = techsWithCoords.filter(t => {
    const att = attendance.find(a => a.employeeId.toUpperCase() === t.employeeId.toUpperCase() && a.date === today);
    if (att && att.status !== 'Present' && att.status !== 'Half-Day') return false;
    return true;
  });

  // Fall back to all active techs if attendance filter leaves ≤1
  const availableTechs = attendanceFiltered.length >= 2 ? attendanceFiltered : techsWithCoords;

  if (availableTechs.length === 0) {
    return [];
  }

  // Filter active tickets that need routing (Open or Assigned)
  const routableTickets = tickets.filter(tk => {
    if (tk.status === 'Resolved' || tk.status === 'Closed') return false;
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
  /** Ticket IDs to skip entirely — user excluded them from the plan */
  excludedTicketIds?: Set<string>;
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
  const spec = tech.specialisation || 'General';
  if (spec === 'General') return true;
  const keywords = SPECIALISATION_MAP[spec] || [];
  if (keywords.length === 0) return true;
  return keywords.some(kw => issueL.includes(kw));
}

export function planBalancedRoutes(constraints: BalancedPlanConstraints): BalancedPlanResult {
  const technicians = getTechnicians();
  const centers = getCenters();
  const tickets = getTickets();
  const attendance = getAttendance();
  const today = new Date().toISOString().split('T')[0];

  // Build center lookup
  const centerMap = new Map<string, Center>();
  centers.forEach(c => {
    centerMap.set(c.name.trim().toLowerCase(), c);
    if (c.normalizedName) centerMap.set(c.normalizedName, c);
  });

  // Available techs: Active + Present/unmarked + have coordinates
  const techsWithCoords = technicians.filter(t =>
    t.status === 'Active' && t.startingLatitude && t.startingLongitude
  );

  const attendanceFilteredTechs = techsWithCoords.filter(t => {
    const att = attendance.find(
      a => a.employeeId.toUpperCase() === t.employeeId.toUpperCase() && a.date === today
    );
    // If attendance marked, must be Present or Half-Day; if not marked yet, include
    if (att && att.status !== 'Present' && att.status !== 'Half-Day') return false;
    return true;
  });

  // If attendance filtering leaves ≤1 tech, fall back to all Active techs with coords
  // (attendance data may not be marked yet for today)
  const availableTechs = attendanceFilteredTechs.length >= 2
    ? attendanceFilteredTechs
    : techsWithCoords;

  if (availableTechs.length === 0) {
    return { plans: [], unrouted: [], kmSaved: 0, balanceScore: 0, timeSavedMins: 0 };
  }

  // Routable tickets: not closed, center has coordinates, not excluded by user
  const excludedIds = constraints.excludedTicketIds || new Set<string>();
  const priorityWeights: Record<string, number> = { CRITICAL: 1000, HIGH: 100, MEDIUM: 10, LOW: 1 };
  let routableTickets = tickets.filter(tk => {
    if (tk.status === 'Resolved' || tk.status === 'Closed') return false;
    if (excludedIds.has(tk.ticketId)) return false;
    const center = centerMap.get(tk.centerName.trim().toLowerCase());
    return Boolean(center?.latitude && center?.longitude);
  });

  if (constraints.priorityFilter === 'critical_high') {
    routableTickets = routableTickets.filter(
      tk => tk.priority === 'CRITICAL' || tk.priority === 'HIGH'
    );
  }

  // Sort by priority descending (CRITICAL first)
  routableTickets.sort((a, b) => (priorityWeights[b.priority] || 0) - (priorityWeights[a.priority] || 0));

  // Tech state tracking
  type TechState = {
    plan: TechnicianRoutePlan;
    curLat: number;
    curLng: number;
    totalKm: number;
    totalMins: number;    // running elapsed minutes since shift start
    stopCount: number;
  };

  const techStates: TechState[] = availableTechs.map(tech => ({
    plan: {
      technicianId: tech.id,
      technicianName: tech.name,
      employeeId: tech.employeeId,
      startLat: tech.startingLatitude!,
      startLng: tech.startingLongitude!,
      defaultDc: tech.defaultDc ?? '',
      stops: [],
      totalDistanceKm: 0,
      totalEstimatedMins: 0,
      status: 'Draft' as const,
    },
    curLat: tech.startingLatitude!,
    curLng: tech.startingLongitude!,
    totalKm: 0,
    totalMins: 30, // 30-min buffer from shift start before first stop
    stopCount: 0,
  }));

  const shiftDurationMins = (constraints.shiftEndHour - constraints.shiftStartHour) * 60;
  const unrouted: Ticket[] = [];

  // ── CRITICAL-first pass: assign each CRITICAL ticket to the nearest AVAILABLE tech ──
  // then ── remaining tickets via balanced greedy ──

  for (const ticket of routableTickets) {
    const center = centerMap.get(ticket.centerName.trim().toLowerCase())!;
    const durationMins = ticket.priority === 'CRITICAL' ? 70 : ticket.priority === 'HIGH' ? 55 : 45;

    // Compute score for each tech (lower = better)
    let bestIdx = -1;
    let bestScore = Infinity;

    for (let i = 0; i < techStates.length; i++) {
      const ts = techStates[i];

      // Hard constraints
      if (ts.stopCount >= constraints.maxStopsPerTech) continue;
      if (ts.totalKm >= constraints.maxKmPerTech) continue;

      // Skill matching
      const tech = availableTechs[i];
      if (constraints.skillMatch && !techCanHandleIssue(tech, ticket.issue)) continue;

      // Remaining capacity (as a fraction, 0=full, 1=empty)
      const stopCapLeft = 1 - ts.stopCount / constraints.maxStopsPerTech;
      const kmCapLeft   = 1 - ts.totalKm   / constraints.maxKmPerTech;
      const timeCapLeft = 1 - ts.totalMins  / shiftDurationMins;
      const capacityLeft = Math.min(stopCapLeft, kmCapLeft, timeCapLeft);
      if (capacityLeft <= 0) continue;

      // Proximity: travel time to next stop given current hour
      const currentHour = constraints.shiftStartHour + Math.floor(ts.totalMins / 60);
      const travelMins = travelTimeMins(ts.curLat, ts.curLng, center.latitude, center.longitude, currentHour);
      const distKm = calculateDistanceKm(ts.curLat, ts.curLng, center.latitude, center.longitude);

      // Remaining shift time after this stop
      const minsAfterStop = ts.totalMins + travelMins + durationMins;
      if (minsAfterStop > shiftDurationMins + 30) continue; // 30-min OT buffer

      // LOAD PENALTY: techs with more stops than average get a heavy penalty
      // This forces even distribution — an overloaded tech loses the bid even if nearest
      const eligibleCounts = techStates.map(t => t.stopCount);
      const avgStops = eligibleCounts.reduce((s, n) => s + n, 0) / Math.max(1, techStates.length);
      // Very strong penalty: each stop above average multiplies score by 2×
      // At 1 stop above avg → 2× penalty, 2 stops above → 3× etc.
      const loadPenaltyFactor = 1 + Math.max(0, ts.stopCount - avgStops) * 1.5;

      // SCORE = (travel_time × load_penalty) + distance_penalty (lower = better candidate)
      // Load penalty dominates so work distributes evenly before proximity matters
      const score = travelMins * loadPenaltyFactor + distKm * 0.2;

      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) {
      unrouted.push(ticket);
      continue;
    }

    const ts = techStates[bestIdx];
    const currentHour = constraints.shiftStartHour + Math.floor(ts.totalMins / 60);
    const travelMins = travelTimeMins(ts.curLat, ts.curLng, center.latitude, center.longitude, currentHour);
    const distKm = calculateDistanceKm(ts.curLat, ts.curLng, center.latitude, center.longitude);

    ts.totalMins += travelMins + durationMins;
    ts.totalKm   += distKm;
    ts.stopCount++;

    const arrivalMins = constraints.shiftStartHour * 60 + ts.totalMins - durationMins;
    const arrH = Math.floor(arrivalMins / 60);
    const arrM = arrivalMins % 60;

    const stop: RouteStop = {
      stopOrder: ts.plan.stops.length + 1,
      ticketId: ticket.ticketId,
      centerName: ticket.centerName,
      vehicleNumber: ticket.vehicleNumber,
      issue: ticket.issue,
      priority: ticket.priority as RouteStop['priority'],
      latitude: center.latitude,
      longitude: center.longitude,
      estimatedArrival: `${String(arrH).padStart(2, '0')}:${String(arrM).padStart(2, '0')}`,
      estimatedDurationMins: durationMins,
    };

    ts.plan.stops.push(stop);
    ts.plan.totalDistanceKm = Math.round(ts.totalKm * 10) / 10;
    ts.plan.totalEstimatedMins = ts.totalMins;
    ts.curLat = center.latitude;
    ts.curLng = center.longitude;
  }

  // ── REBALANCE PASS: move stops from overloaded to underloaded techs ──────────
  // Run up to 3 iterations to even out stop counts
  for (let pass = 0; pass < 3; pass++) {
    const sorted = [...techStates].sort((a, b) => b.stopCount - a.stopCount);
    const mostLoaded = sorted[0];
    const leastLoaded = sorted[sorted.length - 1];

    // Only rebalance if the gap is ≥ 2 stops
    if (mostLoaded.stopCount - leastLoaded.stopCount < 2) break;

    // Try to move the last (lowest priority) stop from most-loaded to least-loaded
    const stopToMove = mostLoaded.plan.stops[mostLoaded.plan.stops.length - 1];
    if (!stopToMove) break;

    // Check least-loaded tech can take it
    if (leastLoaded.stopCount >= constraints.maxStopsPerTech) break;
    const moveDist = calculateDistanceKm(leastLoaded.curLat, leastLoaded.curLng, stopToMove.latitude, stopToMove.longitude);
    if (leastLoaded.totalKm + moveDist > constraints.maxKmPerTech) break;

    // Move it
    mostLoaded.plan.stops.pop();
    mostLoaded.stopCount--;
    mostLoaded.totalKm = Math.max(0, mostLoaded.totalKm - moveDist);
    mostLoaded.plan.totalDistanceKm = Math.round(mostLoaded.totalKm * 10) / 10;

    stopToMove.stopOrder = leastLoaded.plan.stops.length + 1;
    leastLoaded.plan.stops.push(stopToMove);
    leastLoaded.stopCount++;
    leastLoaded.totalKm += moveDist;
    leastLoaded.curLat = stopToMove.latitude;
    leastLoaded.curLng = stopToMove.longitude;
    leastLoaded.plan.totalDistanceKm = Math.round(leastLoaded.totalKm * 10) / 10;

    // Recalc stop orders for the modified plan
    mostLoaded.plan.stops = mostLoaded.plan.stops.map((s, i) => ({ ...s, stopOrder: i + 1 }));
  }

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
    naiveKm += calculateDistanceKm(naiveLat[idx], naiveLng[idx], c.latitude, c.longitude);
    naiveLat[idx] = c.latitude; naiveLng[idx] = c.longitude;
  });
  const actualKm = plans.reduce((a, p) => a + p.totalDistanceKm, 0);
  const kmSaved  = Math.round(Math.max(0, naiveKm - actualKm) * 10) / 10;

  // ── Time saved (assume 24 km/h average) ───────────────────────
  const timeSavedMins = Math.round(kmSaved / 24 * 60);

  return { plans, unrouted, kmSaved, balanceScore, timeSavedMins };
}
