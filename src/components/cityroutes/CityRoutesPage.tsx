/**
 * City Routes — route optimisation and roster, one city at a time.
 *
 * Each city is planned with only its own technicians and the tickets at its
 * own centers (city matching in lib/city.ts), so a Delhi technician is never
 * sent to Gurugram just to balance numbers. A plan is a draft until
 * "Save & assign", which writes the assignments onto the tickets — so every
 * other tab shows the same thing.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Building2, Download, MapPin, Play, Save, Users, X, AlertTriangle } from 'lucide-react';
import {
  getCenters, getTechnicians, getTickets, getAttendance, getRoutePlans, saveRoutePlans, saveTickets,
  subscribeToDataChanges,
} from '../../services/storage';
import { planBalancedRoutes, normaliseCityToPreset, CITY_PRESETS } from '../../services/routeOptimizer';
import { fetchRoadMatrix, fetchRoadRoute, type LatLng } from '../../services/roadRouting';
import { PlanSelectionPanel } from '../routing/PlanSelectionPanel';
import { solveWithVroom, getVroomUrl, setVroomUrl, checkVroom } from '../../services/vroom';
import type { Ticket, TechnicianRoutePlan, Technician } from '../../types';
import { localDate } from '../../lib/date';

const COLORS = ['#2563EB', '#DC2626', '#059669', '#D97706', '#7C3AED', '#DB2777', '#0891B2', '#65A30D', '#EA580C', '#4F46E5', '#0D9488', '#B91C1C'];
const PRIORITY_STYLE: Record<string, string> = {
  CRITICAL: 'bg-rose-100 text-rose-700', HIGH: 'bg-orange-100 text-orange-700',
  MEDIUM: 'bg-amber-100 text-amber-700', LOW: 'bg-slate-100 text-slate-600',
};
/** City = the app's operating region (Delhi NCR, Mumbai, Bangalore, …) — same rule the optimizer uses. */
const cityKey = (name?: string | null) => normaliseCityToPreset(name || '');
const routeKey = (p: TechnicianRoutePlan) => `${p.technicianId}:${p.stops.map(s => `${s.latitude.toFixed(5)},${s.longitude.toFixed(5)}`).join(';')}`;
function hav(aLat: number, aLng: number, bLat: number, bLng: number) {
  const t = Math.PI / 180;
  const x = Math.sin((bLat - aLat) * t / 2) ** 2 + Math.cos(aLat * t) * Math.cos(bLat * t) * Math.sin((bLng - aLng) * t / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(x));
}
/** Re-number stops and re-estimate km / arrival times after a manual change (road figures refresh on the map). */
function retime(p: TechnicianRoutePlan, shiftStart: number): TechnicianRoutePlan {
  let km = 0, mins = 0, lat = p.startLat, lng = p.startLng;
  const stops = p.stops.map((s, i) => {
    const leg = hav(lat, lng, s.latitude, s.longitude) * 1.3;
    km += leg; mins += (leg / 24) * 60;
    const at = shiftStart * 60 + Math.round(mins);
    mins += s.estimatedDurationMins || 45;
    lat = s.latitude; lng = s.longitude;
    return { ...s, stopOrder: i + 1, estimatedArrival: `${String(Math.floor(at / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}` };
  });
  return { ...p, stops, totalDistanceKm: Math.round(km * 10) / 10, totalEstimatedMins: Math.round(mins) };
}
const isOpen = (t: Ticket) => t.status !== 'Resolved' && t.status !== 'Closed';
const isDone = (s?: string) => s === 'Resolved' || s === 'Closed';

interface Params { maxStops: number; maxKm: number; shiftStart: number; shiftEnd: number; mode: Mode }
type Mode = 'short' | 'balanced' | 'even';
const MODE_KM: Record<Mode, number> = { short: 3, balanced: 8, even: 25 };
const DEFAULT_PARAMS: Params = { maxStops: 8, maxKm: 60, shiftStart: 9, shiftEnd: 18, mode: 'balanced' };
/** Start each city from its tuned preset (CITY_PRESETS), if it has one */
const presetParams = (city: string): Params => {
  const p = CITY_PRESETS[city];
  return p ? { maxStops: p.maxStopsPerTech, maxKm: p.maxKmPerTech, shiftStart: p.shiftStartHour, shiftEnd: p.shiftEndHour, mode: 'balanced' } : DEFAULT_PARAMS;
};
interface Draft { plans: TechnicianRoutePlan[]; unrouted: Ticket[]; createdAt: string; selectionSig: string; roadPlanned: boolean }
/** Road km / minutes for a technician's drawn route (from OSRM), keyed by technician id */
type RoadStats = Record<string, { km: number; mins: number } | 'failed'>;

