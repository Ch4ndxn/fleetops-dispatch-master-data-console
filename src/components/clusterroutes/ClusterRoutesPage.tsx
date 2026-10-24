/**
 * Cluster Routes Page
 *
 * Fixed metro clusters: Delhi NCR · Mumbai · Bangalore · Raipur · Pune · Hyderabad · Chennai
 * Each cluster runs VROOM independently using only that cluster's technicians and tickets.
 * Technicians with city strings like "Noida", "Gurgaon", "Gurugram" all fold into "Delhi NCR".
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, CalendarDays, CheckCircle2, ChevronDown, ChevronRight,
  Clock, Download, FileText, Loader2, MapPin, RefreshCw, Route,
  Truck, Users, Wifi, WifiOff,
} from 'lucide-react';
import { getCenters, getTechnicians, getTickets, subscribeToDataChanges } from '../../services/storage';
import { normaliseCityToPreset, CITY_PRESETS } from '../../services/routeOptimizer';
import { solveWithVroom, getVroomUrl, setVroomUrl, checkVroom } from '../../services/vroom';
import type { TechnicianRoutePlan, Ticket, Technician, Center } from '../../types';
import { localDate } from '../../lib/date';

// ── constants ─────────────────────────────────────────────────────────────────
/** The clusters we show, in display order */
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

const PRI: Record<string, { dot: string; badge: string }> = {
  CRITICAL: { dot: 'bg-red-500',    badge: 'bg-red-100 text-red-700'       },
  HIGH:     { dot: 'bg-orange-500', badge: 'bg-orange-100 text-orange-700' },
  MEDIUM:   { dot: 'bg-yellow-400', badge: 'bg-yellow-50 text-yellow-700'  },
  LOW:      { dot: 'bg-slate-300',  badge: 'bg-slate-100 text-slate-500'   },
};

// ── types ─────────────────────────────────────────────────────────────────────
interface ClusterPlan {
  cluster: string;
  plans: TechnicianRoutePlan[];
  unrouted: Ticket[];
  solveMs: number;
  capUsed: number;
  techCount: number;
  ticketCount: number;
  error?: string;
}

type RunStatus = 'idle' | 'running' | 'done';

// ── helpers ───────────────────────────────────────────────────────────────────
const isOpen = (t: Ticket) => t.status !== 'Resolved' && t.status !== 'Closed';

function buildClusterGroups() {
  const techs   = getTechnicians().filter(t => t.status === 'Active' && !t.excludeFromRouting && t.startingLatitude != null && t.startingLongitude != null);
  const centers = getCenters().filter(c => c.active);
  const tickets = getTickets().filter(t => isOpen(t) && !t.ignoreForRouting);

  // Map each tech to its canonical cluster
  const techsByCluster = new Map<string, Technician[]>();
  for (const t of techs) {
    const k = normaliseCityToPreset(t.city);
    if (!k) continue;
    const arr = techsByCluster.get(k) ?? []; arr.push(t); techsByCluster.set(k, arr);
  }

  // Map each center to its cluster
  const centersByCluster = new Map<string, Center[]>();
  for (const c of centers) {
    const k = normaliseCityToPreset(c.city);
    if (!k) continue;
    const arr = centersByCluster.get(k) ?? []; arr.push(c); centersByCluster.set(k, arr);
  }

  // Map center name → cluster key
  const centerToCluster = new Map<string, string>();
  for (const c of centers) {
    const k = normaliseCityToPreset(c.city);
    if (k) centerToCluster.set(c.name.trim().toLowerCase(), k);
  }

  // Map tickets to clusters via center
  const ticketsByCluster = new Map<string, Ticket[]>();
  for (const t of tickets) {
    const k = centerToCluster.get(t.centerName.trim().toLowerCase());
    if (!k) continue;
    const arr = ticketsByCluster.get(k) ?? []; arr.push(t); ticketsByCluster.set(k, arr);
  }

  // Only return clusters that have both techs AND tickets, in CLUSTER_ORDER
  return CLUSTER_ORDER
    .filter(c => (techsByCluster.get(c)?.length ?? 0) > 0 && (ticketsByCluster.get(c)?.length ?? 0) > 0)
    .map(c => ({
      cluster: c,
      techs: techsByCluster.get(c)!,
      centers: centersByCluster.get(c) ?? [],
      tickets: ticketsByCluster.get(c)!,
      preset: CITY_PRESETS[c],
    }));
}

