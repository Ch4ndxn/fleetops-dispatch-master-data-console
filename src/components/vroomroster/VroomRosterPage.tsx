/**
 * VROOM Roster Page
 *
 * Plans routes city-by-city using VROOM, showing each city's technicians
 * with their ordered stop lists. Technicians from one city are never sent
 * to another city's tickets.
 *
 * Flow:
 *  1. Load technicians, tickets, centers from local storage.
 *  2. Group them by city.
 *  3. For each city run solveWithVroom (with straight-line matrix when OSRM is
 *     unavailable) — runs in parallel across cities.
 *  4. Display: city tabs → technician cards → stop list.
 *  5. Download CSV / PDF per city or for all cities.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, CalendarDays, CheckCircle2, ChevronDown, ChevronRight,
  Clock, Download, FileText, Loader2, MapPin, RefreshCw, Route, Truck, User,
  Users, Wifi, WifiOff, X,
} from 'lucide-react';
import {
  getCenters, getTechnicians, getTickets, subscribeToDataChanges,
} from '../../services/storage';
import { solveWithVroom, getVroomUrl, setVroomUrl, checkVroom } from '../../services/vroom';
import type { TechnicianRoutePlan, Ticket, Technician, Center } from '../../types';
import { localDate } from '../../lib/date';

// ── helpers ──────────────────────────────────────────────────────────────────
/** NCR cities that should all map to "Delhi NCR" */
const NCR_CITIES = ['delhi', 'noida', 'gurgaon', 'gurugram', 'faridabad', 'ghaziabad', 'greater noida', 'delhi ncr'];

/** Normalise a raw city string to a canonical cluster name. */
const cityKey = (s?: string | null): string => {
  const t = (s || '').trim();
  if (!t) return '';
  const lower = t.toLowerCase();
  // Collapse all NCR cities into one group
  if (NCR_CITIES.some(ncr => lower === ncr || lower.startsWith(ncr))) return 'Delhi NCR';
  // Title-case so "mumbai" and "Mumbai" group together
  return t.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
};

const isOpen = (t: Ticket) => t.status !== 'Resolved' && t.status !== 'Closed';

const PRI: Record<string, { dot: string; badge: string }> = {
  CRITICAL: { dot: 'bg-red-500',    badge: 'bg-red-100 text-red-700'      },
  HIGH:     { dot: 'bg-orange-500', badge: 'bg-orange-100 text-orange-700'},
  MEDIUM:   { dot: 'bg-yellow-400', badge: 'bg-yellow-50 text-yellow-700' },
  LOW:      { dot: 'bg-slate-300',  badge: 'bg-slate-100 text-slate-500'  },
};

const COLORS = [
  '#2563EB','#DC2626','#059669','#D97706','#7C3AED',
  '#DB2777','#0891B2','#65A30D','#EA580C','#4F46E5',
];

// ── types ─────────────────────────────────────────────────────────────────────
interface CityPlan {
  city: string;
  plans: TechnicianRoutePlan[];
  unrouted: Ticket[];
  solveMs: number;
  capUsed: number;
  error?: string;
}

type RunStatus = 'idle' | 'running' | 'done' | 'error';