/** engine = which optimiser plans the routes: the built-in one, or the VROOM service */
export function CityRoutesPage({ engine = 'builtin' }: { engine?: 'builtin' | 'vroom' } = {}) {
  const isVroom = engine === 'vroom';
  const [vroomUrl, setVroomUrlState] = useState(getVroomUrl());
  const [vroomStatus, setVroomStatus] = useState<'checking' | 'ok' | 'down' | 'unset'>(vroomUrl ? 'checking' : 'unset');
  const [vroomDetail, setVroomDetail] = useState('');
  const testVroom = async (url: string) => {
    setVroomStatus(url ? 'checking' : 'unset'); setVroomDetail('');
    const r = await checkVroom(url);
    setVroomStatus(r.status); setVroomDetail(r.detail);
  };
  const [urlDraft, setUrlDraft] = useState(vroomUrl.replace(/\/$/, ''));
  const [comparison, setComparison] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!isVroom) return;
    testVroom(vroomUrl);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVroom]);

  // ── cached live data (avoids re-parsing localStorage on every render) ──
  const [centers, setCenters] = useState(() => getCenters());
  const [tickets, setTickets] = useState(() => getTickets());
  const [techs, setTechs] = useState(() => getTechnicians());
  const [attendance, setAttendance] = useState(() => getAttendance());
  const [routePlans, setRoutePlans] = useState(() => getRoutePlans());
  useEffect(() => subscribeToDataChanges(() => {
    setCenters(getCenters());
    setTickets(getTickets());
    setTechs(getTechnicians());
    setAttendance(getAttendance());
    setRoutePlans(getRoutePlans());
  }), []);

  const today = localDate();
  const centerCity = useMemo(() => new Map(centers.map(c => [c.name.trim().toLowerCase(), cityKey(c.city)])), [centers]);
  const ticketCity = (t: Ticket) => centerCity.get(t.centerName.trim().toLowerCase()) ?? null;
  const absentToday = new Set(attendance
    .filter(a => a.date === today && a.status !== 'Present' && a.status !== 'Half-Day')
    .map(a => a.employeeId.toUpperCase()));
  const routableTech = (t: Technician) => t.status === 'Active' && !t.excludeFromRouting && t.startingLatitude != null && t.startingLongitude != null;

  const cities = useMemo(() => {
    const stats = new Map<string, { tickets: number; ignored: number; techs: number; present: number; assigned: number }>();
    const get = (c: string) => {
      if (!stats.has(c)) stats.set(c, { tickets: 0, ignored: 0, techs: 0, present: 0, assigned: 0 });
      return stats.get(c)!;
    };
    tickets.filter(isOpen).forEach(t => {
      const c = ticketCity(t); if (!c) return;
      const s = get(c);
      if (t.ignoreForRouting) { s.ignored++; return; }
      s.tickets++;
      if (t.assignedTechnicianId) s.assigned++;
    });
    techs.filter(routableTech).forEach(t => {
      const s = get(cityKey(t.city));
      s.techs++;
      if (!absentToday.has(t.employeeId.toUpperCase())) s.present++;
    });
    return [...stats.entries()]
      .filter(([, s]) => s.tickets > 0 || s.techs > 0)
      .sort((a, b) => b[1].tickets - a[1].tickets || a[0].localeCompare(b[0]));
  }, [tickets, techs, attendance, centerCity, today]);

  const [city, setCity] = useState<string>('');
  useEffect(() => { if (!city && cities.length) setCity(cities[0][0]); }, [city, cities]);
  const [paramsByCity, setParamsByCity] = useState<Record<string, Params>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3000); };

  const params = paramsByCity[city] ?? presetParams(city);
  const setParam = <K extends keyof Params>(k: K, v: Params[K]) => setParamsByCity(p => ({ ...p, [city]: { ...params, [k]: v } }));
  const stats = cities.find(([c]) => c === city)?.[1];
  const cityTechIds = new Set(techs.filter(t => cityKey(t.city) === city).map(t => t.id));
  const draft = drafts[city];

  // ── Plan selection: which tickets and technicians take part (shared Ignore / Exclude flags) ──
  const selTickets = tickets.filter(t => isOpen(t) && ticketCity(t) === city)
    .sort((a, b) => a.ticketId.localeCompare(b.ticketId)); // fixed order: rows never jump when ticked
  const selTechs = techs.filter(t => t.status === 'Active' && t.startingLatitude != null && t.startingLongitude != null && cityKey(t.city) === city)
    .sort((a, b) => a.name.localeCompare(b.name));
  const includedTickets = selTickets.filter(t => !t.ignoreForRouting);
  const includedTechs = selTechs.filter(t => !t.excludeFromRouting && !absentToday.has(t.employeeId.toUpperCase()));
  const selectionSig = includedTickets.map(t => t.id).join(',') + '|' + includedTechs.map(t => t.id).join(',');

  // Current state = saved/assigned routes of this city's technicians (live from tickets)
  const currentPlans = routePlans.filter(p => cityTechIds.has(p.technicianId));
  const plans = draft ? draft.plans : currentPlans;
  const cityOpenTickets = tickets.filter(t => isOpen(t) && !t.ignoreForRouting && ticketCity(t) === city);
  const inPlans = new Set(plans.flatMap(p => p.stops.map(s => s.ticketId)));
  const notPlanned = draft
    ? draft.unrouted
    : cityOpenTickets.filter(t => !inPlans.has(t.ticketId));
  const assignedElsewhere = cityOpenTickets.filter(t => t.assignedTechnicianId && !cityTechIds.has(t.assignedTechnicianId));

  // ── actions ────────────────────────────────────────────────────
  const [planning, setPlanning] = useState(false);
  const [notPlannedLimit, setNotPlannedLimit] = useState(50);
  const [roadStats, setRoadStats] = useState<RoadStats>({});
  const [planningStatus, setPlanningStatus] = useState('');
  const optimise = async () => {
    setPlanning(true);
    setPlanningStatus(isVroom ? 'Waking VROOM service (may take ~60 s on first use)…' : 'Computing road distances…');

    let roadMatrix: Awaited<ReturnType<typeof fetchRoadMatrix>> = null;
    let r: { plans: TechnicianRoutePlan[]; unrouted: Ticket[] };

    try {
      // Road distances between every technician base and every ticket center in this city
      const points: LatLng[] = [
        ...includedTechs.map(t => [t.startingLatitude!, t.startingLongitude!] as LatLng),
        ...includedTickets.map(t => centers.find(c => c.name.trim().toLowerCase() === t.centerName.trim().toLowerCase()))
          .filter(Boolean).map(c => [c!.latitude, c!.longitude] as LatLng),
      ];
      roadMatrix = await fetchRoadMatrix(points);
      setPlanningStatus(isVroom ? 'Sending problem to VROOM solver…' : 'Optimising routes…');
      const builtin = planBalancedRoutes({
        roadMatrix,
        balanceKm: MODE_KM[params.mode],
        cityFilter: city, maxStopsPerTech: params.maxStops, maxKmPerTech: params.maxKm,
        priorityFilter: 'all', skillMatch: false, shiftStartHour: params.shiftStart, shiftEndHour: params.shiftEnd,
      });
      r = builtin;
      if (isVroom) {
        const v = await solveWithVroom({
          techs: includedTechs, tickets: includedTickets, centers,
          maxStops: params.maxStops, maxKm: params.maxKm, shiftStart: params.shiftStart, shiftEnd: params.shiftEnd,
          mode: params.mode, roadMatrix,
        }, vroomUrl);
        r = v;
        // Same tickets, same limits, same distances: show how VROOM compares with the built-in planner
        const km = (ps: TechnicianRoutePlan[]) => Math.round(ps.reduce((a, p) => a + p.totalDistanceKm, 0) * 10) / 10;
        const n = (ps: TechnicianRoutePlan[]) => ps.reduce((a, p) => a + p.stops.length, 0);
        setComparison(c => ({ ...c, [city]:
          `VROOM: ${n(v.plans)} tickets, ${km(v.plans)} km, ${v.plans.length} technicians (solved in ${v.solveMs} ms, up to ${v.capUsed} stops each) · ` +
          `Built-in: ${n(builtin.plans)} tickets, ${km(builtin.plans)} km, ${builtin.plans.filter(p => p.stops.length).length} technicians` }));
      }
    } catch (e) {
      setPlanning(false);
      setPlanningStatus('');
      const msg = (e as Error).message ?? String(e);
      if (isVroom) {
        showToast(`VROOM failed: ${msg} — the service may still be waking up, try again in a moment`);
        setVroomStatus('down');
      } else {
        showToast(`Planning failed: ${msg}`);
      }
      return;
    }

    setPlanning(false);
    setPlanningStatus('');
    const used = r!.plans.filter(p => p.stops.length > 0);
    setDrafts(d => ({ ...d, [city]: { plans: used, unrouted: r!.unrouted, createdAt: new Date().toISOString(), selectionSig, roadPlanned: Boolean(roadMatrix) } }));
    showToast(roadMatrix
      ? `${city}: ${isVroom ? 'VROOM ' : ''}planned by road distance — ${used.reduce((a, p) => a + p.stops.length, 0)} tickets across ${used.length} technicians`
      : `${city}: road data unavailable — planned with estimated distances (straight line × 1.3)`);
  };

  // ── Manual reassignment (works on the draft; starts one from the current routes if needed) ──
  const editDraft = (fn: (plans: TechnicianRoutePlan[], unrouted: Ticket[]) => { plans: TechnicianRoutePlan[]; unrouted: Ticket[] }) => {
    const base: Draft = draft ?? {
      plans: currentPlans.map(p => ({ ...p, stops: [...p.stops] })), unrouted: [...notPlanned],
      createdAt: new Date().toISOString(), selectionSig, roadPlanned: false,
    };
    const next = fn(base.plans.map(p => ({ ...p, stops: [...p.stops] })), [...base.unrouted]);
    setDrafts(d => ({ ...d, [city]: { ...base, plans: next.plans.filter(p => p.stops.length > 0), unrouted: next.unrouted } }));
  };
  const planFor = (plans: TechnicianRoutePlan[], techId: string): TechnicianRoutePlan | null => {
    const found = plans.find(p => p.technicianId === techId);
    if (found) return found;
    const t = techs.find(x => x.id === techId);
    if (!t || t.startingLatitude == null || t.startingLongitude == null) return null;
    const p: TechnicianRoutePlan = { technicianId: t.id, technicianName: t.name, employeeId: t.employeeId,
      startLat: t.startingLatitude, startLng: t.startingLongitude, defaultDc: t.defaultDc ?? '',
      stops: [], totalDistanceKm: 0, totalEstimatedMins: 0, status: 'Draft' };
    plans.push(p);
    return p;
  };
  /** Move a planned stop to another technician, or take it off the plan ('') */
  const moveStop = (ticketId: string, toTechId: string) => editDraft((ps, un) => {
    const from = ps.find(p => p.stops.some(s => s.ticketId === ticketId));
    if (!from) return { plans: ps, unrouted: un };
    const stop = from.stops.find(s => s.ticketId === ticketId)!;
    from.stops = from.stops.filter(s => s.ticketId !== ticketId);
    const touched = new Set([from.technicianId]);
    if (toTechId) {
      const to = planFor(ps, toTechId);
      if (to) { to.stops.push(stop); touched.add(to.technicianId); }
    } else {
      const tk = tickets.find(t => t.ticketId === ticketId);
      if (tk) un.push(tk);
    }
    return { plans: ps.map(p => (touched.has(p.technicianId) ? retime(p, params.shiftStart) : p)), unrouted: un };
  });
  /** Put a not-planned ticket on a technician's route */
  const assignUnplanned = (ticketId: string, toTechId: string) => editDraft((ps, un) => {
    const tk = tickets.find(t => t.ticketId === ticketId);
    const c = tk && centers.find(x => x.name.trim().toLowerCase() === tk.centerName.trim().toLowerCase());
    const to = planFor(ps, toTechId);
    if (!tk || !c || !to) return { plans: ps, unrouted: un };
    to.stops.push({ stopOrder: 0, ticketId: tk.ticketId, centerName: tk.centerName, vehicleNumber: tk.vehicleNumber, issue: tk.issue,
      priority: tk.priority, latitude: c.latitude, longitude: c.longitude, estimatedArrival: '', ticketStatus: tk.status,
      estimatedDurationMins: tk.priority === 'CRITICAL' ? 60 : 45 });
    return { plans: ps.map(p => (p.technicianId === to.technicianId ? retime(p, params.shiftStart) : p)), unrouted: un.filter(t => t.ticketId !== ticketId) };
  });
  // Technicians a stop can be given to: everyone working in this city today
  const moveTargets = includedTechs;

  const saveAndAssign = () => {
    if (!draft) return;
    const draftTicketIds = new Set(draft.plans.flatMap(p => p.stops.map(s => s.ticketId)));
    // keep every other city's routes untouched; replace this city's
    const others = getRoutePlans()
      .filter(p => !cityTechIds.has(p.technicianId))
      .map(p => ({ ...p, stops: p.stops.filter(s => !draftTicketIds.has(s.ticketId)) }));
    saveRoutePlans([...others, ...draft.plans]);
    // tickets of this city that the new plan couldn't fit come off this city's technicians
    const unroutedIds = new Set(draft.unrouted.map(t => t.ticketId));
    const now = new Date().toISOString();
    let changed = false;
    const next = getTickets().map(t => {
      if (unroutedIds.has(t.ticketId) && t.assignedTechnicianId && cityTechIds.has(t.assignedTechnicianId) && isOpen(t)) {
        changed = true;
        return { ...t, assignedTechnicianId: undefined, assignedTechnicianName: undefined, status: t.status === 'Assigned' ? 'Open' as const : t.status, updatedAt: now };
      }
      return t;
    });
    if (changed) saveTickets(next);
    setDrafts(d => { const n = { ...d }; delete n[city]; return n; });
    showToast(`${city}: plan saved — ${draftTicketIds.size} tickets assigned (visible on every tab)`);
  };

  const exportRoster = () => {
    const rows = [['City', 'Technician', 'Employee ID', 'Stop', 'Ticket', 'Vehicle', 'Center', 'Priority', 'Status', 'ETA', 'Route km']];
    plans.forEach(p => p.stops.forEach(s => rows.push([city, p.technicianName, p.employeeId, String(s.stopOrder), s.ticketId,
      s.vehicleNumber, s.centerName, s.priority, s.ticketStatus ?? (draft ? 'Draft' : ''), s.estimatedArrival, String(p.totalDistanceKm)])));
    const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `roster_${city.toLowerCase()}_${today}.csv`;
    a.click();
  };

  const roadOf = (p: TechnicianRoutePlan) => { const r = roadStats[routeKey(p)]; return r && r !== 'failed' ? r : null; };
  const allRoad = plans.length > 0 && plans.every(p => roadOf(p));
  const totalKm = Math.round(plans.reduce((a, p) => a + (roadOf(p)?.km ?? p.totalDistanceKm), 0) * 10) / 10;
  const stopCount = plans.reduce((a, p) => a + p.stops.length, 0);
  const colorOf = (techId: string) => COLORS[Math.max(0, [...cityTechIds].sort().indexOf(techId)) % COLORS.length];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">{isVroom ? 'VROOM ROUTES' : 'CITY ROUTES'}</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {isVroom
              ? 'Each city is optimised by VROOM, an open-source routing solver, with its own technicians and tickets. Plans stay drafts until you save them.'
              : 'Each city is optimised with its own technicians and its own tickets. Plans stay drafts until you save them.'}
          </p>
        </div>
      </div>

      {isVroom && (
        <div className={`rounded-xl border p-3 flex flex-col md:flex-row md:items-center gap-2 text-xs ${vroomStatus === 'ok' ? 'bg-emerald-50 border-emerald-200' : vroomStatus === 'checking' ? 'bg-slate-50 border-slate-200' : 'bg-amber-50 border-amber-200'}`}>
          <span className="font-semibold text-slate-800 shrink-0">
            VROOM service: {{ ok: '● connected', checking: 'checking… (a sleeping free server can take up to a minute to wake)', down: '● not reachable', unset: 'not set up' }[vroomStatus]}
          </span>
          <input value={urlDraft} onChange={e => setUrlDraft(e.target.value)} placeholder="https://fleetops-vroom-engine.onrender.com"
            className="flex-1 min-w-0 px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button
            onClick={() => { setVroomUrl(urlDraft); const u = getVroomUrl(); setVroomUrlState(u); setUrlDraft(u.replace(/\/$/, '')); testVroom(u); }}
            disabled={vroomStatus === 'checking'}
            className="px-3 py-1.5 rounded-lg bg-slate-800 text-white font-semibold hover:bg-slate-900 disabled:opacity-60 disabled:cursor-wait shrink-0">
            {vroomStatus === 'checking' ? 'Testing…' : 'Save & test'}
          </button>
          {vroomStatus === 'unset' && (
            <span className="text-slate-600 md:max-w-xs">Paste the address of your VROOM service from Render, then click Save & test.</span>
          )}
          {vroomStatus === 'down' && vroomDetail && (
            <span className="text-amber-900 md:max-w-sm">{vroomDetail}</span>
          )}
        </div>
      )}

      {/* City tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {cities.map(([c, s]) => {
          const active = c === city;
          const noTech = s.tickets > 0 && s.present === 0;
          return (
            <button key={c} onClick={() => setCity(c)}
              className={`shrink-0 text-left px-4 py-2.5 rounded-xl border transition-colors ${active ? 'bg-blue-600 border-blue-600 text-white shadow-xs' : 'bg-white border-slate-200 text-slate-700 hover:border-blue-300'}`}>
              <div className="flex items-center gap-1.5 text-sm font-bold">
                {c}
                {drafts[c] && <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${active ? 'bg-white/25' : 'bg-amber-100 text-amber-700'}`}>DRAFT</span>}
                {noTech && <AlertTriangle className={`w-3.5 h-3.5 ${active ? 'text-amber-200' : 'text-amber-500'}`} />}
              </div>
              <div className={`text-[11px] mt-0.5 ${active ? 'text-blue-100' : 'text-slate-500'}`}>
                {s.tickets} ticket{s.tickets !== 1 ? 's' : ''} · {s.present}/{s.techs} tech{s.techs !== 1 ? 's' : ''}
              </div>
            </button>
          );
        })}
        {!cities.length && <div className="text-sm text-slate-500 py-3">No open tickets or technicians yet.</div>}
      </div>

      {city && stats && (
        <>
          {/* Controls */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-end gap-3">
            {([
              ['maxStops', 'Max stops / tech', 1, 20],
              ['maxKm', 'Max km / tech', 5, 300],
              ['shiftStart', 'Shift start (h)', 0, 23],
              ['shiftEnd', 'Shift end (h)', 1, 24],
            ] as const).map(([k, label, min, max]) => (
              <label key={k} className="text-[11px] font-semibold text-slate-500">
                {label}
                <input type="number" min={min} max={max} value={params[k]}
                  onChange={e => setParam(k, Math.max(min, Math.min(max, Number(e.target.value) || min)))}
                  className="mt-1 block w-24 px-2 py-1.5 border border-slate-300 rounded-lg text-sm text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
            ))}
            <label className="text-[11px] font-semibold text-slate-500">
              Plan for
              <select value={params.mode} onChange={e => setParam('mode', e.target.value as Mode)}
                className="mt-1 block px-2 py-1.5 border border-slate-300 rounded-lg text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                title="Trade-off between using every technician and keeping drives short">
                <option value="short">Short drives</option>
                <option value="balanced">Balanced</option>
                <option value="even">Even workload (use everyone)</option>
              </select>
            </label>
            <div className="flex flex-wrap gap-2 ml-auto">
              <div className="flex flex-col items-end gap-0.5">
                <button onClick={optimise} disabled={planning || stats.present === 0 || stats.tickets === 0 || (isVroom && vroomStatus !== 'ok')}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-bold flex items-center gap-1.5">
                  <Play className="w-3.5 h-3.5" /> {planning ? (planningStatus || (isVroom ? 'Solving with VROOM…' : 'Optimising…')) : `${isVroom ? 'Solve with VROOM: ' : 'Optimise '}${city}`}
                </button>
                {planning && isVroom && <span className="text-[10px] text-slate-500 pr-1">{planningStatus}</span>}
              </div>
              {draft && (
                <>
                  <button onClick={saveAndAssign} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5">
                    <Save className="w-3.5 h-3.5" /> Save & assign
                  </button>
                  <button onClick={() => setDrafts(d => { const n = { ...d }; delete n[city]; return n; })}
                    className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-semibold flex items-center gap-1.5">
                    <X className="w-3.5 h-3.5" /> Discard draft
                  </button>
                </>
              )}
              <button onClick={exportRoster} disabled={!stopCount}
                className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40 text-xs font-semibold flex items-center gap-1.5">
                <Download className="w-3.5 h-3.5" /> Roster CSV
              </button>
            </div>
          </div>

          {/* Plan selection (shared with Route Planner and Smart Route) */}
          <PlanSelectionPanel city={city} stale={Boolean(draft && draft.selectionSig !== selectionSig)} />

          {/* Notices */}
          {stats.tickets > 0 && stats.present === 0 && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
              No technicians {stats.techs ? 'available today' : 'based'} in <b>{city}</b>. Its {stats.tickets} ticket{stats.tickets > 1 ? 's' : ''} can't be optimised here —
              add a technician with city “{city}”, or assign them manually from Tickets or Active Cases.
            </div>
          )}
          {assignedElsewhere.length > 0 && (
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
              {assignedElsewhere.length} {city} ticket{assignedElsewhere.length > 1 ? 's are' : ' is'} assigned to technicians from other cities
              ({[...new Set(assignedElsewhere.map(t => t.assignedTechnicianName))].join(', ')}). Optimising {city} will reassign {assignedElsewhere.length > 1 ? 'them' : 'it'} to {city} technicians.
            </div>
          )}

          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              ['Showing', draft ? 'Draft (not saved)' : 'Current assignments', draft ? 'text-amber-600' : 'text-emerald-600'],
              ['Tickets planned', `${stopCount} / ${stats.tickets}`, 'text-slate-900'],
              ['Not planned', String(notPlanned.length), notPlanned.length ? 'text-rose-600' : 'text-slate-900'],
              ['Technicians used', `${plans.length} / ${stats.present}`, 'text-slate-900'],
              [allRoad ? 'Total road km' : 'Total km (est.)', String(totalKm), 'text-slate-900'],
            ].map(([label, value, cls]) => (
              <div key={label} className="bg-white rounded-xl border border-slate-200 px-4 py-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
                <div className={`text-base font-bold mt-0.5 ${cls}`}>{value}</div>
              </div>
            ))}
          </div>

          {isVroom && comparison[city] && draft && (
            <div className="px-4 py-2.5 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-900">{comparison[city]}</div>
          )}

          {/* Roster + map */}
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-4">
            <div className="space-y-3">
              {plans.length === 0 && (
                <div className="bg-white rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                  Nothing assigned in {city} yet. Click <b>Optimise {city}</b> to build routes.
                </div>
              )}
              {plans.map(p => {
                const color = colorOf(p.technicianId);
                const done = p.stops.filter(s => isDone(s.ticketStatus)).length;
                const road = roadOf(p);
                const km = road?.km ?? p.totalDistanceKm;
                const overKm = km > params.maxKm;
                const workMins = p.stops.reduce((a, s) => a + (s.estimatedDurationMins || 45), 0);
                return (
                  <div key={p.technicianId} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-3 flex items-center gap-3 border-b border-slate-100" style={{ borderLeft: `4px solid ${color}` }}>
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ background: color }}>
                        {p.technicianName.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-slate-900">{p.technicianName}</div>
                        <div className="text-[11px] text-slate-500">{p.employeeId}</div>
                      </div>
                      <div className="text-right text-[11px] font-mono text-slate-600">
                        <div className="font-bold text-slate-900">{p.stops.length} stop{p.stops.length !== 1 ? 's' : ''}{done ? ` · ${done} done` : ''}</div>
                        <div className={overKm ? 'text-rose-600 font-bold' : ''} title={road ? 'Road distance and drive time (OSRM)' : 'Estimated: straight line × 1.3 — road data not loaded'}>
                          {road ? `${km} km by road · ${Math.round(road.mins)} min drive` : `≈ ${km} km (est.)`}
                        </div>
                        <div className="text-slate-400">+ {Math.round(workMins / 6) / 10} h on site</div>
                      </div>
                    </div>
                    <ol className="divide-y divide-slate-50">
                      {p.stops.map(s => (
                        <li key={s.ticketId} className={`px-4 py-2 flex items-start gap-3 text-xs ${isDone(s.ticketStatus) ? 'opacity-60' : ''}`}>
                          <span className="mt-0.5 w-5 h-5 rounded-full text-[10px] font-bold text-white flex items-center justify-center shrink-0" style={{ background: color }}>{s.stopOrder}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-mono font-bold text-blue-600">{s.ticketId}</span>
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${PRIORITY_STYLE[s.priority] ?? PRIORITY_STYLE.LOW}`}>{s.priority}</span>
                              {s.ticketStatus && s.ticketStatus !== 'Open' && s.ticketStatus !== 'Assigned' && (
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${isDone(s.ticketStatus) ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                  {isDone(s.ticketStatus) ? '✓ ' : ''}{s.ticketStatus}
                                </span>
                              )}
                            </div>
                            <div className="text-slate-600 truncate"><MapPin className="inline w-3 h-3 -mt-0.5" /> {s.centerName} · {s.vehicleNumber}</div>
                            <div className="text-slate-400 truncate">{s.issue}</div>
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <span className="font-mono text-slate-500">{s.estimatedArrival}</span>
                            {!isDone(s.ticketStatus) && (
                              <select value="" onChange={e => { if (e.target.value !== '') moveStop(s.ticketId, e.target.value === '__none' ? '' : e.target.value); }}
                                className="text-[10px] border border-slate-200 rounded px-1 py-0.5 text-slate-600 bg-white max-w-[120px]" title="Reassign this stop">
                                <option value="">Move to…</option>
                                {moveTargets.filter(t => t.id !== p.technicianId).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                <option value="__none">— Remove from plan</option>
                              </select>
                            )}
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                );
              })}

              {(() => {
                const idle = includedTechs.filter(t => !plans.some(p => p.technicianId === t.id && p.stops.length));
                if (!idle.length || !plans.length) return null;
                const pts = includedTickets.map(t => centers.find(c => c.name.trim().toLowerCase() === t.centerName.trim().toLowerCase())).filter(Boolean);
                return (
                  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-2.5 bg-slate-50 text-xs font-bold text-slate-700">
                      Not used ({idle.length}) — {isVroom
                        ? `VROOM found shorter total driving without them${params.mode !== 'even' ? ' · “Even workload” caps everyone at a fair share, which brings more technicians in' : ''}`
                        : `every ticket had a closer technician${params.mode !== 'even' ? ' · choose “Even workload” to use everyone' : ''}`}
                    </div>
                    <ul className="divide-y divide-slate-50">
                      {idle.map(t => {
                        const near = pts.length ? Math.min(...pts.map(c => hav(t.startingLatitude!, t.startingLongitude!, c!.latitude, c!.longitude))) : NaN;
                        return (
                          <li key={t.id} className="px-4 py-2 text-xs flex items-center gap-2">
                            <span className="font-semibold text-slate-800">{t.name}</span>
                            <span className="text-slate-500">{t.zone || t.city}</span>
                            <span className="ml-auto text-slate-500">{Number.isFinite(near) ? `nearest open ticket ${near.toFixed(1)} km away` : 'no open tickets'}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })()}

              {notPlanned.length > 0 && (
                <div className="bg-white rounded-xl border border-rose-200 overflow-hidden">
                  <div className="px-4 py-2.5 bg-rose-50 text-xs font-bold text-rose-700">
                    Not planned ({notPlanned.length}) — {draft ? 'didn\'t fit the limits, or removed by you' : 'not on any technician\'s route yet'} · use “Assign to…” to place one
                  </div>
                  <ul className="divide-y divide-slate-50">
                    {notPlanned.slice(0, notPlannedLimit).map(t => (
                      <li key={t.ticketId} className="px-4 py-2 text-xs flex items-center gap-2">
                        <span className="font-mono font-bold text-slate-700">{t.ticketId}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${PRIORITY_STYLE[t.priority] ?? PRIORITY_STYLE.LOW}`}>{t.priority}</span>
                        <span className="text-slate-500 truncate">{t.centerName}</span>
                        {t.assignedTechnicianName && <span className="ml-auto text-slate-400 shrink-0">→ {t.assignedTechnicianName}</span>}
                        <select value="" onChange={e => e.target.value && assignUnplanned(t.ticketId, e.target.value)}
                          className={`${t.assignedTechnicianName ? '' : 'ml-auto'} text-[10px] border border-slate-200 rounded px-1 py-0.5 text-slate-600 bg-white shrink-0`}
                          title="Put this ticket on a technician's route">
                          <option value="">Assign to…</option>
                          {moveTargets.map(tt => <option key={tt.id} value={tt.id}>{tt.name}</option>)}
                        </select>
                      </li>
                    ))}
                    {notPlanned.length > notPlannedLimit && (
                      <li className="px-4 py-2 text-center">
                        <button onClick={() => setNotPlannedLimit(l => l + 100)} className="text-[11px] font-semibold text-blue-600 hover:underline">
                          Showing {notPlannedLimit} of {notPlanned.length} — show more
                        </button>
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>

            <CityMap city={city} plans={plans} colorOf={colorOf}
              onRoad={(k, v) => setRoadStats(r => (r[k] === v ? r : { ...r, [k]: v }))}
              techs={techs.filter(t => cityTechIds.has(t.id) && routableTech(t))}
              centers={centers.filter(c => cityKey(c.city) === city)} />
          </div>
        </>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-xs font-semibold px-4 py-2.5 rounded-lg shadow-lg">{toast}</div>
      )}
    </div>
  );
}

