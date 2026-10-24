/**
 * Cluster Routes Page
 *
 * Fixed metro clusters: Delhi NCR · Mumbai · Bangalore · Raipur · Pune · Hyderabad · Chennai
 * Each cluster runs VROOM independently, using only that cluster's technicians and tickets.
 * Layout mirrors the VROOM Routes page: stats strip, cluster tabs, tech cards with colored
 * left border, ordered stop rows with ETAs, "not used" section, and a right-hand map.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, CalendarDays, CheckCircle2, ChevronDown, ChevronRight,
  Clock, Download, FileText, Loader2, Map as MapIcon, MapPin,
  RefreshCw, Route, Truck, Users, Wifi, WifiOff,
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Polyline, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getCenters, getTechnicians, getTickets, subscribeToDataChanges } from '../../services/storage';
import { normaliseCityToPreset, CITY_PRESETS } from '../../services/routeOptimizer';
import { solveWithVroom, getVroomUrl, setVroomUrl, checkVroom } from '../../services/vroom';
import type { TechnicianRoutePlan, Ticket, Technician, Center } from '../../types';
import { localDate } from '../../lib/date';

// ── constants ─────────────────────────────────────────────────────────────────
const CLUSTER_ORDER = ['Delhi NCR', 'Mumbai', 'Bangalore', 'Raipur', 'Pune', 'Hyderabad', 'Chennai'];

const CLUSTER_COLOR: Record<string, string> = {
  'Delhi NCR':  '#2563EB',
  'Mumbai':     '#DC2626',
  'Bangalore':  '#059669',
  'Raipur':     '#D97706',
  'Pune':       '#7C3AED',
  'Hyderabad':  '#DB2777',
  'Chennai':    '#0891B2',
};

// fallback palette for tech cards (cycles)
const TECH_COLORS = [
  '#2563EB','#DC2626','#059669','#D97706','#7C3AED',
  '#DB2777','#0891B2','#65A30D','#EA580C','#4F46E5',
];

const PRI: Record<string, { dot: string; badge: string }> = {
  CRITICAL: { dot: 'bg-red-500',    badge: 'bg-red-100 text-red-700'       },
  HIGH:     { dot: 'bg-orange-500', badge: 'bg-orange-100 text-orange-700' },
  MEDIUM:   { dot: 'bg-yellow-400', badge: 'bg-yellow-50 text-yellow-700'  },
  LOW:      { dot: 'bg-slate-300',  badge: 'bg-slate-100 text-slate-500'   },
};

const STATUS_BADGE: Record<string, string> = {
  'Open':            'bg-blue-50 text-blue-700',
  'Assigned':        'bg-indigo-50 text-indigo-700',
  'In Progress':     'bg-amber-50 text-amber-700',
  'Pending Spares':  'bg-orange-50 text-orange-700',
  'Resolved':        'bg-emerald-50 text-emerald-700',
  'Closed':          'bg-slate-100 text-slate-500',
};

// ── types ─────────────────────────────────────────────────────────────────────
interface ClusterGroup {
  cluster: string;
  techs: Technician[];
  centers: Center[];
  tickets: Ticket[];
}

interface ClusterPlan {
  cluster: string;
  plans: TechnicianRoutePlan[];
  unrouted: Ticket[];
  unusedTechs: Technician[];
  allTechs: Technician[];
  allTickets: Ticket[];
  allCenters: Center[];
  solveMs: number;
  capUsed: number;
  error?: string;
}

type RunStatus = 'idle' | 'running' | 'done';

// ── helpers ───────────────────────────────────────────────────────────────────
const isOpen = (t: Ticket) => t.status !== 'Resolved' && t.status !== 'Closed';

function hav(aLat: number, aLng: number, bLat: number, bLng: number) {
  const t = Math.PI / 180;
  const x = Math.sin((bLat - aLat) * t / 2) ** 2 + Math.cos(aLat * t) * Math.cos(bLat * t) * Math.sin((bLng - aLng) * t / 2) ** 2;
  return +(2 * 6371 * Math.asin(Math.sqrt(x))).toFixed(1);
}

function nearestTicketKm(tech: Technician, tickets: Ticket[], centers: Center[]): number | null {
  if (!tech.startingLatitude || !tech.startingLongitude || !tickets.length) return null;
  const centerCoords = new Map(centers.map(c => [c.name.trim().toLowerCase(), { lat: c.latitude, lng: c.longitude }]));
  let min = Infinity;
  for (const t of tickets) {
    const c = centerCoords.get(t.centerName.trim().toLowerCase());
    if (c) min = Math.min(min, hav(tech.startingLatitude, tech.startingLongitude, c.lat, c.lng));
  }
  return min === Infinity ? null : min;
}

function buildClusterGroups(): ClusterGroup[] {
  const techs   = getTechnicians().filter(t => t.status === 'Active' && !t.excludeFromRouting && t.startingLatitude != null && t.startingLongitude != null);
  const centers = getCenters().filter(c => c.active);
  const tickets = getTickets().filter(t => isOpen(t) && !t.ignoreForRouting);

  const techsByCluster   = new Map<string, Technician[]>();
  const centersByCluster = new Map<string, Center[]>();

  for (const t of techs) {
    const k = normaliseCityToPreset(t.city);
    if (!k) continue;
    const arr = techsByCluster.get(k) ?? []; arr.push(t); techsByCluster.set(k, arr);
  }
  for (const c of centers) {
    const k = normaliseCityToPreset(c.city);
    if (!k) continue;
    const arr = centersByCluster.get(k) ?? []; arr.push(c); centersByCluster.set(k, arr);
  }

  const centerToCluster = new Map<string, string>();
  for (const c of centers) {
    const k = normaliseCityToPreset(c.city);
    if (k) centerToCluster.set(c.name.trim().toLowerCase(), k);
  }

  const ticketsByCluster = new Map<string, Ticket[]>();
  for (const t of tickets) {
    const k = centerToCluster.get(t.centerName.trim().toLowerCase());
    if (!k) continue;
    const arr = ticketsByCluster.get(k) ?? []; arr.push(t); ticketsByCluster.set(k, arr);
  }

  return CLUSTER_ORDER
    .filter(c => (techsByCluster.get(c)?.length ?? 0) > 0 || (ticketsByCluster.get(c)?.length ?? 0) > 0)
    .map(c => ({
      cluster: c,
      techs:   techsByCluster.get(c)   ?? [],
      centers: centersByCluster.get(c) ?? [],
      tickets: ticketsByCluster.get(c) ?? [],
    }));
}

// ── Leaflet map ───────────────────────────────────────────────────────────────
function makeIcon(color: string, label: string | number, size = 24) {
  return L.divIcon({
    className: '',
    iconAnchor: [size / 2, size / 2],
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};color:#fff;display:flex;align-items:center;justify-content:center;font-size:${size < 22 ? 9 : 11}px;font-weight:800;border:2px solid rgba(255,255,255,0.9);box-shadow:0 1px 4px rgba(0,0,0,.3)">${label}</div>`,
  });
}

function makeBaseIcon(initials: string, color: string) {
  return L.divIcon({
    className: '',
    iconAnchor: [14, 14],
    html: `<div style="width:28px;height:28px;border-radius:50%;background:${color};color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3)">${initials}</div>`,
  });
}

interface ClusterMapProps { plan: ClusterPlan; color: string }

function ClusterMap({ plan, color }: ClusterMapProps) {
  const allPoints: [number, number][] = [];
  for (const p of plan.plans) {
    if (p.startLat && p.startLng) allPoints.push([p.startLat, p.startLng]);
    for (const s of p.stops) allPoints.push([s.latitude, s.longitude]);
  }
  if (!allPoints.length) return (
    <div className="flex-1 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center text-xs text-slate-400 min-h-[320px]">
      <MapIcon className="w-6 h-6 text-slate-300 mr-2" /> No route data to display
    </div>
  );

  const lats = allPoints.map(p => p[0]);
  const lngs = allPoints.map(p => p[1]);
  const center: [number, number] = [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lngs) + Math.max(...lngs)) / 2];

  return (
    <div className="flex-1 rounded-xl overflow-hidden border border-slate-200 shadow-sm min-h-[320px]">
      <div className="bg-slate-50 border-b border-slate-200 px-3 py-2 text-xs text-slate-500 flex items-center gap-2">
        <MapIcon className="w-3.5 h-3.5" />
        <span className="font-semibold text-slate-700">{plan.cluster} map</span>
        <span className="text-slate-300">bases · numbered stops · solid = road route</span>
      </div>
      <MapContainer center={center} zoom={11} style={{ height: '340px', width: '100%' }} zoomControl scrollWheelZoom={false}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />
        {plan.plans.map((p, pi) => {
          const tc = TECH_COLORS[pi % TECH_COLORS.length];
          const initials = p.technicianName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
          const route: [number, number][] = p.startLat && p.startLng ? [[p.startLat, p.startLng]] : [];
          p.stops.forEach(s => route.push([s.latitude, s.longitude]));

          return (
            <React.Fragment key={p.technicianId}>
              {p.startLat && p.startLng && (
                <Marker position={[p.startLat, p.startLng]} icon={makeBaseIcon(initials, tc)}>
                  <Popup><b>{p.technicianName}</b><br />Base ({p.employeeId})</Popup>
                </Marker>
              )}
              {p.stops.map((s, si) => (
                <Marker key={s.ticketId} position={[s.latitude, s.longitude]} icon={makeIcon(s.ticketStatus === 'Resolved' ? '#10b981' : tc, si + 1)}>
                  <Popup>
                    <b>{s.ticketId}</b><br />{s.centerName}<br />{s.vehicleNumber}<br />
                    ETA {s.estimatedArrival} · {s.priority}
                  </Popup>
                </Marker>
              ))}
              {route.length > 1 && <Polyline positions={route} color={tc} weight={2} opacity={0.8} />}
            </React.Fragment>
          );
        })}
      </MapContainer>
    </div>
  );
}

// ── component ─────────────────────────────────────────────────────────────────
export function ClusterRoutesPage() {
  const today = localDate();
  const [selectedDate, setSelectedDate]   = useState(today);
  const [clusterPlans, setClusterPlans]   = useState<ClusterPlan[]>([]);
  const [runStatus, setRunStatus]         = useState<RunStatus>('idle');
  const [activeCluster, setActiveCluster] = useState('');
  const [expanded, setExpanded]           = useState<Record<string, boolean>>({});

  const [groups, setGroups] = useState(() => buildClusterGroups());
  useEffect(() => subscribeToDataChanges(() => setGroups(buildClusterGroups())), []);

  // VROOM
  const [vroomUrl, setVroomUrlState]  = useState(getVroomUrl());
  const [vroomStatus, setVroomStatus] = useState<'checking'|'ok'|'down'|'unset'>(vroomUrl ? 'checking' : 'unset');
  const [vroomDetail, setVroomDetail] = useState('');
  const [urlDraft, setUrlDraft]       = useState(vroomUrl.replace(/\/$/, ''));

  const testVroom = useCallback(async (url: string) => {
    setVroomStatus(url ? 'checking' : 'unset'); setVroomDetail('');
    const r = await checkVroom(url);
    setVroomStatus(r.status); setVroomDetail(r.detail);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (vroomUrl) testVroom(vroomUrl); }, []);

  const saveUrl = () => {
    setVroomUrl(urlDraft.trim().replace(/\/$/, ''));
    setVroomUrlState(getVroomUrl());
    testVroom(getVroomUrl());
  };

  const runAll = useCallback(async () => {
    if (vroomStatus !== 'ok') return;
    setRunStatus('running');

    const current = buildClusterGroups();

    const results = await Promise.allSettled(
      current.map(async g => {
        const preset = CITY_PRESETS[g.cluster];
        try {
          const r = await solveWithVroom({
            techs: g.techs, tickets: g.tickets, centers: g.centers,
            maxStops:   preset?.maxStopsPerTech ?? 8,
            maxKm:      preset?.maxKmPerTech    ?? 70,
            shiftStart: preset?.shiftStartHour  ?? 9,
            shiftEnd:   preset?.shiftEndHour    ?? 18,
            mode: 'balanced', roadMatrix: null,
          });
          const usedIds = new Set(r.plans.map(p => p.technicianId));
          return {
            cluster: g.cluster, plans: r.plans, unrouted: r.unrouted,
            unusedTechs: g.techs.filter(t => !usedIds.has(t.id)),
            allTechs: g.techs, allTickets: g.tickets, allCenters: g.centers,
            solveMs: r.solveMs, capUsed: r.capUsed,
          } as ClusterPlan;
        } catch (e) {
          return {
            cluster: g.cluster, plans: [], unrouted: g.tickets,
            unusedTechs: g.techs, allTechs: g.techs, allTickets: g.tickets, allCenters: g.centers,
            solveMs: 0, capUsed: 0, error: (e as Error).message,
          } as ClusterPlan;
        }
      }),
    );

    const settled: ClusterPlan[] = results.map((r, i) =>
      r.status === 'fulfilled' ? r.value : {
        cluster: current[i]?.cluster ?? '?',
        plans: [], unrouted: current[i]?.tickets ?? [],
        unusedTechs: current[i]?.techs ?? [], allTechs: current[i]?.techs ?? [],
        allTickets: current[i]?.tickets ?? [], allCenters: current[i]?.centers ?? [],
        solveMs: 0, capUsed: 0, error: String((r as PromiseRejectedResult).reason),
      },
    );
    setClusterPlans(settled);
    setActiveCluster(settled[0]?.cluster ?? '');
    setExpanded(Object.fromEntries(
      settled.flatMap(c => c.plans.map(p => [`${c.cluster}:${p.technicianId}`, true])),
    ));
    setRunStatus('done');
  }, [vroomStatus]);

  // ── computed ───────────────────────────────────────────────────────────────
  const activeplan     = clusterPlans.find(c => c.cluster === activeCluster);
  const totalTickets   = clusterPlans.reduce((s, c) => s + c.allTickets.length, 0);
  const totalPlanned   = clusterPlans.reduce((s, c) => s + c.plans.reduce((a, p) => a + p.stops.length, 0), 0);
  const totalUnplanned = clusterPlans.reduce((s, c) => s + c.unrouted.length, 0);
  const totalTechsUsed = clusterPlans.reduce((s, c) => s + c.plans.length, 0);
  const totalTechsAll  = clusterPlans.reduce((s, c) => s + c.allTechs.length, 0);
  const totalKm        = clusterPlans.reduce((s, c) => s + c.plans.reduce((a, p) => a + p.totalDistanceKm, 0), 0);

  // ── downloads ──────────────────────────────────────────────────────────────
  const downloadCSV = (cp?: ClusterPlan) => {
    const scope = cp ? [cp] : clusterPlans;
    const rows: string[][] = [['Cluster','Technician','Emp ID','Stop#','Ticket','Vehicle','Center','Issue','Priority','ETA','Mins']];
    for (const c of scope) {
      for (const p of c.plans) {
        if (!p.stops.length) { rows.push([c.cluster, p.technicianName, p.employeeId,'—','—','—','—','—','—','—','—']); continue; }
        for (const s of p.stops) rows.push([c.cluster, p.technicianName, p.employeeId, String(s.stopOrder), s.ticketId, s.vehicleNumber, s.centerName, s.issue, s.priority, s.estimatedArrival, String(s.estimatedDurationMins)]);
      }
      for (const t of c.unrouted) rows.push([c.cluster,'UNROUTED','','',t.ticketId,t.vehicleNumber ?? '',t.centerName,t.issue,t.priority,'','']);
    }
    const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    a.download = `cluster_roster_${cp?.cluster.replace(/ /g,'_') ?? 'all'}_${selectedDate}.csv`; a.click();
  };

  const downloadPDF = (cp?: ClusterPlan) => {
    const scope = cp ? [cp] : clusterPlans;
    const win = window.open('','_blank'); if (!win) return;
    win.document.write(buildPrintHtml(scope, selectedDate));
    win.document.close(); setTimeout(() => { win.focus(); win.print(); }, 400);
  };

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Route className="w-5 h-5 text-blue-600" />
            Cluster Routes
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Each cluster is optimised by VROOM with its own technicians and tickets.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5">
            <CalendarDays className="w-3.5 h-3.5 text-slate-400" />
            <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
              className="text-xs font-semibold text-slate-700 bg-transparent focus:outline-none" />
          </div>
          {runStatus === 'done' && <>
            <button onClick={() => downloadCSV()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-semibold border border-emerald-200">
              <FileText className="w-3.5 h-3.5" /> CSV (All)
            </button>
            <button onClick={() => downloadPDF()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-sm">
              <Download className="w-3.5 h-3.5" /> PDF (All)
            </button>
          </>}
          <button onClick={() => void runAll()} disabled={vroomStatus !== 'ok' || runStatus === 'running'}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-slate-900 hover:bg-black disabled:opacity-40 text-white rounded-lg text-xs font-bold shadow-sm">
            {runStatus === 'running' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {runStatus === 'idle' ? 'Run VROOM' : runStatus === 'running' ? 'Running…' : 'Re-run'}
          </button>
        </div>
      </div>

      {/* VROOM URL bar */}
      <div className={`rounded-xl border px-4 py-3 flex flex-wrap items-center gap-3 ${
        vroomStatus === 'ok'     ? 'border-emerald-200 bg-emerald-50/60'
        : vroomStatus === 'down' ? 'border-red-200 bg-red-50/60'
        : 'border-slate-200 bg-white'}`}>
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-600 shrink-0">
          VROOM service:
          {vroomStatus === 'ok'       && <span className="text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> connected</span>}
          {vroomStatus === 'down'     && <span className="text-red-600 flex items-center gap-1"><WifiOff className="w-3.5 h-3.5" /> down</span>}
          {vroomStatus === 'checking' && <span className="text-blue-500 flex items-center gap-1"><Loader2 className="w-3.5 h-3.5 animate-spin" /> checking</span>}
          {vroomStatus === 'unset'    && <span className="text-slate-400 flex items-center gap-1"><Wifi className="w-3.5 h-3.5" /> not set</span>}
        </div>
        <input value={urlDraft} onChange={e => setUrlDraft(e.target.value)}
          placeholder="https://fleetops-vroom-engine.onrender.com"
          className="flex-1 min-w-[220px] text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 font-mono" />
        <button onClick={saveUrl}
          className="px-4 py-1.5 bg-slate-900 hover:bg-black text-white rounded-lg text-xs font-bold">
          Save &amp; test
        </button>
        {vroomStatus === 'down' && <span className="text-[11px] text-red-500">{vroomDetail}</span>}
      </div>

      {/* Stats strip (after run) OR cluster preview grid (before run) */}
      {runStatus === 'done' ? (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
            <div className="text-[10px] text-slate-400 uppercase tracking-wide">Showing</div>
            <div className="text-sm font-bold text-emerald-600 leading-tight mt-0.5">Cluster<br />assignments</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
            <div className="text-[10px] text-slate-400 uppercase tracking-wide">Tickets Planned</div>
            <div className="text-lg font-bold text-slate-800">{totalPlanned} / {totalTickets}</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
            <div className="text-[10px] text-slate-400 uppercase tracking-wide">Not Planned</div>
            <div className={`text-lg font-bold ${totalUnplanned ? 'text-amber-600' : 'text-slate-800'}`}>{totalUnplanned}</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
            <div className="text-[10px] text-slate-400 uppercase tracking-wide">Technicians Used</div>
            <div className="text-lg font-bold text-slate-800">{totalTechsUsed} / {totalTechsAll}</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
            <div className="text-[10px] text-slate-400 uppercase tracking-wide">Total Road KM</div>
            <div className="text-lg font-bold text-slate-800">{totalKm.toFixed(1)}</div>
          </div>
        </div>
      ) : (
        groups.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 px-5 py-4">
            <div className="text-xs font-bold text-slate-700 mb-3">Clusters ready ({groups.length})</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {groups.map(g => (
                <div key={g.cluster} className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-slate-100 bg-slate-50">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: CLUSTER_COLOR[g.cluster] ?? '#64748b' }} />
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-800">{g.cluster}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {g.tickets.length} tickets · {g.techs.length} techs
                    </div>
                    {CITY_PRESETS[g.cluster] && (
                      <div className="text-[10px] text-slate-300 mt-0.5">
                        max {CITY_PRESETS[g.cluster].maxStopsPerTech} stops / {CITY_PRESETS[g.cluster].maxKmPerTech} km
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {vroomStatus !== 'ok' && (
              <div className="mt-3 flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                Set the VROOM service URL above and confirm it is online before running.
              </div>
            )}
          </div>
        )
      )}

      {/* ── Post-run: cluster tabs + detail ── */}
      {runStatus === 'done' && clusterPlans.length > 0 && (
        <>
          {/* Cluster tabs */}
          <div className="flex gap-2 flex-wrap">
            {clusterPlans.map(cp => {
              const planned = cp.plans.reduce((s, p) => s + p.stops.length, 0);
              const active  = activeCluster === cp.cluster;
              const col     = CLUSTER_COLOR[cp.cluster] ?? '#334155';
              return (
                <button key={cp.cluster} onClick={() => setActiveCluster(cp.cluster)}
                  className={`px-4 py-2 rounded-xl text-sm font-bold transition-all border ${
                    active ? 'text-white shadow-md border-transparent' : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                  }`}
                  style={active ? { backgroundColor: col } : {}}>
                  {cp.cluster}
                  <span className="ml-2 text-xs font-normal opacity-80">
                    {planned} ticket{planned !== 1 ? 's' : ''} · {cp.plans.length}/{cp.allTechs.length} techs
                  </span>
                  {cp.error && <span className="ml-1 opacity-70">⚠</span>}
                </button>
              );
            })}
          </div>

          {/* Active cluster detail */}
          {activeplan && (
            <div className="flex gap-4 items-start">

              {/* ── Left column: tech cards ── */}
              <div className="flex-1 min-w-0 space-y-3">

                {/* Cluster sub-header */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: CLUSTER_COLOR[activeplan.cluster] ?? '#334155' }} />
                    <span className="text-sm font-bold text-slate-800">{activeplan.cluster}</span>
                    <span className="text-[11px] text-slate-400">
                      {activeplan.plans.length} technician{activeplan.plans.length !== 1 ? 's' : ''} ·{' '}
                      {activeplan.plans.reduce((s, p) => s + p.stops.length, 0)} visits
                      {activeplan.solveMs ? ` · solved in ${activeplan.solveMs} ms` : ''}
                    </span>
                  </div>
                  <div className="flex gap-1.5">
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

                {/* Error banner */}
                {activeplan.error && (
                  <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-700">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    VROOM error for {activeplan.cluster}: {activeplan.error}
                  </div>
                )}

                {/* Tech cards */}
                {activeplan.plans.map((plan, pi) => {
                  const expKey = `${activeplan.cluster}:${plan.technicianId}`;
                  const isExp  = expanded[expKey] ?? true;
                  const tc     = TECH_COLORS[pi % TECH_COLORS.length];

                  return (
                    <div key={plan.technicianId} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                      {/* Header row */}
                      <button
                        className="w-full hover:bg-slate-50/60 transition-colors"
                        onClick={() => setExpanded(e => ({ ...e, [expKey]: !isExp }))}>
                        <div className="flex flex-wrap items-center gap-3 px-4 py-3" style={{ borderLeft: `4px solid ${tc}` }}>
                          {/* Avatar */}
                          <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 text-white" style={{ backgroundColor: tc }}>
                            {plan.technicianName.charAt(0)}
                          </div>
                          {/* Name + ID */}
                          <div className="text-left">
                            <div className="font-bold text-slate-800">{plan.technicianName}</div>
                            <div className="text-[11px] text-slate-400">{plan.employeeId}</div>
                          </div>
                          {/* Summary stats */}
                          <div className="ml-auto flex items-center gap-4 text-xs text-slate-500 pr-3">
                            <span className="font-semibold text-slate-700">{plan.stops.length} stops</span>
                            <span>{plan.totalDistanceKm} km</span>
                            <span>{Math.floor(plan.totalEstimatedMins / 60)}h {plan.totalEstimatedMins % 60}m drive</span>
                            {isExp ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
                          </div>
                        </div>
                      </button>

                      {/* Stop rows */}
                      {isExp && plan.stops.length > 0 && (
                        <div className="divide-y divide-slate-50">
                          {plan.stops.map((stop, si) => {
                            const pri     = PRI[stop.priority] ?? PRI.LOW;
                            const stBadge = STATUS_BADGE[stop.ticketStatus ?? ''] ?? 'bg-slate-100 text-slate-500';
                            return (
                              <div key={`${stop.ticketId}-${si}`} className="px-5 py-3 flex items-start gap-3">
                                {/* Step circle + connector */}
                                <div className="flex flex-col items-center gap-1 shrink-0 pt-0.5">
                                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white" style={{ backgroundColor: tc }}>
                                    {stop.stopOrder}
                                  </div>
                                  {si < plan.stops.length - 1 && <div className="w-px h-3 bg-slate-200" />}
                                </div>
                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                  {/* Row 1: ticket id + priority + status */}
                                  <div className="flex flex-wrap items-center gap-1.5 mb-1">
                                    <span className="font-bold text-blue-600 text-sm">{stop.ticketId}</span>
                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${pri.badge}`}>
                                      <span className={`w-1.5 h-1.5 rounded-full ${pri.dot}`} />{stop.priority}
                                    </span>
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${stBadge}`}>
                                      {stop.ticketStatus ?? 'Open'}
                                    </span>
                                  </div>
                                  {/* Row 2: center + vehicle */}
                                  <div className="flex items-center gap-2 text-xs text-slate-500 mb-0.5">
                                    <MapPin className="w-3 h-3 shrink-0" />
                                    <span className="font-medium text-slate-700">{stop.centerName}</span>
                                    <span className="text-slate-300">·</span>
                                    <Truck className="w-3 h-3 shrink-0" />
                                    <span>{stop.vehicleNumber}</span>
                                  </div>
                                  {/* Row 3: issue */}
                                  <div className="text-xs text-slate-500 truncate">{stop.issue}</div>
                                  {/* Row 4: ETA */}
                                  <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
                                    <Clock className="w-3 h-3" />
                                    <span>ETA {stop.estimatedArrival}</span>
                                    <span>· ~{stop.estimatedDurationMins} min on site</span>
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

                {/* Unrouted tickets */}
                {activeplan.unrouted.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                    <div className="flex items-center gap-2 text-xs font-bold text-amber-700 mb-2">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {activeplan.unrouted.length} ticket{activeplan.unrouted.length !== 1 ? 's' : ''} not routed
                      <span className="font-normal text-amber-500">(capacity full or missing center coordinates)</span>
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

                {/* Not used */}
                {activeplan.unusedTechs.length > 0 && (
                  <div className="bg-white border border-slate-200 rounded-xl px-5 py-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Users className="w-3.5 h-3.5 text-slate-400" />
                      <span className="text-sm font-bold text-slate-700">Not used ({activeplan.unusedTechs.length})</span>
                      <span className="font-normal text-slate-400 text-xs">
                        — VROOM found shorter total driving without assigning them
                      </span>
                    </div>
                    <div className="space-y-2">
                      {activeplan.unusedTechs.map(tech => {
                        const km = nearestTicketKm(tech, activeplan.allTickets, activeplan.allCenters);
                        return (
                          <div key={tech.id} className="flex items-center justify-between py-1">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-500">
                                {tech.name.charAt(0)}
                              </div>
                              <div>
                                <div className="text-sm font-semibold text-slate-800">{tech.name}</div>
                                <div className="text-[10px] text-slate-400">{tech.zone ?? tech.city}</div>
                              </div>
                            </div>
                            {km !== null && (
                              <span className="text-xs text-slate-400">nearest open ticket {km} km away</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* ── Right column: map ── */}
              <div className="hidden lg:block w-[420px] xl:w-[480px] shrink-0">
                <ClusterMap plan={activeplan} color={CLUSTER_COLOR[activeplan.cluster] ?? '#2563EB'} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── print HTML helper ─────────────────────────────────────────────────────────
function buildPrintHtml(plans: ClusterPlan[], date: string): string {
  const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const PC: Record<string, string> = { CRITICAL: '#dc2626', HIGH: '#ea580c', MEDIUM: '#ca8a04', LOW: '#94a3b8' };
  const PB: Record<string, string> = { CRITICAL: '#fef2f2', HIGH: '#fff7ed', MEDIUM: '#fefce8', LOW: '#f8fafc' };

  const sections = plans.map(cp => {
    const cards = cp.plans.map((plan, pi) => {
      const tc   = TECH_COLORS[pi % TECH_COLORS.length];
      const rows = !plan.stops.length
        ? `<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:12px;font-size:11px;">No visits assigned</td></tr>`
        : plan.stops.map(s => `<tr>
            <td style="padding:5px 7px;border:1px solid #e2e8f0;text-align:center;font-weight:700;">${s.stopOrder}</td>
            <td style="padding:5px 7px;border:1px solid #e2e8f0;font-weight:700;">${s.ticketId}</td>
            <td style="padding:5px 7px;border:1px solid #e2e8f0;">${s.vehicleNumber}</td>
            <td style="padding:5px 7px;border:1px solid #e2e8f0;">${s.centerName}</td>
            <td style="padding:5px 7px;border:1px solid #e2e8f0;">${s.issue}</td>
            <td style="padding:5px 7px;border:1px solid #e2e8f0;text-align:center;">
              <span style="padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;background:${PB[s.priority]??'#f8fafc'};color:${PC[s.priority]??'#94a3b8'}">${s.priority}</span>
            </td>
            <td style="padding:5px 7px;border:1px solid #e2e8f0;text-align:center;font-weight:600;">${s.estimatedArrival}</td>
            <td style="padding:5px 7px;border:1px solid #e2e8f0;text-align:center;">${s.estimatedDurationMins}m</td>
          </tr>`).join('');

      return `<div class="card">
        <div class="ch" style="border-left:4px solid ${tc}">
          <div class="av" style="background:${tc}">${plan.technicianName.charAt(0)}</div>
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
          <th style="width:24px">#</th><th>Ticket</th><th>Vehicle</th><th>Center</th><th>Issue</th><th>Priority</th><th>ETA</th><th>Dur.</th>
        </tr></thead><tbody>${rows}</tbody></table>
        <div class="sig">
          <span>Technician Signature: _________________________</span>
          <span>Supervisor Sign-off: _________________________</span>
        </div>
      </div>`;
    }).join('');

    const unr = cp.unrouted.length
      ? `<div class="unr">⚠ Unrouted: ${cp.unrouted.map(t => t.ticketId).join(', ')}</div>` : '';

    return `<div class="city-section">
      <div class="city-hdr" style="border-left:4px solid ${CLUSTER_COLOR[cp.cluster]??'#334155'}">
        ${cp.cluster} — ${cp.plans.reduce((s,p)=>s+p.stops.length,0)} visits · ${cp.plans.length} technicians
      </div>
      ${cards}${unr}
    </div>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Cluster Routes — ${date}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:20px;color:#1e293b;font-size:12px}
.hdr{margin-bottom:18px;border-bottom:2px solid #1e293b;padding-bottom:10px;display:flex;justify-content:space-between;align-items:flex-end}
.hdr h1{font-size:20px;font-weight:800}.meta{font-size:11px;color:#64748b}
.city-section{margin-bottom:28px}
.city-hdr{font-size:15px;font-weight:800;color:#1e293b;padding:6px 0 6px 10px;margin-bottom:12px}
.card{margin-bottom:14px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;page-break-inside:avoid}
.ch{background:#f8fafc;padding:8px 12px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #e2e8f0}
.av{width:28px;height:28px;border-radius:50%;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;flex-shrink:0}
.st{margin-left:auto;display:flex;gap:12px;font-size:11px;color:#475569;font-weight:600}
table{width:100%;border-collapse:collapse;font-size:11px}
th{background:#f1f5f9;padding:5px 7px;text-align:left;border:1px solid #e2e8f0;font-size:10px;color:#64748b}
.sig{display:flex;gap:20px;padding:8px 12px;border-top:1px solid #f1f5f9;font-size:10px;color:#94a3b8}
.unr{margin-top:6px;padding:6px 10px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;font-size:10px;color:#92400e}
@media print{body{padding:8px}@page{size:A4 portrait;margin:10mm}.card{margin-bottom:10px}}
</style></head><body>
<div class="hdr">
  <div><h1>FleetOps — Cluster Routes</h1><div class="meta">${dateLabel}</div></div>
  <div class="meta" style="text-align:right">Printed: ${new Date().toLocaleString('en-IN')}<br>ssn090643@delhivery.com</div>
</div>
${sections}
</body></html>`;
}