// ── component ─────────────────────────────────────────────────────────────────
export function ClusterRoutesPage() {
  const today = localDate();
  const [selectedDate, setSelectedDate] = useState(today);
  const [clusterPlans, setClusterPlans] = useState<ClusterPlan[]>([]);
  const [preview, setPreview] = useState(() => buildClusterGroups());
  const [runStatus, setRunStatus] = useState<RunStatus>('idle');
  const [activeCluster, setActiveCluster] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // VROOM
  const [vroomUrl, setVroomUrlState] = useState(getVroomUrl());
  const [vroomStatus, setVroomStatus] = useState<'checking' | 'ok' | 'down' | 'unset'>(vroomUrl ? 'checking' : 'unset');
  const [vroomDetail, setVroomDetail] = useState('');
  const [urlDraft, setUrlDraft] = useState(vroomUrl.replace(/\/$/, ''));

  const testVroom = useCallback(async (url: string) => {
    setVroomStatus(url ? 'checking' : 'unset'); setVroomDetail('');
    const r = await checkVroom(url);
    setVroomStatus(r.status); setVroomDetail(r.detail);
  }, []);

  useEffect(() => { if (vroomUrl) testVroom(vroomUrl); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => subscribeToDataChanges(() => setPreview(buildClusterGroups())), []);

  const saveUrl = () => {
    setVroomUrl(urlDraft.trim().replace(/\/$/, ''));
    setVroomUrlState(getVroomUrl());
    testVroom(getVroomUrl());
  };

  const hasRunRef = useRef(false);

  const runAll = useCallback(async () => {
    if (vroomStatus !== 'ok') return;
    hasRunRef.current = true;
    setRunStatus('running');
    const groups = buildClusterGroups();

    const results = await Promise.allSettled(
      groups.map(async g => {
        try {
          const preset = g.preset;
          const r = await solveWithVroom({
            techs: g.techs, tickets: g.tickets, centers: g.centers,
            maxStops: preset?.maxStopsPerTech ?? 8,
            maxKm:    preset?.maxKmPerTech    ?? 70,
            shiftStart: preset?.shiftStartHour ?? 9,
            shiftEnd:   preset?.shiftEndHour   ?? 18,
            mode: 'balanced', roadMatrix: null,
          });
          return {
            cluster: g.cluster, plans: r.plans, unrouted: r.unrouted,
            solveMs: r.solveMs, capUsed: r.capUsed,
            techCount: g.techs.length, ticketCount: g.tickets.length,
          } as ClusterPlan;
        } catch (e) {
          return {
            cluster: g.cluster, plans: [], unrouted: g.tickets,
            solveMs: 0, capUsed: 0,
            techCount: g.techs.length, ticketCount: g.tickets.length,
            error: (e as Error).message,
          } as ClusterPlan;
        }
      }),
    );

    const settled = results.map(r => r.status === 'fulfilled' ? r.value : { cluster: '?', plans: [], unrouted: [], solveMs: 0, capUsed: 0, techCount: 0, ticketCount: 0, error: String(r.reason) });
    setClusterPlans(settled);
    setActiveCluster(settled[0]?.cluster ?? '');
    setExpanded(Object.fromEntries(settled.flatMap(c => c.plans.map(p => [`${c.cluster}:${p.technicianId}`, true]))));
    setRunStatus('done');
  }, [vroomStatus]);

  // ── summary ────────────────────────────────────────────────────────────────
  const totalVisits   = clusterPlans.reduce((s, c) => s + c.plans.reduce((a, p) => a + p.stops.length, 0), 0);
  const totalTechs    = clusterPlans.reduce((s, c) => s + c.plans.length, 0);
  const totalUnrouted = clusterPlans.reduce((s, c) => s + c.unrouted.length, 0);
  const activeplan    = clusterPlans.find(c => c.cluster === activeCluster);

  // ── downloads ──────────────────────────────────────────────────────────────
  const downloadCSV = (cp?: ClusterPlan) => {
    const scope = cp ? [cp] : clusterPlans;
    const rows: string[][] = [['Cluster','Technician','Emp ID','Stop#','Ticket','Vehicle','Center','Issue','Priority','ETA','Mins']];
    for (const c of scope) {
      for (const p of c.plans) {
        if (!p.stops.length) { rows.push([c.cluster, p.technicianName, p.employeeId,'—','—','—','—','—','—','—','—']); continue; }
        for (const s of p.stops) rows.push([c.cluster, p.technicianName, p.employeeId, String(s.stopOrder), s.ticketId, s.vehicleNumber, s.centerName, s.issue, s.priority, s.estimatedArrival, String(s.estimatedDurationMins)]);
      }
      for (const t of c.unrouted) rows.push([c.cluster,'UNROUTED','','','',t.ticketId,t.vehicleNumber,t.centerName,t.issue,t.priority,'','']);
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
            Delhi NCR · Mumbai · Bangalore · Raipur · Pune · Hyderabad · Chennai — each cluster routed independently via VROOM
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
            className="flex items-center gap-1.5 px-4 py-1.5 bg-slate-900 hover:bg-black disabled:opacity-40 text-white rounded-lg text-xs font-bold shadow-sm transition-colors">
            {runStatus === 'running' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {runStatus === 'idle' ? 'Run VROOM' : runStatus === 'running' ? 'Running…' : 'Re-run'}
          </button>
        </div>
      </div>

      {/* VROOM URL */}
      <div className={`rounded-xl border px-4 py-3 flex flex-wrap items-center gap-3 ${
        vroomStatus === 'ok' ? 'border-emerald-200 bg-emerald-50/60'
        : vroomStatus === 'down' ? 'border-red-200 bg-red-50/60'
        : 'border-slate-200 bg-white'}`}>
        <div className="shrink-0">
          {vroomStatus === 'ok'       && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
          {vroomStatus === 'down'     && <WifiOff className="w-4 h-4 text-red-500" />}
          {vroomStatus === 'checking' && <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />}
          {vroomStatus === 'unset'    && <Wifi className="w-4 h-4 text-slate-400" />}
        </div>
        <input value={urlDraft} onChange={e => setUrlDraft(e.target.value)}
          placeholder="https://fleetops-vroom-engine.onrender.com"
          className="flex-1 min-w-[220px] text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 font-mono" />
        <button onClick={saveUrl} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold">Save & Test</button>
        <span className={`text-[11px] font-semibold ${vroomStatus === 'ok' ? 'text-emerald-600' : vroomStatus === 'down' ? 'text-red-600' : 'text-slate-400'}`}>
          {vroomStatus === 'ok' ? '✓ VROOM online' : vroomStatus === 'down' ? `✗ ${vroomDetail}` : vroomStatus === 'checking' ? 'Testing…' : 'URL not set'}
        </span>
      </div>

      {/* Preview grid */}
      {runStatus === 'idle' && (
        <div className="bg-white rounded-xl border border-slate-200 px-5 py-4">
          {preview.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400">
              No clusters ready — import tickets and ensure technicians have a city and starting location.
            </div>
          ) : (
            <>
              <div className="text-xs font-bold text-slate-700 mb-3">Clusters ready to plan ({preview.length})</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {preview.map(g => (
                  <div key={g.cluster} className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-slate-100 bg-slate-50">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: CLUSTER_COLOR[g.cluster] ?? '#64748b' }} />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-800">{g.cluster}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {g.techs.length} tech{g.techs.length !== 1 ? 's' : ''} · {g.tickets.length} ticket{g.tickets.length !== 1 ? 's' : ''}
                      </div>
                      {g.preset && (
                        <div className="text-[10px] text-slate-300 mt-0.5">
                          max {g.preset.maxStopsPerTech} stops / {g.preset.maxKmPerTech} km
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {vroomStatus !== 'ok' && (
                <div className="mt-3 flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  Set the VROOM service URL above and confirm it's online before running.
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Summary strip after run */}
      {runStatus === 'done' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Clusters Planned',  value: clusterPlans.length, Icon: MapPin,        color: 'text-blue-600'    },
            { label: 'Techs Deployed',    value: totalTechs,          Icon: Users,         color: 'text-indigo-600'  },
            { label: 'Visits Routed',     value: totalVisits,         Icon: Route,         color: 'text-emerald-600' },
            { label: 'Unrouted Tickets',  value: totalUnrouted,       Icon: AlertTriangle, color: totalUnrouted ? 'text-amber-500' : 'text-slate-300' },
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

      {/* Cluster tabs + detail */}
      {runStatus === 'done' && clusterPlans.length > 0 && (
        <>
          {/* Tabs */}
          <div className="flex gap-1.5 flex-wrap">
            {clusterPlans.map(cp => (
              <button key={cp.cluster} onClick={() => setActiveCluster(cp.cluster)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors border ${
                  activeCluster === cp.cluster ? 'text-white border-transparent shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
                style={activeCluster === cp.cluster ? { backgroundColor: CLUSTER_COLOR[cp.cluster] ?? '#2563EB' } : {}}>
                {cp.cluster}
                <span className="ml-1.5 opacity-75 font-normal">
                  {cp.plans.reduce((s, p) => s + p.stops.length, 0)} visits
                </span>
                {cp.error && <span className="ml-1 text-red-200">⚠</span>}
              </button>
            ))}
          </div>

          {/* Active cluster */}
          {activeplan && (
            <div className="space-y-3">
              {/* Cluster sub-header */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CLUSTER_COLOR[activeplan.cluster] ?? '#2563EB' }} />
                  <span className="text-sm font-bold text-slate-800">{activeplan.cluster}</span>
                  <span className="text-[11px] text-slate-400">
                    {activeplan.plans.length} technicians · {activeplan.plans.reduce((s,p)=>s+p.stops.length,0)} visits
                    {activeplan.solveMs ? ` · solved in ${activeplan.solveMs}ms` : ''}
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

              {activeplan.error && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-700">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  VROOM error for {activeplan.cluster}: {activeplan.error}
                </div>
              )}

              {/* Tech cards */}
              {activeplan.plans.map((plan, pi) => {
                const expKey = `${activeplan.cluster}:${plan.technicianId}`;
                const isExp = expanded[expKey] ?? true;
                const color = CLUSTER_COLOR[activeplan.cluster] ?? '#2563EB';
                return (
                  <div key={plan.technicianId} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    <button className="w-full px-5 py-3 flex flex-wrap items-center justify-between gap-3 bg-slate-50 border-b border-slate-100 hover:bg-slate-100/70 transition-colors"
                      onClick={() => setExpanded(e => ({ ...e, [expKey]: !isExp }))}>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 text-white" style={{ backgroundColor: color }}>
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
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{Math.floor(plan.totalEstimatedMins/60)}h {plan.totalEstimatedMins%60}m</span>
                        {isExp ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
                      </div>
                    </button>

                    {isExp && (
                      <div className="divide-y divide-slate-50">
                        {plan.stops.map((stop, si) => {
                          const pri = PRI[stop.priority] ?? PRI.LOW;
                          return (
                            <div key={`${stop.ticketId}-${si}`} className="px-5 py-3 flex flex-wrap items-start gap-4 hover:bg-slate-50/60">
                              <div className="flex flex-col items-center gap-1 shrink-0 pt-0.5">
                                <div className="w-6 h-6 rounded-full bg-slate-800 text-white flex items-center justify-center text-[11px] font-bold">{stop.stopOrder}</div>
                                {si < plan.stops.length - 1 && <div className="w-px h-4 bg-slate-200" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-2 mb-0.5">
                                  <span className="font-bold text-slate-800 text-sm">{stop.ticketId}</span>
                                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${pri.badge}`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${pri.dot}`} />{stop.priority}
                                  </span>
                                  <span className="text-xs text-slate-400 flex items-center gap-1"><Truck className="w-3 h-3" />{stop.vehicleNumber}</span>
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
                    <span className="font-normal text-amber-500">(capacity full or missing center coordinates)</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {activeplan.unrouted.map(t => (
                      <span key={t.ticketId} className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded text-[10px] font-mono font-semibold">{t.ticketId}</span>
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
function buildPrintHtml(plans: ClusterPlan[], date: string): string {
  const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const PC: Record<string, string> = { CRITICAL:'#dc2626', HIGH:'#ea580c', MEDIUM:'#ca8a04', LOW:'#94a3b8' };
  const PB: Record<string, string> = { CRITICAL:'#fef2f2', HIGH:'#fff7ed', MEDIUM:'#fefce8', LOW:'#f8fafc' };

  const sections = plans.map(cp => {
    const cards = cp.plans.map(plan => {
      const rows = !plan.stops.length
        ? `<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:12px;font-size:11px;">No visits assigned</td></tr>`
        : plan.stops.map(s => `<tr>
            <td style="padding:5px 7px;border:1px solid #e2e8f0;text-align:center;font-weight:700;">${s.stopOrder}</td>
            <td style="padding:5px 7px;border:1px solid #e2e8f0;font-weight:700;">${s.ticketId}</td>
            <td style="padding:5px 7px;border:1px solid #e2e8f0;">${s.vehicleNumber}</td>
            <td style="padding:5px 7px;border:1px solid #e2e8f0;">${s.centerName}</td>
            <td style="padding:5px 7px;border:1px solid #e2e8f0;">${s.issue}</td>
            <td style="padding:5px 7px;border:1px solid #e2e8f0;text-align:center;">
              <span style="padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;background:${PB[s.priority]??'#f8fafc'};color:${PC[s.priority]??'#94a3b8'};">${s.priority}</span>
            </td>
            <td style="padding:5px 7px;border:1px solid #e2e8f0;text-align:center;font-weight:600;">${s.estimatedArrival}</td>
            <td style="padding:5px 7px;border:1px solid #e2e8f0;text-align:center;">${s.estimatedDurationMins}m</td>
          </tr>`).join('');
      return `<div class="card">
        <div class="ch">
          <div class="av" style="background:${CLUSTER_COLOR[cp.cluster]??'#1e40af'}">${plan.technicianName.charAt(0)}</div>
          <div><div style="font-weight:800;font-size:13px;">${plan.technicianName}</div><div style="font-size:10px;color:#94a3b8;">${plan.employeeId}</div></div>
          <div class="st"><span>${plan.stops.length} stops</span><span>${plan.totalDistanceKm} km</span><span>${Math.floor(plan.totalEstimatedMins/60)}h ${plan.totalEstimatedMins%60}m</span></div>
        </div>
        <table><thead><tr><th style="width:24px">#</th><th>Ticket</th><th>Vehicle</th><th>Center</th><th>Issue</th><th>Priority</th><th>ETA</th><th>Dur.</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="sig"><span>Technician Signature: _________________________</span><span>Supervisor Sign-off: _________________________</span></div>
      </div>`;
    }).join('');
    const unr = cp.unrouted.length ? `<div class="unr">⚠ Unrouted: ${cp.unrouted.map(t=>t.ticketId).join(', ')}</div>` : '';
    return `<div class="city-section">
      <div class="city-hdr" style="border-color:${CLUSTER_COLOR[cp.cluster]??'#334155'}">${cp.cluster} — ${cp.plans.reduce((s,p)=>s+p.stops.length,0)} visits · ${cp.plans.length} technicians</div>
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
.city-hdr{font-size:15px;font-weight:800;color:#1e293b;padding:6px 0 6px 8px;border-left:4px solid #334155;margin-bottom:12px}
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
${sections}</body></html>`;
}