// ── Map of one city's routes ─────────────────────────────────────
function CityMap({ city, plans, techs, centers, colorOf, onRoad }: {
  onRoad: (routeKey: string, v: { km: number; mins: number } | 'failed') => void;
  city: string;
  plans: TechnicianRoutePlan[];
  techs: Technician[];
  centers: Array<{ name: string; latitude: number; longitude: number }>;
  colorOf: (techId: string) => string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!el.current || mapRef.current) return;
    const map = L.map(el.current, { zoomControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 18 }).addTo(map);
    map.setView([28.61, 77.21], 10);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el.current);
    return () => { ro.disconnect(); map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current, layer = layerRef.current;
    if (!map || !layer) return;
    let cancelled = false;
    layer.clearLayers();
    const bounds: L.LatLngExpression[] = [];     // routes + bases (what matters)
    const allBounds: L.LatLngExpression[] = [];  // every center (fallback for an empty city)
    centers.forEach(c => {
      if (!Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) return;
      L.circleMarker([c.latitude, c.longitude], { radius: 3, color: '#94A3B8', weight: 1, fillOpacity: 0.6 })
        .bindTooltip(c.name).addTo(layer);
      allBounds.push([c.latitude, c.longitude]);
    });
    techs.forEach(t => {
      const color = colorOf(t.id);
      const ll: L.LatLngExpression = [t.startingLatitude!, t.startingLongitude!];
      L.marker(ll, { icon: L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13],
        html: `<div style="width:26px;height:26px;border-radius:50%;background:${color};color:#fff;font:700 10px sans-serif;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3)">${t.name.slice(0, 2).toUpperCase()}</div>` }) })
        .bindTooltip(`${t.name} — base`).addTo(layer);
      bounds.push(ll);
    });
    plans.forEach(p => {
      const color = colorOf(p.technicianId);
      const path: L.LatLngExpression[] = [[p.startLat, p.startLng], ...p.stops.map(s => [s.latitude, s.longitude] as L.LatLngExpression)];
      // Dashed straight line while the road path loads (or if it can't be loaded)
      const line = L.polyline(path, { color, weight: 2, opacity: 0.5, dashArray: '6 6' }).addTo(layer);
      const k = routeKey(p);
      fetchRoadRoute(path as LatLng[]).then(r => {
        if (cancelled) return;
        if (!r) { onRoad(k, 'failed'); return; }
        layer.removeLayer(line);
        L.polyline(r.path, { color, weight: 4, opacity: 0.85 }).addTo(layer);
        onRoad(k, { km: r.km, mins: r.mins });
      });
      p.stops.forEach(s => {
        const done = s.ticketStatus === 'Resolved' || s.ticketStatus === 'Closed';
        L.marker([s.latitude, s.longitude], { icon: L.divIcon({ className: '', iconSize: [20, 20], iconAnchor: [10, 10],
          html: `<div style="width:20px;height:20px;border-radius:50%;background:${done ? '#10B981' : '#fff'};color:${done ? '#fff' : color};border:2px solid ${color};font:700 10px sans-serif;display:flex;align-items:center;justify-content:center">${done ? '✓' : s.stopOrder}</div>` }) })
          .bindTooltip(`${p.technicianName} · stop ${s.stopOrder}<br>${s.ticketId} — ${s.centerName}`).addTo(layer);
        bounds.push([s.latitude, s.longitude]);
      });
    });
    const fit = plans.length ? bounds : [...bounds, ...allBounds];
    if (fit.length > 1) map.fitBounds(L.latLngBounds(fit), { padding: [30, 30], maxZoom: 13 });
    else if (fit.length === 1) map.setView(fit[0], 12);
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city, plans, techs, centers]);

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden xl:sticky xl:top-0 self-start">
      <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2 text-xs font-bold text-slate-700">
        <Building2 className="w-3.5 h-3.5 text-slate-400" /> {city} map
        <span className="ml-auto flex items-center gap-1 font-normal text-slate-400"><Users className="w-3 h-3" /> bases · numbered stops · ✓ resolved · solid = road route</span>
      </div>
      <div ref={el} style={{ height: 'min(70vh, 620px)' }} />
    </div>
  );
}