// ── component ─────────────────────────────────────────────────────────────────
export function VroomRosterPage() {
  const today = localDate();
  const [selectedDate, setSelectedDate] = useState(today);
  const [cityPlans, setCityPlans] = useState<CityPlan[]>([]);
  const [runStatus, setRunStatus] = useState<RunStatus>('idle');
  const [globalError, setGlobalError] = useState('');
  const [activeCity, setActiveCity] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [spinning, setSpinning] = useState(false);

  // VROOM connectivity
  const [vroomUrl, setVroomUrlState] = useState(getVroomUrl());
  const [vroomStatus, setVroomStatus] = useState<'checking' | 'ok' | 'down' | 'unset'>(
    vroomUrl ? 'checking' : 'unset',
  );
  const [vroomDetail, setVroomDetail] = useState('');
  const [urlDraft, setUrlDraft] = useState(vroomUrl.replace(/\/$/, ''));

  const testVroom = useCallback(async (url: string) => {
    setVroomStatus(url ? 'checking' : 'unset');
    setVroomDetail('');
    const r = await checkVroom(url);
    setVroomStatus(r.status);
    setVroomDetail(r.detail);
  }, []);

  useEffect(() => { if (vroomUrl) testVroom(vroomUrl); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveUrl = () => {
    const u = urlDraft.trim().replace(/\/$/, '');
    setVroomUrl(u);
    setVroomUrlState(getVroomUrl());
    testVroom(getVroomUrl());
  };

  // ── build city groups from storage ─────────────────────────────────────────
  const buildCityGroups = useCallback(() => {
    const techs   = getTechnicians().filter(t => t.status === 'Active' && !t.excludeFromRouting && t.startingLatitude != null && t.startingLongitude != null);
    const centers = getCenters().filter(c => c.active);
    const tickets = getTickets().filter(t => isOpen(t) && !t.ignoreForRouting);

    // Group technicians by canonical city
    const techsByCity = new Map<string, Technician[]>();
    for (const tech of techs) {
      const k = cityKey(tech.city);
      if (!k) continue;
      const arr = techsByCity.get(k) ?? [];
      arr.push(tech);
      techsByCity.set(k, arr);
    }

    // Group centers by city
    const centersByCity = new Map<string, Center[]>();
    for (const c of centers) {
      const k = cityKey(c.city);
      if (!k) continue;
      const arr = centersByCity.get(k) ?? [];
      arr.push(c);
      centersByCity.set(k, arr);
    }

    // Match tickets to cities via center name → center's city
    // Fall back: if center has no city set, try to match ticket's centerName against
    // a technician's defaultDc or city directly.
    const centerNameToCity = new Map<string, string>();
    for (const c of centers) {
      const ck = cityKey(c.city);
      if (ck) centerNameToCity.set(c.name.trim().toLowerCase(), ck);
    }

    // Also build a set of all known tech cities so we can fallback-match tickets whose
    // center city is blank but centerName contains the city name.
    const allTechCities = [...techsByCity.keys()];

    const ticketsByCity = new Map<string, Ticket[]>();
    for (const t of tickets) {
      let ck = centerNameToCity.get(t.centerName.trim().toLowerCase());

      // Fallback: scan the center name itself for a known tech city
      if (!ck) {
        const cn = t.centerName.trim().toLowerCase();
        ck = allTechCities.find(city => cn.includes(city.toLowerCase())) ?? '';
      }

      // Fallback 2: use ticket's own location field
      if (!ck && t.location) {
        const loc = t.location.trim().toLowerCase();
        ck = allTechCities.find(city => loc.includes(city.toLowerCase())) ?? '';
      }

      if (!ck) continue;
      const arr = ticketsByCity.get(ck) ?? [];
      arr.push(t);
      ticketsByCity.set(ck, arr);
    }

    // Only plan cities that have both techs AND tickets
    const cities = [...techsByCity.keys()].filter(k => (ticketsByCity.get(k)?.length ?? 0) > 0);
    cities.sort();

    return cities.map(city => ({
      city,
      techs: techsByCity.get(city)!,
      centers: centersByCity.get(city) ?? [],
      tickets: ticketsByCity.get(city)!,
    }));
  }, []);

  // ── run VROOM for all cities ───────────────────────────────────────────────
  const runAll = useCallback(async () => {
    if (vroomStatus !== 'ok') return;
    setRunStatus('running');
    setGlobalError('');
    setSpinning(true);

    const groups = buildCityGroups();
    if (!groups.length) {
      setCityPlans([]);
      setRunStatus('done');
      setSpinning(false);
      return;
    }

    const results = await Promise.allSettled(
      groups.map(async g => {
        try {
          const r = await solveWithVroom({
            techs: g.techs, tickets: g.tickets, centers: g.centers,
            maxStops: 10, maxKm: 80, shiftStart: 9, shiftEnd: 18,
            mode: 'balanced', roadMatrix: null,
          });
          return { city: g.city, plans: r.plans, unrouted: r.unrouted, solveMs: r.solveMs, capUsed: r.capUsed } as CityPlan;
        } catch (e) {
          return { city: g.city, plans: [], unrouted: g.tickets, solveMs: 0, capUsed: 0, error: (e as Error).message } as CityPlan;
        }
      }),
    );

    const settled: CityPlan[] = results.map(r => r.status === 'fulfilled' ? r.value : { city: '?', plans: [], unrouted: [], solveMs: 0, capUsed: 0, error: String(r.reason) });
    setCityPlans(settled);
    setActiveCity(settled[0]?.city ?? '');
    setExpanded(Object.fromEntries(settled.map(c => [c.city, true])));
    setRunStatus('done');
    setSpinning(false);
  }, [buildCityGroups, vroomStatus]);

  // Re-run on data change only after a first run
  const hasRunRef = useRef(false);
  useEffect(() => subscribeToDataChanges(() => {
    if (hasRunRef.current) return; // don't re-plan automatically; user reruns manually
  }), []);

  const handleRun = useCallback(() => {
    hasRunRef.current = true;
    void runAll();
  }, [runAll]);

  // ── summary stats ──────────────────────────────────────────────────────────
  const totalTechs   = cityPlans.reduce((s, c) => s + c.plans.length, 0);
  const totalVisits  = cityPlans.reduce((s, c) => s + c.plans.reduce((a, p) => a + p.stops.length, 0), 0);
  const totalUnrouted = cityPlans.reduce((s, c) => s + c.unrouted.length, 0);

  // ── downloads ──────────────────────────────────────────────────────────────
  const activeplan = cityPlans.find(c => c.city === activeCity);

  const downloadCSV = (cp?: CityPlan) => {
    const scope = cp ? [cp] : cityPlans;
    const rows: string[][] = [['City','Technician','Emp ID','Stop #','Ticket','Vehicle','Center','Issue','Priority','ETA','Mins']];
    for (const c of scope) {
      for (const p of c.plans) {
        if (!p.stops.length) { rows.push([c.city, p.technicianName, p.employeeId,'—','—','—','—','—','—','—','—']); continue; }
        for (const s of p.stops) rows.push([c.city, p.technicianName, p.employeeId, String(s.stopOrder), s.ticketId, s.vehicleNumber, s.centerName, s.issue, s.priority, s.estimatedArrival, String(s.estimatedDurationMins)]);
      }
      for (const t of c.unrouted) rows.push([c.city,'UNROUTED','','','',t.ticketId, t.vehicleNumber, t.centerName, t.issue, t.priority,'','']);
    }
    const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `vroom_roster_${cp?.city ?? 'all'}_${selectedDate}.csv`;
    a.click();
  };

  const downloadPDF = (cp?: CityPlan) => {
    const scope = cp ? [cp] : cityPlans;
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(buildPrintHtml(scope, selectedDate));
    win.document.close();
    setTimeout(() => { win.focus(); win.print(); }, 400);
  };

  // ── render ─────────────────────────────────────────────────────────────────
  const cityGroups = useMemo(() => buildCityGroups(), [buildCityGroups]);

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Route className="w-5 h-5 text-blue-600" />
            VROOM Roster — All Cities
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Runs VROOM route optimisation per city · technicians never cross city boundaries
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5">
            <CalendarDays className="w-3.5 h-3.5 text-slate-400" />
            <input
              type="date" value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="text-xs font-semibold text-slate-700 bg-transparent focus:outline-none"
            />
          </div>

          {runStatus === 'done' && (
            <>
              <button onClick={() => downloadCSV()}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-semibold border border-emerald-200">
                <FileText className="w-3.5 h-3.5" /> CSV (All)
              </button>
              <button onClick={() => downloadPDF()}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-sm">
                <Download className="w-3.5 h-3.5" /> PDF (All)
              </button>
            </>
          )}

          <button onClick={handleRun}
            disabled={vroomStatus !== 'ok' || spinning}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-slate-900 hover:bg-black disabled:opacity-40 text-white rounded-lg text-xs font-bold shadow-sm transition-colors">
            {spinning
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <RefreshCw className="w-3.5 h-3.5" />
            }
            {runStatus === 'idle' ? 'Run VROOM' : 'Re-run'}
          </button>
        </div>
      </div>

      {/* ── VROOM URL config ── */}
      <div className={`rounded-xl border px-4 py-3 flex flex-wrap items-center gap-3 ${
        vroomStatus === 'ok' ? 'border-emerald-200 bg-emerald-50/60'
        : vroomStatus === 'down' ? 'border-red-200 bg-red-50/60'
        : 'border-slate-200 bg-white'
      }`}>
        <div className="shrink-0">
          {vroomStatus === 'ok'  && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
          {vroomStatus === 'down' && <WifiOff className="w-4 h-4 text-red-500" />}
          {vroomStatus === 'checking' && <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />}
          {vroomStatus === 'unset' && <Wifi className="w-4 h-4 text-slate-400" />}
        </div>
        <div className="flex-1 min-w-[220px]">
          <input
            value={urlDraft} onChange={e => setUrlDraft(e.target.value)}
            placeholder="https://fleetops-vroom-engine.onrender.com"
            className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 font-mono"
          />
        </div>
        <button onClick={saveUrl}
          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold">
          Save & Test
        </button>
        <span className={`text-[11px] font-semibold ${
          vroomStatus === 'ok' ? 'text-emerald-600'
          : vroomStatus === 'down' ? 'text-red-600'
          : 'text-slate-400'
        }`}>
          {vroomStatus === 'ok' ? '✓ VROOM online' : vroomStatus === 'down' ? `✗ ${vroomDetail}` : vroomStatus === 'checking' ? 'Testing…' : 'URL not set'}
        </span>
      </div>

      {/* ── Preview of what will be planned ── */}
      {runStatus === 'idle' && cityGroups.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 px-5 py-4">
          <div className="text-xs font-bold text-slate-700 mb-3">Cities ready to plan ({cityGroups.length})</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {cityGroups.map((g, i) => (
              <div key={g.city} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-800 truncate">{g.city}</div>
                  <div className="text-[10px] text-slate-400">{g.techs.length} techs · {g.tickets.length} tickets</div>
                </div>
              </div>
            ))}
          </div>
          {vroomStatus !== 'ok' && (
            <div className="mt-3 flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              Set a VROOM service URL above and confirm it's online before running.
            </div>
          )}
        </div>
      )}

      {runStatus === 'idle' && cityGroups.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 px-6 py-14 text-center">
          <Truck className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <div className="text-sm font-semibold text-slate-500">Nothing to plan yet</div>
          <div className="text-xs text-slate-400 mt-1">
            Import open tickets and make sure technicians have a starting location and an active status.
          </div>
        </div>
      )}

      {/* ── Summary strip (after run) ── */}
      {runStatus === 'done' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Cities Planned',    value: cityPlans.length,  Icon: MapPin,     color: 'text-blue-600'    },
            { label: 'Techs Deployed',    value: totalTechs,        Icon: Users,      color: 'text-indigo-600'  },
            { label: 'Visits Routed',     value: totalVisits,       Icon: Route,      color: 'text-emerald-600' },
            { label: 'Unrouted Tickets',  value: totalUnrouted,     Icon: AlertTriangle, color: totalUnrouted ? 'text-amber-500' : 'text-slate-300' },
          ].map(({ label, value, Icon, color }) => (
            <div key={label} className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center gap-3">
              <Icon className={`w-4 h-4 shrink-0 ${color}`} />
              <div>
                <div className="text-[11px] text-slate-500">{label}</div>
                <div className="text-sm font-bold text-slate-800">{value}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── City tabs ── */}
      {runStatus === 'done' && cityPlans.length > 0 && (
        <>
          <div className="flex gap-1.5 flex-wrap">
            {cityPlans.map((cp, i) => (
              <button key={cp.city}
                onClick={() => setActiveCity(cp.city)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors border ${
                  activeCity === cp.city
                    ? 'text-white border-transparent shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
                style={activeCity === cp.city ? { backgroundColor: COLORS[i % COLORS.length] } : {}}>
                {cp.city}
                <span className="ml-1.5 opacity-80 font-normal">
                  {cp.plans.reduce((s, p) => s + p.stops.length, 0)} visits
                </span>
                {cp.error && <span className="ml-1 text-red-300">⚠</span>}
              </button>
            ))}
          </div>

          {/* ── Active city detail ── */}
          {activeplan && (
            <div className="space-y-3">
              {/* City header */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[cityPlans.findIndex(c => c.city === activeCity) % COLORS.length] }} />
                  <span className="text-sm font-bold text-slate-800">{activeplan.city}</span>
                  <span className="text-[11px] text-slate-400">
                    {activeplan.plans.length} technicians · {activeplan.plans.reduce((s, p) => s + p.stops.length, 0)} visits
                    {activeplan.solveMs ? ` · solved in ${activeplan.solveMs}ms` : ''}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => downloadCSV(activeplan)}
                    className="flex items-center gap-1 px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-semibold border border-emerald-200">
                    <FileText className="w-3 h-3" /> CSV
                  </button>
                  <button onClick={() => downloadPDF(activeplan)}
                    className="flex items-center gap-1 px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold">
                    <Download className="w-3 h-3" /> PDF
                  </button>
                </div>
              </div>

              {/* Error state */}
              {activeplan.error && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-700">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  VROOM error for {activeplan.city}: {activeplan.error}
                </div>
              )}

              {/* Technician cards */}
              {activeplan.plans.map((plan, pi) => {
                const isExp = expanded[`${activeplan.city}:${plan.technicianId}`] ?? true;
                return (
                  <div key={plan.technicianId} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    {/* Tech header */}
                    <button
                      className="w-full px-5 py-3 flex flex-wrap items-center justify-between gap-3 bg-slate-50 border-b border-slate-100 hover:bg-slate-100/70 transition-colors"
                      onClick={() => setExpanded(e => ({ ...e, [`${activeplan.city}:${plan.technicianId}`]: !isExp }))}>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 text-white"
                          style={{ backgroundColor: COLORS[pi % COLORS.length] }}>
                          {plan.technicianName.charAt(0)}
                        </div>
                        <div className="text-left">
                          <div className="font-bold text-slate-800 text-sm">{plan.technicianName}</div>
                          <div className="text-[11px] text-slate-400">{plan.employeeId}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-slate-500">
                        <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{plan.stops.length} stops</span>
                        <span className="flex items-center gap-1"><Route className="w-3 h-3" />{plan.totalDistanceKm} km</span>
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{Math.floor(plan.totalEstimatedMins / 60)}h {plan.totalEstimatedMins % 60}m</span>
                        {isExp ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
                      </div>
                    </button>

                    {/* Stops */}
                    {isExp && (
                      <div className="divide-y divide-slate-50">
                        {plan.stops.map((stop, si) => {
                          const pri = PRI[stop.priority] ?? PRI.LOW;
                          return (
                            <div key={`${stop.ticketId}-${si}`}
                              className="px-5 py-3 flex flex-wrap items-start gap-4 hover:bg-slate-50/60">
                              <div className="flex flex-col items-center gap-1 shrink-0 pt-0.5">
                                <div className="w-6 h-6 rounded-full bg-slate-800 text-white flex items-center justify-center text-[11px] font-bold">{stop.stopOrder}</div>
                                {si < plan.stops.length - 1 && <div className="w-px h-4 bg-slate-200" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-2 mb-0.5">
                                  <span className="font-bold text-slate-800 text-sm">{stop.ticketId}</span>
                                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${pri.badge}`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${pri.dot}`} />
                                    {stop.priority}
                                  </span>
                                  <span className="text-xs text-slate-400 flex items-center gap-1">
                                    <Truck className="w-3 h-3" />{stop.vehicleNumber}
                                  </span>
                                </div>
                                <div className="text-xs text-slate-600 truncate">{stop.issue}</div>
                                <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-400">
                                  <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{stop.centerName}</span>
                                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" />ETA {stop.estimatedArrival}</span>
                                  <span>~{stop.estimatedDurationMins} min</span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Unrouted */}
              {activeplan.unrouted.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-amber-700 mb-2">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {activeplan.unrouted.length} ticket{activeplan.unrouted.length > 1 ? 's' : ''} not routed
                    <span className="font-normal text-amber-500">(no technician with capacity, or no center coordinates)</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {activeplan.unrouted.map(t => (
                      <span key={t.ticketId} className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded text-[10px] font-mono font-semibold">
                        {t.ticketId}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── print HTML ────────────────────────────────────────────────────────────────
function buildPrintHtml(cityPlans: CityPlan[], date: string): string {
  const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const PC: Record<string, string> = { CRITICAL: '#dc2626', HIGH: '#ea580c', MEDIUM: '#ca8a04', LOW: '#94a3b8' };
  const PB: Record<string, string> = { CRITICAL: '#fef2f2', HIGH: '#fff7ed', MEDIUM: '#fefce8', LOW: '#f8fafc' };

  const sections = cityPlans.map(cp => {
    const techCards = cp.plans.map(plan => {
      const rows = plan.stops.length === 0
        ? `<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:12px;font-size:11px;">No visits assigned</td></tr>`
        : plan.stops.map(s => `<tr>
            <td style="padding:5px 7px;border:1px solid #e2e8f0;text-align:center;font-weight:700;">${s.stopOrder}</td>
            <td style="padding:5px 7px;border:1px solid #e2e8f0;font-weight:700;">${s.ticketId}</td>
            <td style="padding:5px 7px;border:1px solid #e2e8f0;">${s.vehicleNumber}</td>
            <td style="padding:5px 7px;border:1px solid #e2e8f0;max-width:120px;">${s.centerName}</td>
            <td style="padding:5px 7px;border:1px solid #e2e8f0;max-width:160px;">${s.issue}</td>
            <td style="padding:5px 7px;border:1px solid #e2e8f0;text-align:center;">
              <span style="padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;background:${PB[s.priority] ?? '#f8fafc'};color:${PC[s.priority] ?? '#94a3b8'};">${s.priority}</span>
            </td>
            <td style="padding:5px 7px;border:1px solid #e2e8f0;text-align:center;font-weight:600;">${s.estimatedArrival}</td>
            <td style="padding:5px 7px;border:1px solid #e2e8f0;text-align:center;">${s.estimatedDurationMins}m</td>
          </tr>`).join('');
      return `<div class="card">
        <div class="ch">
          <div class="av">${plan.technicianName.charAt(0)}</div>
          <div>
            <div style="font-weight:800;font-size:13px;">${plan.technicianName}</div>
            <div style="font-size:10px;color:#94a3b8;">${plan.employeeId}</div>
          </div>
          <div class="st">
            <span>${plan.stops.length} stops</span>
            <span>${plan.totalDistanceKm} km</span>
            <span>${Math.floor(plan.totalEstimatedMins / 60)}h ${plan.totalEstimatedMins % 60}m</span>
          </div>
        </div>
        <table><thead><tr>
          <th style="width:24px">#</th><th>Ticket</th><th>Vehicle</th><th>Center</th>
          <th>Issue</th><th>Priority</th><th>ETA</th><th>Dur.</th>
        </tr></thead><tbody>${rows}</tbody></table>
        <div class="sig">
          <span>Technician Signature: _________________________</span>
          <span>Supervisor Sign-off: _________________________</span>
        </div>
      </div>`;
    }).join('');

    const unrouted = cp.unrouted.length
      ? `<div class="unr">⚠ Unrouted: ${cp.unrouted.map(t => t.ticketId).join(', ')}</div>`
      : '';

    return `<div class="city-section">
      <div class="city-hdr">${cp.city} — ${cp.plans.reduce((s, p) => s + p.stops.length, 0)} visits · ${cp.plans.length} technicians</div>
      ${techCards}${unrouted}
    </div>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>VROOM Roster — ${date}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:20px;color:#1e293b;font-size:12px}
.hdr{margin-bottom:18px;border-bottom:2px solid #1e293b;padding-bottom:10px;display:flex;justify-content:space-between;align-items:flex-end}
.hdr h1{font-size:20px;font-weight:800}
.meta{font-size:11px;color:#64748b}
.city-section{margin-bottom:28px}
.city-hdr{font-size:15px;font-weight:800;color:#1e293b;padding:6px 0;border-bottom:1.5px solid #334155;margin-bottom:12px}
.card{margin-bottom:14px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;page-break-inside:avoid}
.ch{background:#f8fafc;padding:8px 12px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #e2e8f0}
.av{width:28px;height:28px;border-radius:50%;background:#1e40af;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;flex-shrink:0}
.st{margin-left:auto;display:flex;gap:12px;font-size:11px;color:#475569;font-weight:600}
table{width:100%;border-collapse:collapse;font-size:11px}
th{background:#f1f5f9;padding:5px 7px;text-align:left;border:1px solid #e2e8f0;font-size:10px;color:#64748b}
.sig{display:flex;gap:20px;padding:8px 12px;border-top:1px solid #f1f5f9;font-size:10px;color:#94a3b8}
.unr{margin-top:6px;padding:6px 10px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;font-size:10px;color:#92400e}
@media print{body{padding:8px}@page{size:A4 portrait;margin:10mm}.card{margin-bottom:10px}}
</style></head><body>
<div class="hdr">
  <div><h1>FleetOps — VROOM Roster (All Cities)</h1><div class="meta">${dateLabel}</div></div>
  <div class="meta" style="text-align:right">Printed: ${new Date().toLocaleString('en-IN')}<br>ssn090643@delhivery.com</div>
</div>
${sections}
</body></html>`;
}
