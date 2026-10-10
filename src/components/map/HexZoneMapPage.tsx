/**
 * HexZoneMapPage — hexagonal cluster dispatch view for Delhi NCR
 *
 * Enhanced features:
 *   • 12 vehicle-density clusters (k-means on hex centroids weighted by vehicle count)
 *   • One technician auto-assigned per cluster (zone/specialisation match)
 *   • Spare vehicle hub placed for every 20 vehicles in cluster (diamond marker ◆)
 *   • All original layers: open-ticket hexes, DC markers, tech base dots
 *   • Tech route overlay: colored polylines + numbered stop markers per technician
 *   • Click hex/DC → side panel with bulk assign, per-ticket ignore/reassign, route tab
 *   • Hide clear DCs toggle: filter DC markers with 0 open tickets
 *   • Route Planner drawer: inline balanced route planning without leaving the map
 */
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as L from 'leaflet';
import {
  getCenters, getTechnicians, getTickets, saveTickets,
  getRoutePlans, saveRoutePlans,
  subscribeToDataChanges,
  getIgnoredTicketIds, setTicketsIgnored,
  getClusterRoster, saveClusterRoster,
} from '../../services/storage';
import { planBalancedRoutes, BalancedPlanConstraints, BalancedPlanResult } from '../../services/routeOptimizer';
import { Ticket, Technician, Center, TechnicianRoutePlan, RouteStop } from '../../types';
import {
  Users, Zap, CheckCircle2, X, MapPin, AlertTriangle,
  EyeOff, RefreshCw, Filter, Layers, Diamond, UserCheck, Edit2, Navigation,
  Compass, GripVertical, ArrowRight, MessageCircle, Settings2,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────
type MapLayer = 'openTickets' | 'ignoredTickets' | 'techBases' | 'clusters' | 'spareHubs' | 'techRoutes';

// ─── Hex grid parameters ─────────────────────────────────────────────────────
const BBOX = { minLat: 28.28, maxLat: 28.85, minLng: 76.80, maxLng: 77.58 };
const HEX_R_LAT = 0.055;
const HEX_R_LNG = 0.075;
const NUM_CLUSTERS = 12;

// ─── Cluster palette ──────────────────────────────────────────────────────────
const CLUSTER_COLORS = [
  '#e11d48','#7c3aed','#2563eb','#059669','#d97706','#0891b2',
  '#9333ea','#16a34a','#dc2626','#0d9488','#b45309','#6366f1',
];

// ─── Priority colours ─────────────────────────────────────────────────────────
const PRIORITY_COLOR: Record<string, string> = {
  CRITICAL: '#dc2626', HIGH: '#ea580c', MEDIUM: '#ca8a04', LOW: '#16a34a',
};

// ─── Ignored-ticket store (shared with Active Cases; synced to the database) ──
function getIgnored(): Set<string> { return getIgnoredTicketIds(); }
function setIgnored(next: Set<string>) {
  const current = getIgnoredTicketIds();
  const add = [...next].filter(id => !current.has(id));
  const remove = [...current].filter(id => !next.has(id));
  if (add.length) setTicketsIgnored(add, true);
  if (remove.length) setTicketsIgnored(remove, false);
}

// ─── Hex geometry ─────────────────────────────────────────────────────────────
function hexCorners(cLat: number, cLng: number): [number, number][] {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i);
    return [cLat + HEX_R_LAT * Math.sin(a), cLng + HEX_R_LNG * Math.cos(a)] as [number, number];
  });
}
function isInsideHex(pLat: number, pLng: number, cLat: number, cLng: number): boolean {
  const q = (pLng - cLng) / HEX_R_LNG;
  const r = (pLat - cLat) / HEX_R_LAT;
  return Math.max(Math.abs(q), Math.abs(r + q / 2), Math.abs(r - q / 2)) <= 1.0;
}

interface HexCell {
  key: string; col: number; row: number; cLat: number; cLng: number;
  tickets: Ticket[]; centers: Center[]; techs: Technician[];
  vehicleCount: number; // unique vehicle numbers
  clusterId: number;
}

interface Cluster {
  id: number;
  cells: HexCell[];
  centLat: number; centLng: number;
  vehicleCount: number;
  assignedTech: Technician | null;
  spareHubs: { lat: number; lng: number; hubIndex: number }[];
  color: string;
}

const coordCache = new Map<string, { lat: number; lng: number } | null>();
function centerCoords(name: string, centers: Center[]) {
  if (coordCache.has(name)) return coordCache.get(name)!;
  const n = name.toLowerCase().trim();
  const c = centers.find(c => c.name.toLowerCase().trim() === n || c.normalizedName === n);
  const r = c ? { lat: c.latitude, lng: c.longitude } : null;
  coordCache.set(name, r); return r;
}

function buildGrid(tickets: Ticket[], centers: Center[], techs: Technician[]): HexCell[] {
  const stepLng = HEX_R_LNG * 1.5;
  const stepLat = HEX_R_LAT * Math.sqrt(3);
  const cols = Math.ceil((BBOX.maxLng - BBOX.minLng) / stepLng) + 1;
  const rows = Math.ceil((BBOX.maxLat - BBOX.minLat) / stepLat) + 1;
  const cells: HexCell[] = [];
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      const cLng = BBOX.minLng + col * stepLng;
      const cLat = BBOX.minLat + row * stepLat + (col % 2) * (stepLat / 2);
      if (cLat > BBOX.maxLat + HEX_R_LAT) continue;
      const cellTickets = tickets.filter(t => {
        const c = centerCoords(t.centerName, centers);
        return c && isInsideHex(c.lat, c.lng, cLat, cLng);
      });
      const vehicles = new Set(cellTickets.map(t => t.vehicleNumber).filter(Boolean));
      cells.push({
        key: `${col}-${row}`, col, row, cLat, cLng,
        tickets: cellTickets,
        centers: centers.filter(c => isInsideHex(c.latitude, c.longitude, cLat, cLng)),
        techs: techs.filter(t => t.startingLatitude && t.startingLongitude && isInsideHex(t.startingLatitude, t.startingLongitude, cLat, cLng)),
        vehicleCount: vehicles.size,
        clusterId: -1,
      });
    }
  }
  return cells;
}

// ─── K-means clustering (weighted by vehicle density) ─────────────────────────
function kMeansClusters(cells: HexCell[], k: number): number[] {
  const activeCells = cells.filter(c => c.vehicleCount > 0 || c.tickets.length > 0 || c.centers.length > 0);
  if (activeCells.length === 0) return cells.map(() => 0);

  // Seed centroids: spread evenly across bounding box
  const lats = activeCells.map(c => c.cLat);
  const lngs = activeCells.map(c => c.cLng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);

  let centroids: { lat: number; lng: number }[] = Array.from({ length: k }, (_, i) => ({
    lat: minLat + (maxLat - minLat) * (i % 4) / 3,
    lng: minLng + (maxLng - minLng) * Math.floor(i / 4) / (Math.ceil(k / 4) - 1 || 1),
  }));

  // Nudge apart any exact duplicates
  centroids = centroids.map((c, i) => ({ lat: c.lat + i * 0.0001, lng: c.lng + i * 0.0001 }));

  const assignments = new Array(cells.length).fill(0);
  let changed = true;
  let iters = 0;

  while (changed && iters < 30) {
    changed = false; iters++;
    // Assign each active cell to nearest centroid (weight: vehicle count + 1)
    cells.forEach((cell, idx) => {
      let best = 0, bestDist = Infinity;
      centroids.forEach((c, ci) => {
        const d = Math.pow(cell.cLat - c.lat, 2) + Math.pow(cell.cLng - c.lng, 2);
        if (d < bestDist) { bestDist = d; best = ci; }
      });
      if (assignments[idx] !== best) { assignments[idx] = best; changed = true; }
    });
    // Recompute centroids (weighted by vehicleCount)
    centroids = centroids.map((_, ci) => {
      const members = cells.filter((_, idx) => assignments[idx] === ci);
      if (members.length === 0) return centroids[ci];
      const totalW = members.reduce((s, c) => s + c.vehicleCount + 1, 0);
      return {
        lat: members.reduce((s, c) => s + c.cLat * (c.vehicleCount + 1), 0) / totalW,
        lng: members.reduce((s, c) => s + c.cLng * (c.vehicleCount + 1), 0) / totalW,
      };
    });
  }
  return assignments;
}

// ─── Build cluster objects ─────────────────────────────────────────────────────
function buildClusters(cells: HexCell[], techs: Technician[]): Cluster[] {
  const activeTechs = techs.filter(t => t.status === 'Active');
  const usedTechIds = new Set<string>();
  const clusters: Cluster[] = [];

  for (let ci = 0; ci < NUM_CLUSTERS; ci++) {
    const members = cells.filter(c => c.clusterId === ci);
    if (members.length === 0) continue;

    // Weighted centroid
    const totalV = members.reduce((s, c) => s + c.vehicleCount + 1, 0);
    const centLat = members.reduce((s, c) => s + c.cLat * (c.vehicleCount + 1), 0) / totalV;
    const centLng = members.reduce((s, c) => s + c.cLng * (c.vehicleCount + 1), 0) / totalV;
    const vehicleCount = members.reduce((s, c) => s + c.vehicleCount, 0);

    // Assign nearest available technician (prefer same zone/city)
    let assignedTech: Technician | null = null;
    const dominantCity = members.flatMap(c => c.centers).map(c => c.city || '').filter(Boolean);
    const cityFreq: Record<string, number> = {};
    dominantCity.forEach(c => { cityFreq[c] = (cityFreq[c] || 0) + 1; });
    const topCity = Object.entries(cityFreq).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

    // Score techs: prefer zone match, then nearest
    const scored = activeTechs
      .filter(t => !usedTechIds.has(t.id))
      .map(t => {
        const zoneMatch = (t.zone || t.city || '').toLowerCase().includes(topCity.toLowerCase()) ? -1000 : 0;
        const lat = t.startingLatitude || 28.58;
        const lng = t.startingLongitude || 77.22;
        const dist = Math.pow(lat - centLat, 2) + Math.pow(lng - centLng, 2);
        return { tech: t, score: zoneMatch + dist };
      })
      .sort((a, b) => a.score - b.score);

    if (scored.length > 0) {
      assignedTech = scored[0].tech;
      usedTechIds.add(assignedTech.id);
    }

    // Spare vehicle hubs: 1 hub per 20 vehicles, placed at cell centers sorted by density
    const hubCount = Math.max(1, Math.floor(vehicleCount / 20));
    const sortedByDensity = [...members].sort((a, b) => b.vehicleCount - a.vehicleCount);
    const spareHubs = Array.from({ length: hubCount }, (_, hi) => {
      const hostCell = sortedByDensity[hi % sortedByDensity.length];
      // Offset slightly so it doesn't overlap DC markers
      const offsetLat = hostCell.cLat + HEX_R_LAT * 0.35 * Math.cos((hi * 2.1));
      const offsetLng = hostCell.cLng + HEX_R_LNG * 0.35 * Math.sin((hi * 2.1));
      return { lat: offsetLat, lng: offsetLng, hubIndex: hi + 1 };
    });

    clusters.push({
      id: ci, cells: members, centLat, centLng,
      vehicleCount, assignedTech, spareHubs,
      color: CLUSTER_COLORS[ci % CLUSTER_COLORS.length],
    });
  }
  return clusters;
}

function hexFill(tickets: Ticket[], ignored: Set<string>): string {
  const active = tickets.filter(t => !ignored.has(t.id) && t.status !== 'Resolved' && t.status !== 'Closed');
  if (!active.length) return 'transparent';
  if (active.some(t => t.priority === 'CRITICAL')) return '#dc2626';
  if (active.some(t => t.priority === 'HIGH')) return '#ea580c';
  if (active.length >= 3) return '#ca8a04';
  return '#3b82f6';
}
function hexOpacity(tickets: Ticket[], ignored: Set<string>): number {
  const n = tickets.filter(t => !ignored.has(t.id) && t.status !== 'Resolved' && t.status !== 'Closed').length;
  return n === 0 ? 0 : Math.min(0.15 + n * 0.1, 0.75);
}

// ─── Stop order recalc helper ─────────────────────────────────────────────────
function recalcStopOrders(stops: RouteStop[]): RouteStop[] {
  return stops.map((s, i) => ({ ...s, stopOrder: i + 1 }));
}

// ─── Side panel ───────────────────────────────────────────────────────────────
interface PanelProps {
  cell: HexCell;
  cluster: Cluster | null;
  allTechs: Technician[];
  allTickets: Ticket[];
  ignored: Set<string>;
  routePlans: TechnicianRoutePlan[];
  onIgnore: (id: string) => void;
  onUnignore: (id: string) => void;
  onReassign: (ticketId: string, techId: string) => void;
  onBulkAssign: (techId: string) => void;
  onEditTicket: (ticketId: string, priority: string, issue: string) => void;
  onRemoveRouteStop: (techId: string, ticketId: string) => void;
  onMoveRouteStop: (fromTechId: string, ticketId: string, toTechId: string) => void;
  onClose: () => void;
}

function ZonePanel({ cell, cluster, allTechs, allTickets, ignored, routePlans, onIgnore, onUnignore, onReassign, onBulkAssign, onEditTicket, onRemoveRouteStop, onMoveRouteStop, onClose }: PanelProps) {
  const [bulkTech, setBulkTech] = useState('');
  const [reassignTarget, setReassignTarget] = useState<string | null>(null);
  const [reassignTech, setReassignTech] = useState('');
  const [tab, setTab] = useState<'open' | 'ignored' | 'route'>('open');
  const [editingTicket, setEditingTicket] = useState<{ id: string; priority: string; issue: string } | null>(null);
  const [moveTarget, setMoveTarget] = useState<{ techId: string; ticketId: string } | null>(null);
  const [moveTechId, setMoveTechId] = useState('');

  const activeTechs = allTechs.filter(t => t.status === 'Active');

  // Compute open ticket count per tech across all tickets
  const openTicketCountByTech = useMemo(() => {
    const counts: Record<string, number> = {};
    allTickets.forEach(t => {
      if (t.assignedTechnicianId && t.status !== 'Resolved' && t.status !== 'Closed') {
        counts[t.assignedTechnicianId] = (counts[t.assignedTechnicianId] || 0) + 1;
      }
    });
    return counts;
  }, [allTickets]);
  const openTickets = cell.tickets.filter(t => !ignored.has(t.id) && t.status !== 'Resolved' && t.status !== 'Closed');
  const ignoredInCell = cell.tickets.filter(t => ignored.has(t.id));

  // Route stops in this cell
  const routeStopsInCell = useMemo(() => {
    const result: { plan: TechnicianRoutePlan; stop: RouteStop }[] = [];
    routePlans.forEach(plan => {
      plan.stops.forEach(stop => {
        if (isInsideHex(stop.latitude, stop.longitude, cell.cLat, cell.cLng)) {
          result.push({ plan, stop });
        }
      });
    });
    return result;
  }, [routePlans, cell]);

  return (
    <div className="absolute top-3 right-3 z-[1000] w-84 bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden flex flex-col" style={{ maxHeight: 'calc(100% - 24px)', width: '22rem' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 text-white shrink-0" style={{ background: cluster ? cluster.color : '#0f172a' }}>
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-white/80" />
          <div>
            <div className="font-semibold text-sm">
              Zone {cell.key} {cluster ? `· Cluster ${cluster.id + 1}` : ''}
            </div>
            <div className="text-[10px] text-white/70 truncate">
              {cell.centers.map(c => c.name.replace(/_D$/, '')).join(' · ') || 'No center'}
            </div>
          </div>
        </div>
        <button onClick={onClose} className="text-white/70 hover:text-white shrink-0"><X className="w-4 h-4" /></button>
      </div>

      {/* Cluster tech badge */}
      {cluster?.assignedTech && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 bg-slate-50 shrink-0">
          <UserCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <div className="text-[11px]">
            <span className="font-semibold text-slate-700">{cluster.assignedTech.name}</span>
            <span className="text-slate-400"> · Cluster tech · {cluster.assignedTech.zone || cluster.assignedTech.city}</span>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100 shrink-0">
        {[
          { label: 'Open', val: openTickets.length, color: 'text-blue-700' },
          { label: 'Ignored', val: ignoredInCell.length, color: 'text-slate-500' },
          { label: 'Techs', val: cell.techs.length, color: 'text-emerald-700' },
        ].map(s => (
          <div key={s.label} className="text-center py-2.5">
            <div className={`text-xl font-bold ${s.color}`}>{s.val}</div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wide">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-100 shrink-0">
        <button onClick={() => setTab('open')}
          className={`flex-1 py-2 text-xs font-semibold transition-colors ${tab === 'open' ? 'border-b-2 border-blue-600 text-blue-700 bg-blue-50' : 'text-slate-500 hover:text-slate-700'}`}>
          Open ({openTickets.length})
        </button>
        <button onClick={() => setTab('ignored')}
          className={`flex-1 py-2 text-xs font-semibold transition-colors ${tab === 'ignored' ? 'border-b-2 border-blue-600 text-blue-700 bg-blue-50' : 'text-slate-500 hover:text-slate-700'}`}>
          Ignored ({ignoredInCell.length})
        </button>
        <button onClick={() => setTab('route')}
          className={`flex-1 py-2 text-xs font-semibold transition-colors flex items-center justify-center gap-1 ${tab === 'route' ? 'border-b-2 border-indigo-600 text-indigo-700 bg-indigo-50' : 'text-slate-500 hover:text-slate-700'}`}>
          <Navigation className="w-3 h-3" /> Route ({routeStopsInCell.length})
        </button>
      </div>

      {/* Ticket list */}
      <div className="overflow-y-auto flex-1 p-3 space-y-2">
        {tab === 'open' && (
          openTickets.length === 0
            ? <div className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-50 rounded-lg px-3 py-2.5"><CheckCircle2 className="w-4 h-4" />All clear in this zone</div>
            : openTickets.map(t => (
              <div key={t.id} className="border border-slate-200 rounded-lg bg-slate-50 overflow-hidden">
                <div className="flex items-center gap-2 px-2.5 py-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PRIORITY_COLOR[t.priority] ?? '#94a3b8' }} />
                  <span className="text-xs font-mono text-slate-700 shrink-0 font-semibold">{t.ticketId}</span>
                  <span className="text-xs text-slate-500 truncate flex-1">{t.vehicleNumber}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold text-white shrink-0" style={{ background: PRIORITY_COLOR[t.priority] ?? '#94a3b8' }}>{t.priority}</span>
                </div>
                <div className="px-2.5 pb-1.5 text-[11px] text-slate-500 truncate">{t.issue}</div>
                {t.assignedTechnicianName && (
                  <div className="px-2.5 pb-1.5 text-[11px] text-emerald-600 font-medium">✓ {t.assignedTechnicianName}</div>
                )}
                <div className="flex border-t border-slate-100">
                  <button onClick={() => onIgnore(t.id)}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[11px] text-slate-500 hover:bg-slate-100 transition-colors font-medium">
                    <EyeOff className="w-3 h-3" /> Ignore
                  </button>
                  <div className="w-px bg-slate-100" />
                  <button onClick={() => { setReassignTarget(t.id); setReassignTech(t.assignedTechnicianId || ''); setEditingTicket(null); }}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[11px] text-blue-600 hover:bg-blue-50 transition-colors font-medium">
                    <RefreshCw className="w-3 h-3" /> Reassign
                  </button>
                  <div className="w-px bg-slate-100" />
                  <button onClick={() => { setEditingTicket(editingTicket?.id === t.id ? null : { id: t.id, priority: t.priority, issue: t.issue }); setReassignTarget(null); }}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[11px] text-amber-600 hover:bg-amber-50 transition-colors font-medium">
                    <Edit2 className="w-3 h-3" /> Edit
                  </button>
                </div>
                {reassignTarget === t.id && (
                  <div className="px-2.5 pb-2.5 pt-1 space-y-1.5 bg-blue-50 border-t border-blue-100">
                    <select value={reassignTech} onChange={e => setReassignTech(e.target.value)}
                      className="w-full text-xs border border-blue-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="">— Pick technician —</option>
                      {activeTechs.map(tech => {
                        const openCount = openTicketCountByTech[tech.id] || 0;
                        return (
                          <option key={tech.id} value={tech.id}>
                            {tech.name} · {tech.zone || tech.city} ({openCount} assigned){tech.id === t.assignedTechnicianId ? ' ✓ current' : ''}
                          </option>
                        );
                      })}
                    </select>
                    <div className="flex gap-1.5">
                      <button disabled={!reassignTech}
                        onClick={() => { onReassign(t.id, reassignTech); setReassignTarget(null); setReassignTech(''); }}
                        className="flex-1 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs rounded-lg font-semibold">Confirm</button>
                      <button onClick={() => setReassignTarget(null)} className="px-3 py-1 bg-white border border-slate-200 text-xs rounded-lg text-slate-600 hover:bg-slate-50">Cancel</button>
                    </div>
                  </div>
                )}
                {editingTicket?.id === t.id && (
                  <div className="px-2.5 pb-2.5 pt-1 space-y-1.5 bg-amber-50 border-t border-amber-100">
                    <div className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide">Edit Ticket</div>
                    <select
                      value={editingTicket.priority}
                      onChange={e => setEditingTicket({ ...editingTicket, priority: e.target.value })}
                      className="w-full text-xs border border-amber-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400">
                      {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(p => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={editingTicket.issue}
                      onChange={e => setEditingTicket({ ...editingTicket, issue: e.target.value })}
                      placeholder="Issue description"
                      className="w-full text-xs border border-amber-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => { onEditTicket(t.id, editingTicket.priority, editingTicket.issue); setEditingTicket(null); }}
                        className="flex-1 py-1 bg-amber-500 hover:bg-amber-600 text-white text-xs rounded-lg font-semibold">Save</button>
                      <button onClick={() => setEditingTicket(null)} className="px-3 py-1 bg-white border border-slate-200 text-xs rounded-lg text-slate-600 hover:bg-slate-50">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            ))
        )}
        {tab === 'ignored' && (
          ignoredInCell.length === 0
            ? <div className="text-xs text-slate-400 text-center py-4">No ignored tickets here</div>
            : ignoredInCell.map(t => (
              <div key={t.id} className="border border-slate-200 rounded-lg bg-slate-50 overflow-hidden opacity-70">
                <div className="flex items-center gap-2 px-2.5 py-2">
                  <EyeOff className="w-3 h-3 text-slate-400 shrink-0" />
                  <span className="text-xs font-mono text-slate-600 shrink-0">{t.ticketId}</span>
                  <span className="text-xs text-slate-400 truncate flex-1">{t.vehicleNumber}</span>
                </div>
                <div className="flex border-t border-slate-100">
                  <button onClick={() => onUnignore(t.id)}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[11px] text-blue-600 hover:bg-blue-50 transition-colors font-medium">
                    <RefreshCw className="w-3 h-3" /> Restore
                  </button>
                </div>
              </div>
            ))
        )}
        {tab === 'route' && (
          routeStopsInCell.length === 0
            ? <div className="text-xs text-slate-400 text-center py-4 flex flex-col items-center gap-2">
                <Navigation className="w-5 h-5 text-slate-300" />
                No route stops pass through this zone
              </div>
            : (() => {
                // Group by tech
                const byTech = new Map<string, { plan: TechnicianRoutePlan; stops: RouteStop[] }>();
                routeStopsInCell.forEach(({ plan, stop }) => {
                  if (!byTech.has(plan.technicianId)) {
                    byTech.set(plan.technicianId, { plan, stops: [] });
                  }
                  byTech.get(plan.technicianId)!.stops.push(stop);
                });
                return [...byTech.entries()].map(([techId, { plan, stops }], ti) => {
                  const color = CLUSTER_COLORS[ti % CLUSTER_COLORS.length];
                  return (
                    <div key={techId} className="border border-slate-200 rounded-lg overflow-hidden">
                      <div className="flex items-center gap-2 px-2.5 py-2 bg-slate-50 border-b border-slate-100">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                        <span className="text-xs font-semibold text-slate-700">{plan.technicianName}</span>
                        <span className="text-[10px] text-slate-400 ml-auto">{plan.employeeId}</span>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {stops.sort((a, b) => a.stopOrder - b.stopOrder).map(stop => (
                          <div key={stop.ticketId} className="px-2.5 py-2">
                            <div className="flex items-center gap-2">
                              <span className="w-5 h-5 rounded-full text-[10px] font-bold text-white flex items-center justify-center shrink-0" style={{ background: color }}>
                                {stop.stopOrder}
                              </span>
                              <span className="text-xs font-mono text-slate-700 font-semibold">{stop.ticketId}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold text-white shrink-0" style={{ background: PRIORITY_COLOR[stop.priority] ?? '#94a3b8' }}>{stop.priority}</span>
                            </div>
                            <div className="mt-1 text-[11px] text-slate-500 truncate pl-7">{stop.centerName.replace(/_D$/, '')}</div>
                            <div className="text-[10px] text-slate-400 pl-7">ETA: {stop.estimatedArrival}</div>
                            <div className="flex gap-1.5 mt-2 pl-7">
                              <button
                                onClick={() => onRemoveRouteStop(techId, stop.ticketId)}
                                className="flex items-center gap-1 px-2 py-1 text-[10px] text-red-600 bg-red-50 hover:bg-red-100 rounded font-semibold transition-colors">
                                <X className="w-3 h-3" /> Remove
                              </button>
                              <button
                                onClick={() => { setMoveTarget({ techId, ticketId: stop.ticketId }); setMoveTechId(''); }}
                                className="flex items-center gap-1 px-2 py-1 text-[10px] text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded font-semibold transition-colors">
                                <RefreshCw className="w-3 h-3" /> Reassign
                              </button>
                            </div>
                            {moveTarget?.techId === techId && moveTarget?.ticketId === stop.ticketId && (
                              <div className="mt-2 pl-7 space-y-1.5">
                                <select
                                  value={moveTechId}
                                  onChange={e => setMoveTechId(e.target.value)}
                                  className="w-full text-xs border border-indigo-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400">
                                  <option value="">— Move to tech —</option>
                                  {routePlans.filter(p => p.technicianId !== techId).map(p => (
                                    <option key={p.technicianId} value={p.technicianId}>
                                      {p.technicianName} ({p.stops.length} stops)
                                    </option>
                                  ))}
                                </select>
                                <div className="flex gap-1.5">
                                  <button
                                    disabled={!moveTechId}
                                    onClick={() => { onMoveRouteStop(techId, stop.ticketId, moveTechId); setMoveTarget(null); setMoveTechId(''); }}
                                    className="flex-1 py-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-xs rounded-lg font-semibold">
                                    Confirm
                                  </button>
                                  <button onClick={() => setMoveTarget(null)} className="px-3 py-1 bg-white border border-slate-200 text-xs rounded-lg text-slate-600 hover:bg-slate-50">Cancel</button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                });
              })()
        )}
      </div>

      {/* Bulk assign footer */}
      {openTickets.length > 0 && tab !== 'route' && (
        <div className="border-t border-slate-200 p-3 space-y-2 bg-slate-50 shrink-0">
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            Bulk assign all {openTickets.length} open tickets
          </div>
          <select value={bulkTech} onChange={e => setBulkTech(e.target.value)}
            className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">— Select technician —</option>
            {activeTechs.map(t => (
              <option key={t.id} value={t.id}>{t.name} · {t.specialisation} · {t.zone || t.city}</option>
            ))}
          </select>
          <button disabled={!bulkTech} onClick={() => { onBulkAssign(bulkTech); setBulkTech(''); }}
            className="w-full flex items-center justify-center gap-2 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg text-xs font-semibold">
            <Zap className="w-3.5 h-3.5" /> Assign to Zone
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Route Planner Drawer ─────────────────────────────────────────────────────
interface RoutePlannerDrawerProps {
  open: boolean;
  onClose: () => void;
  routePlans: TechnicianRoutePlan[];
  setRoutePlans: (plans: TechnicianRoutePlan[]) => void;
  tickets: Ticket[];
  ignored: Set<string>;
  onToast: (msg: string) => void;
}

function RoutePlannerDrawer({ open, onClose, routePlans, setRoutePlans, tickets, ignored, onToast }: RoutePlannerDrawerProps) {
  const [constraints, setConstraints] = useState<BalancedPlanConstraints>({
    maxStopsPerTech: 8,
    maxKmPerTech: 80,
    priorityFilter: 'all',
    skillMatch: false,
    shiftStartHour: 9,
    shiftEndHour: 18,
  });
  const [constraintsOpen, setConstraintsOpen] = useState(false);
  const [plannerResult, setPlannerResult] = useState<{ kmSaved: number; balanceScore: number; timeSavedMins: number; unrouted: number } | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [dragState, setDragState] = useState<{ techId: string; fromIdx: number } | null>(null);
  const [moveStopOpen, setMoveStopOpen] = useState<{ techId: string; ticketId: string } | null>(null);
  const [addStopOpen, setAddStopOpen] = useState<string | null>(null);

  const assignedTicketIds = useMemo(() => {
    const s = new Set<string>();
    routePlans.forEach(p => p.stops.forEach(st => s.add(st.ticketId)));
    return s;
  }, [routePlans]);

  const unassignedForPlanner = useMemo(() => tickets.filter(tk => {
    if (tk.status === 'Resolved' || tk.status === 'Closed') return false;
    if (ignored.has(tk.id)) return false;
    if (assignedTicketIds.has(tk.ticketId)) return false;
    return true;
  }), [tickets, assignedTicketIds, ignored]);

  function handleAutoPlan() {
    setIsPlanning(true);
    try {
      const result: BalancedPlanResult = planBalancedRoutes(constraints);
      setRoutePlans(result.plans);
      saveRoutePlans(result.plans);
      setPlannerResult({
        kmSaved: result.kmSaved,
        balanceScore: result.balanceScore,
        timeSavedMins: result.timeSavedMins,
        unrouted: result.unrouted.length,
      });
      onToast(`Route plan generated: ${result.plans.length} technicians, ${result.plans.reduce((s, p) => s + p.stops.length, 0)} stops`);
    } catch (e) {
      onToast('Planning failed — check console');
      console.error(e);
    } finally {
      setIsPlanning(false);
    }
  }

  function handleClear() {
    setRoutePlans([]);
    saveRoutePlans([]);
    setPlannerResult(null);
    onToast('Route plans cleared');
  }

  function handleSaveClose() {
    saveRoutePlans(routePlans);
    onToast('Routes saved');
    onClose();
  }

  function toggleCard(techId: string) {
    setExpandedCards(prev => {
      const s = new Set(prev);
      s.has(techId) ? s.delete(techId) : s.add(techId);
      return s;
    });
  }

  function removeStop(techId: string, ticketId: string) {
    const updated = routePlans.map(plan => {
      if (plan.technicianId !== techId) return plan;
      return { ...plan, stops: recalcStopOrders(plan.stops.filter(s => s.ticketId !== ticketId)) };
    });
    setRoutePlans(updated);
    saveRoutePlans(updated);
    onToast('Stop removed');
  }

  function moveStop(fromTechId: string, ticketId: string, toTechId: string) {
    let movedStop: RouteStop | undefined;
    const updated = routePlans.map(plan => {
      if (plan.technicianId === fromTechId) {
        movedStop = plan.stops.find(s => s.ticketId === ticketId);
        return { ...plan, stops: recalcStopOrders(plan.stops.filter(s => s.ticketId !== ticketId)) };
      }
      return plan;
    }).map(plan => {
      if (plan.technicianId === toTechId && movedStop) {
        return { ...plan, stops: recalcStopOrders([...plan.stops, { ...movedStop, stopOrder: plan.stops.length + 1 }]) };
      }
      return plan;
    });
    setRoutePlans(updated);
    saveRoutePlans(updated);
    setMoveStopOpen(null);
    onToast('Stop moved');
  }

  function addStop(techId: string, ticket: Ticket) {
    const updated = routePlans.map(plan => {
      if (plan.technicianId !== techId) return plan;
      const newStop: RouteStop = {
        stopOrder: plan.stops.length + 1,
        ticketId: ticket.ticketId,
        centerName: ticket.centerName,
        vehicleNumber: ticket.vehicleNumber,
        issue: ticket.issue,
        priority: ticket.priority,
        latitude: 0,
        longitude: 0,
        estimatedArrival: '--:--',
        estimatedDurationMins: ticket.priority === 'CRITICAL' ? 60 : 45,
      };
      return { ...plan, stops: [...plan.stops, newStop] };
    });
    setRoutePlans(updated);
    saveRoutePlans(updated);
    setAddStopOpen(null);
    onToast(`Added ${ticket.ticketId} to route`);
  }

  function toggleConfirm(techId: string) {
    const updated = routePlans.map(plan => {
      if (plan.technicianId !== techId) return plan;
      return { ...plan, status: (plan.status === 'Confirmed' ? 'Draft' : 'Confirmed') as TechnicianRoutePlan['status'] };
    });
    setRoutePlans(updated);
    saveRoutePlans(updated);
  }

  function handleWhatsApp(plan: TechnicianRoutePlan) {
    const lines = [
      `Route for ${plan.technicianName} (${plan.employeeId})`,
      `${plan.stops.length} stops · ${plan.totalDistanceKm}km`,
      '',
      ...plan.stops.sort((a, b) => a.stopOrder - b.stopOrder).map(s =>
        `${s.stopOrder}. ${s.centerName.replace(/_D$/, '')} — ${s.ticketId} [${s.priority}] ETA ${s.estimatedArrival}`
      ),
    ];
    const text = encodeURIComponent(lines.join('\n'));
    window.open(`https://wa.me/?text=${text}`, '_blank');
  }

  // Drag-to-reorder
  function handleDragStart(techId: string, fromIdx: number) {
    setDragState({ techId, fromIdx });
  }
  function handleDragOver(e: React.DragEvent, techId: string, toIdx: number) {
    e.preventDefault();
    if (!dragState || dragState.techId !== techId || dragState.fromIdx === toIdx) return;
    const updated = routePlans.map(plan => {
      if (plan.technicianId !== techId) return plan;
      const stops = [...plan.stops];
      const [moved] = stops.splice(dragState.fromIdx, 1);
      stops.splice(toIdx, 0, moved);
      return { ...plan, stops: recalcStopOrders(stops) };
    });
    setRoutePlans(updated);
    setDragState({ techId, fromIdx: toIdx });
  }
  function handleDrop() {
    if (dragState) {
      saveRoutePlans(routePlans);
    }
    setDragState(null);
  }

  const totalStops = routePlans.reduce((s, p) => s + p.stops.length, 0);

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-[1999] bg-black/20 backdrop-blur-[1px]"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div
        className={`fixed inset-y-0 right-0 z-[2000] w-full sm:w-[480px] bg-white shadow-2xl flex flex-col transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-900 text-white shrink-0">
          <div className="flex items-center gap-2">
            <Compass className="w-5 h-5 text-blue-400" />
            <div>
              <div className="font-bold text-sm tracking-tight">ROUTE PLANNER</div>
              <div className="text-[10px] text-slate-400">
                {routePlans.length} techs · {totalStops} stops planned
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Section 1: Constraints */}
        <div className="border-b border-slate-100 shrink-0">
          <button
            onClick={() => setConstraintsOpen(v => !v)}
            className="w-full flex items-center gap-2 px-5 py-3 hover:bg-slate-50 transition-colors text-left"
          >
            <Settings2 className="w-4 h-4 text-slate-500" />
            <span className="text-xs font-semibold text-slate-700 flex-1">Constraints</span>
            <span className="text-[10px] text-slate-400">
              {constraints.maxStopsPerTech} stops · {constraints.maxKmPerTech}km · {constraints.shiftStartHour}–{constraints.shiftEndHour}h
            </span>
            <span className="text-slate-400 text-xs">{constraintsOpen ? '▲' : '▼'}</span>
          </button>

          {constraintsOpen && (
            <div className="px-5 pb-4 space-y-3 bg-slate-50 border-t border-slate-100">
              {/* Max stops */}
              <div className="flex items-center gap-3">
                <label className="text-[11px] font-semibold text-slate-600 w-28 shrink-0">Max stops/tech</label>
                <input
                  type="range" min={1} max={15} value={constraints.maxStopsPerTech}
                  onChange={e => setConstraints(c => ({ ...c, maxStopsPerTech: Number(e.target.value) }))}
                  className="flex-1 accent-blue-600"
                />
                <span className="text-xs font-bold text-slate-700 w-6 text-right">{constraints.maxStopsPerTech}</span>
              </div>

              {/* Max km */}
              <div className="flex items-center gap-3">
                <label className="text-[11px] font-semibold text-slate-600 w-28 shrink-0">Max km/tech</label>
                <input
                  type="range" min={10} max={100} value={constraints.maxKmPerTech}
                  onChange={e => setConstraints(c => ({ ...c, maxKmPerTech: Number(e.target.value) }))}
                  className="flex-1 accent-blue-600"
                />
                <span className="text-xs font-bold text-slate-700 w-8 text-right">{constraints.maxKmPerTech}km</span>
              </div>

              {/* Shift hours */}
              <div className="flex items-center gap-3">
                <label className="text-[11px] font-semibold text-slate-600 w-28 shrink-0">Shift hours</label>
                <div className="flex items-center gap-2 flex-1">
                  <select
                    value={constraints.shiftStartHour}
                    onChange={e => setConstraints(c => ({ ...c, shiftStartHour: Number(e.target.value) }))}
                    className="text-xs border border-slate-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {Array.from({ length: 5 }, (_, i) => i + 7).map(h => (
                      <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                    ))}
                  </select>
                  <span className="text-xs text-slate-400">to</span>
                  <select
                    value={constraints.shiftEndHour}
                    onChange={e => setConstraints(c => ({ ...c, shiftEndHour: Number(e.target.value) }))}
                    className="text-xs border border-slate-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {Array.from({ length: 6 }, (_, i) => i + 15).map(h => (
                      <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Skill match + priority filter */}
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={constraints.skillMatch}
                    onChange={e => setConstraints(c => ({ ...c, skillMatch: e.target.checked }))}
                    className="accent-blue-600"
                  />
                  <span className="text-[11px] font-semibold text-slate-600">Skill match</span>
                </label>
                <div className="flex items-center gap-1">
                  <span className="text-[11px] font-semibold text-slate-600 mr-1">Priority:</span>
                  {(['all', 'critical_high'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setConstraints(c => ({ ...c, priorityFilter: f }))}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-all ${constraints.priorityFilter === f ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                    >
                      {f === 'all' ? 'ALL' : 'CRITICAL+HIGH'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Reset */}
              <button
                onClick={() => setConstraints({ maxStopsPerTech: 8, maxKmPerTech: 60, priorityFilter: 'all', skillMatch: true, shiftStartHour: 9, shiftEndHour: 18 })}
                className="text-[11px] text-blue-600 hover:underline"
              >
                Reset to defaults
              </button>
            </div>
          )}
        </div>

        {/* Section 2: Action bar */}
        <div className="px-5 py-3 border-b border-slate-100 shrink-0 space-y-2">
          <div className="flex gap-2">
            <button
              onClick={handleAutoPlan}
              disabled={isPlanning}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors"
            >
              <Compass className="w-3.5 h-3.5" />
              {isPlanning ? 'PLANNING...' : 'AUTO-PLAN'}
            </button>
            <button
              onClick={handleClear}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors"
            >
              <X className="w-3.5 h-3.5" /> CLEAR
            </button>
            <button
              onClick={handleSaveClose}
              className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition-colors ml-auto"
            >
              <CheckCircle2 className="w-3.5 h-3.5" /> SAVE &amp; CLOSE
            </button>
          </div>

          {/* Inline stats */}
          {plannerResult && (
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              <span className="font-bold text-emerald-700">{totalStops} stops</span>
              <span className="text-slate-400">·</span>
              <span>{routePlans.length} techs</span>
              <span className="text-slate-400">·</span>
              <span>Balance: <strong className="text-blue-700">{plannerResult.balanceScore}</strong></span>
              <span className="text-slate-400">·</span>
              <span className="text-emerald-700 font-semibold">{plannerResult.kmSaved}km saved</span>
              {plannerResult.unrouted > 0 && (
                <>
                  <span className="text-slate-400">·</span>
                  <span className="text-amber-600">{plannerResult.unrouted} unrouted</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Section 3: Tech route cards */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {routePlans.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center text-slate-400">
              <Compass className="w-10 h-10 mb-3 text-slate-200" />
              <div className="text-sm font-semibold text-slate-500">No routes planned yet</div>
              <div className="text-xs mt-1">Click AUTO-PLAN to generate balanced routes</div>
            </div>
          )}

          {routePlans.map((plan, planIdx) => {
            const color = CLUSTER_COLORS[planIdx % CLUSTER_COLORS.length];
            const isExpanded = expandedCards.has(plan.technicianId);
            const isConfirmed = plan.status === 'Confirmed';

            return (
              <div key={plan.technicianId} className={`border rounded-xl overflow-hidden ${isConfirmed ? 'border-emerald-300 bg-emerald-50/30' : 'border-slate-200 bg-white'}`}>
                {/* Card header */}
                <button
                  onClick={() => toggleCard(plan.technicianId)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left"
                >
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: color }} />
                  <span className="text-xs font-bold text-slate-800 flex-1 truncate">{plan.technicianName}</span>
                  <span className="text-[10px] text-slate-400 font-mono">{plan.employeeId}</span>
                  <span className="text-[10px] text-slate-500 bg-slate-100 rounded px-1.5 py-0.5 shrink-0">
                    {plan.stops.length} stops · {plan.totalDistanceKm}km
                  </span>
                  {isConfirmed && (
                    <span className="text-[10px] text-white bg-emerald-600 rounded px-1.5 py-0.5 font-bold shrink-0">CONFIRMED</span>
                  )}
                  {!isConfirmed && plan.stops.length > 0 && (
                    <span className="text-[10px] text-slate-500 bg-slate-200 rounded px-1.5 py-0.5 shrink-0">DRAFT</span>
                  )}
                  <span className="text-slate-400 text-xs shrink-0">{isExpanded ? '▲' : '▼'}</span>
                </button>

                {/* Expanded stop list */}
                {isExpanded && (
                  <div className="border-t border-slate-100">
                    <div className="divide-y divide-slate-100">
                      {plan.stops.sort((a, b) => a.stopOrder - b.stopOrder).map((stop, idx) => (
                        <div
                          key={stop.ticketId}
                          draggable
                          onDragStart={() => handleDragStart(plan.technicianId, idx)}
                          onDragOver={e => handleDragOver(e, plan.technicianId, idx)}
                          onDrop={handleDrop}
                          className={`flex items-start gap-2 px-3 py-2 transition-colors ${dragState?.techId === plan.technicianId && dragState.fromIdx === idx ? 'bg-blue-50 opacity-60' : 'hover:bg-slate-50'}`}
                        >
                          {/* Drag handle */}
                          <div className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 pt-0.5 shrink-0">
                            <GripVertical className="w-3.5 h-3.5" />
                          </div>

                          {/* Stop number */}
                          <span className="w-5 h-5 rounded-full text-[10px] font-bold text-white flex items-center justify-center shrink-0 mt-0.5" style={{ background: color }}>
                            {stop.stopOrder}
                          </span>

                          {/* Stop info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[11px] font-mono font-bold text-slate-700">{stop.ticketId}</span>
                              <span className="text-[10px] px-1 py-0.5 rounded font-bold text-white shrink-0" style={{ background: PRIORITY_COLOR[stop.priority] ?? '#94a3b8' }}>{stop.priority}</span>
                              <span className="text-[10px] text-slate-400">ETA {stop.estimatedArrival}</span>
                            </div>
                            <div className="text-[11px] text-slate-500 truncate mt-0.5">{stop.centerName.replace(/_D$/, '')}</div>

                            {/* Actions */}
                            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                              <button
                                onClick={() => removeStop(plan.technicianId, stop.ticketId)}
                                className="flex items-center gap-0.5 px-2 py-0.5 text-[10px] text-red-600 bg-red-50 hover:bg-red-100 rounded font-semibold transition-colors"
                              >
                                <X className="w-3 h-3" /> Remove
                              </button>
                              <button
                                onClick={() => setMoveStopOpen(
                                  moveStopOpen?.techId === plan.technicianId && moveStopOpen.ticketId === stop.ticketId
                                    ? null
                                    : { techId: plan.technicianId, ticketId: stop.ticketId }
                                )}
                                className="flex items-center gap-0.5 px-2 py-0.5 text-[10px] text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded font-semibold transition-colors"
                              >
                                <ArrowRight className="w-3 h-3" /> Move
                              </button>
                            </div>

                            {/* Move inline select */}
                            {moveStopOpen?.techId === plan.technicianId && moveStopOpen.ticketId === stop.ticketId && (
                              <div className="mt-2 flex gap-1.5">
                                <select
                                  defaultValue=""
                                  onChange={e => { if (e.target.value) moveStop(plan.technicianId, stop.ticketId, e.target.value); }}
                                  className="flex-1 text-xs border border-indigo-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
                                >
                                  <option value="">— Move to tech —</option>
                                  {routePlans.filter(p => p.technicianId !== plan.technicianId).map(p => (
                                    <option key={p.technicianId} value={p.technicianId}>
                                      {p.technicianName} ({p.stops.length} stops)
                                    </option>
                                  ))}
                                </select>
                                <button onClick={() => setMoveStopOpen(null)} className="px-2 py-1 bg-white border border-slate-200 rounded text-xs text-slate-500">✕</button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Add stop */}
                    <div className="border-t border-slate-100 px-3 py-2">
                      {addStopOpen === plan.technicianId ? (
                        <div className="flex gap-1.5">
                          <select
                            defaultValue=""
                            onChange={e => {
                              const ticket = unassignedForPlanner.find(t => t.id === e.target.value);
                              if (ticket) addStop(plan.technicianId, ticket);
                            }}
                            className="flex-1 text-xs border border-slate-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                          >
                            <option value="">— Pick unassigned ticket —</option>
                            {unassignedForPlanner.map(t => (
                              <option key={t.id} value={t.id}>
                                {t.ticketId} · {t.priority} · {t.centerName.replace(/_D$/, '')}
                              </option>
                            ))}
                          </select>
                          <button onClick={() => setAddStopOpen(null)} className="px-2 py-1 bg-white border border-slate-200 rounded text-xs text-slate-500">✕</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setAddStopOpen(plan.technicianId)}
                          className="text-[11px] text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1"
                        >
                          + Add stop {unassignedForPlanner.length > 0 && `(${unassignedForPlanner.length} available)`}
                        </button>
                      )}
                    </div>

                    {/* Card footer */}
                    <div className="border-t border-slate-100 px-3 py-2 flex items-center gap-2 bg-slate-50">
                      <button
                        onClick={() => toggleConfirm(plan.technicianId)}
                        className={`flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold rounded-lg transition-colors ${isConfirmed ? 'bg-slate-200 text-slate-700 hover:bg-slate-300' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        {isConfirmed ? 'Unconfirm' : 'Confirm'}
                      </button>
                      <button
                        onClick={() => handleWhatsApp(plan)}
                        className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold rounded-lg bg-green-600 hover:bg-green-700 text-white transition-colors"
                      >
                        <MessageCircle className="w-3 h-3" /> WhatsApp
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export function HexZoneMapPage() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.Layer[]>([]);

  const [tickets, setTickets] = useState<Ticket[]>(() => getTickets());
  const [centers, setCenters]  = useState<Center[]>(() => getCenters());
  const [allTechs, setAllTechs] = useState<Technician[]>(() => getTechnicians());

  // Live: re-read whenever data changes anywhere (other tabs, other devices)
  useEffect(() => subscribeToDataChanges(() => { setTickets(getTickets()); setCenters(getCenters()); setAllTechs(getTechnicians()); setRoutePlans(getRoutePlans()); }), []);
  const [routePlans, setRoutePlans] = useState<TechnicianRoutePlan[]>(() => getRoutePlans());

  const [selectedCell, setSelectedCell] = useState<HexCell | null>(null);
  const [ignored, setIgnoredState] = useState<Set<string>>(() => getIgnored());
  useEffect(() => subscribeToDataChanges(() => setIgnoredState(getIgnored())), []);
  const [activeLayers, setActiveLayers] = useState<Set<MapLayer>>(
    () => new Set(['openTickets', 'techBases', 'clusters', 'spareHubs', 'techRoutes'] as MapLayer[])
  );
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [hideClearDCs, setHideClearDCs] = useState(false);

  // Route planner drawer state
  const [plannerOpen, setPlannerOpen] = useState(false);

  // Cluster roster: manual override of auto-assigned techs per cluster
  // Record<string, string>: clusterId (as string) → technicianId
  const [clusterRoster, setClusterRoster] = useState<Record<string, string>>(() => getClusterRoster());
  const [rosterSaved, setRosterSaved] = useState(false);

  function handleRosterChange(clusterId: number, techId: string) {
    setClusterRoster(prev => {
      const next = { ...prev };
      if (techId) next[String(clusterId)] = techId;
      else delete next[String(clusterId)];
      return next;
    });
    setRosterSaved(false);
  }
  function handleSaveRoster() {
    saveClusterRoster(clusterRoster);
    setRosterSaved(true);
    toast('Cluster roster saved');
    setTimeout(() => setRosterSaved(false), 3000);
  }
  function handleResetRoster() {
    setClusterRoster({});
    saveClusterRoster({});
    toast('Roster reset to auto-assign');
  }
  type HexFilter = 'all' | 'open' | 'unassigned';
  const [hexFilter, setHexFilter] = useState<HexFilter>('open');
  const [activeClusterView, setActiveClusterView] = useState(true);

  useEffect(() => { const u = subscribeToDataChanges(() => setTickets(getTickets())); return u; }, []);
  useEffect(() => { coordCache.clear(); }, [centers]);

  function persistIgnored(s: Set<string>) { setIgnoredState(new Set(s)); setIgnored(s); }

  const handleIgnore = useCallback((id: string) => {
    const s = new Set(ignored); s.add(id); persistIgnored(s);
    toast('Ticket ignored — won\'t show on map until restored');
  }, [ignored]);

  const handleUnignore = useCallback((id: string) => {
    const s = new Set(ignored); s.delete(id); persistIgnored(s);
  }, [ignored]);

  const handleReassign = useCallback((ticketId: string, techId: string) => {
    const tech = allTechs.find(t => t.id === techId);
    if (!tech) return;
    const updated = tickets.map(t =>
      t.id === ticketId
        ? { ...t, assignedTechnicianId: techId, assignedTechnicianName: tech.name, status: 'Assigned' as const, updatedAt: new Date().toISOString() }
        : t
    );
    saveTickets(updated); setTickets(updated);
    toast(`Reassigned to ${tech.name}`);
  }, [tickets, allTechs]);

  const handleEditTicket = useCallback((ticketId: string, priority: string, issue: string) => {
    const updated = tickets.map(t =>
      t.id === ticketId
        ? { ...t, priority: priority as Ticket['priority'], issue, updatedAt: new Date().toISOString() }
        : t
    );
    saveTickets(updated); setTickets(updated);
    toast('Ticket updated');
  }, [tickets]);

  const handleBulkAssign = useCallback((techId: string) => {
    if (!selectedCell) return;
    const tech = allTechs.find(t => t.id === techId);
    if (!tech) return;
    const ids = new Set(
      selectedCell.tickets
        .filter(t => !ignored.has(t.id) && t.status !== 'Resolved' && t.status !== 'Closed')
        .map(t => t.id)
    );
    const updated = tickets.map(t =>
      ids.has(t.id)
        ? { ...t, assignedTechnicianId: techId, assignedTechnicianName: tech.name, status: 'Assigned' as const, updatedAt: new Date().toISOString() }
        : t
    );
    saveTickets(updated); setTickets(updated);
    toast(`${ids.size} ticket${ids.size > 1 ? 's' : ''} assigned to ${tech.name}`);
    setSelectedCell(null);
  }, [selectedCell, allTechs, tickets, ignored]);

  const handleRemoveRouteStop = useCallback((techId: string, ticketId: string) => {
    const updated = routePlans.map(plan => {
      if (plan.technicianId !== techId) return plan;
      const newStops = plan.stops
        .filter(s => s.ticketId !== ticketId)
        .map((s, idx) => ({ ...s, stopOrder: idx + 1 }));
      return { ...plan, stops: newStops };
    });
    saveRoutePlans(updated);
    setRoutePlans(updated);
    toast('Stop removed from route');
  }, [routePlans]);

  const handleMoveRouteStop = useCallback((fromTechId: string, ticketId: string, toTechId: string) => {
    let movedStop: RouteStop | undefined;
    const updated = routePlans.map(plan => {
      if (plan.technicianId === fromTechId) {
        movedStop = plan.stops.find(s => s.ticketId === ticketId);
        const newStops = plan.stops
          .filter(s => s.ticketId !== ticketId)
          .map((s, idx) => ({ ...s, stopOrder: idx + 1 }));
        return { ...plan, stops: newStops };
      }
      return plan;
    }).map(plan => {
      if (plan.technicianId === toTechId && movedStop) {
        const newStop = { ...movedStop, stopOrder: plan.stops.length + 1 };
        return { ...plan, stops: [...plan.stops, newStop] };
      }
      return plan;
    });
    saveRoutePlans(updated);
    setRoutePlans(updated);
    toast('Stop moved to new technician');
  }, [routePlans]);

  function toast(msg: string) { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(null), 4000); }
  function toggleLayer(l: MapLayer) {
    setActiveLayers(prev => { const s = new Set(prev); s.has(l) ? s.delete(l) : s.add(l); return s; });
  }

  const filteredTickets = useMemo(() => tickets.filter(t => {
    if (hexFilter === 'open') return t.status !== 'Resolved' && t.status !== 'Closed';
    if (hexFilter === 'unassigned') return !t.assignedTechnicianId && t.status !== 'Resolved' && t.status !== 'Closed';
    return true;
  }), [tickets, hexFilter]);

  // Build grid + run k-means
  const grid = useMemo(() => {
    const raw = buildGrid(filteredTickets, centers, allTechs);
    const assignments = kMeansClusters(raw, NUM_CLUSTERS);
    return raw.map((cell, i) => ({ ...cell, clusterId: assignments[i] }));
  }, [filteredTickets, centers, allTechs]);

  const clusters = useMemo(() => buildClusters(grid, allTechs), [grid, allTechs]);

  // Merge roster overrides into clusters for display
  const clustersWithRoster = useMemo(() => clusters.map(cluster => {
    const overrideId = clusterRoster[String(cluster.id)];
    if (!overrideId) return cluster;
    const tech = allTechs.find(t => t.id === overrideId) ?? null;
    return { ...cluster, assignedTech: tech, isManualAssignment: true };
  }), [clusters, clusterRoster, allTechs]);

  // Find cluster for selected cell (use roster-overridden version so ZonePanel shows manual tech)
  const selectedCluster = useMemo(() =>
    selectedCell ? clustersWithRoster.find(c => c.cells.some(cc => cc.key === selectedCell.key)) ?? null : null,
    [selectedCell, clustersWithRoster]
  );

  // ── Draw map ──
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (!mapRef.current) {
      mapRef.current = L.map(mapContainerRef.current, { center: [28.58, 77.22], zoom: 11, zoomControl: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors', maxZoom: 19,
      }).addTo(mapRef.current);
    }
    const map = mapRef.current;
    layersRef.current.forEach(l => { try { map.removeLayer(l); } catch { /**/ } });
    layersRef.current = [];

    // Cluster tinted hex polygons (show under ticket layer)
    if (activeLayers.has('clusters')) {
      grid.forEach(cell => {
        const cluster = clusters.find(c => c.id === cell.clusterId);
        if (!cluster) return;
        const poly = L.polygon(hexCorners(cell.cLat, cell.cLng), {
          color: cluster.color, weight: 1, opacity: 0.5,
          fillColor: cluster.color, fillOpacity: activeClusterView ? 0.08 : 0,
        }).addTo(map);
        layersRef.current.push(poly);
      });

      // Cluster centroid labels (cluster ID + assigned tech name, roster-overridden)
      clustersWithRoster.forEach(cluster => {
        const icon = L.divIcon({
          className: '',
          html: `<div style="background:${cluster.color};color:white;font-size:9px;font-weight:800;padding:2px 5px;border-radius:10px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.4);border:1.5px solid white;opacity:0.9;">
            C${cluster.id + 1}${cluster.assignedTech ? ' · ' + cluster.assignedTech.name.split(' ')[0] : ''}
          </div>`,
          iconSize: [0, 0], iconAnchor: [0, 0],
        });
        const m = L.marker([cluster.centLat, cluster.centLng], { icon }).addTo(map);
        m.bindTooltip(
          `Cluster ${cluster.id + 1} · ${cluster.vehicleCount} vehicles\n${cluster.assignedTech ? cluster.assignedTech.name + ' (' + cluster.assignedTech.employeeId + ')' : 'No tech assigned'}\n${cluster.spareHubs.length} spare hub${cluster.spareHubs.length > 1 ? 's' : ''}`,
          { permanent: false, direction: 'top' }
        );
        layersRef.current.push(m);
      });
    }

    // Hex polygons (ticket density)
    grid.forEach(cell => {
      const open = cell.tickets.filter(t => !ignored.has(t.id) && t.status !== 'Resolved' && t.status !== 'Closed');
      const ign  = cell.tickets.filter(t => ignored.has(t.id));
      const hasOpen = open.length > 0 && activeLayers.has('openTickets');
      const hasIgn  = ign.length > 0 && activeLayers.has('ignoredTickets');
      if (!hasOpen && !hasIgn) return;

      const fill    = hasOpen ? hexFill(cell.tickets, ignored) : '#94a3b8';
      const opacity = hasOpen ? hexOpacity(cell.tickets, ignored) : 0.12;
      // Count only non-ignored open tickets for the label bubble
      const count   = hasOpen ? open.length : ign.length;

      const poly = L.polygon(hexCorners(cell.cLat, cell.cLng), {
        color: fill, weight: hasOpen ? 1.5 : 0.8,
        fillColor: fill, fillOpacity: opacity, opacity: hasOpen ? 0.8 : 0.4,
      }).addTo(map);

      const labelIcon = L.divIcon({
        className: '',
        html: `<div style="background:${fill};color:white;font-weight:700;font-size:11px;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.4);border:1.5px solid white;opacity:${hasOpen ? 1 : 0.5};">${count}</div>`,
        iconSize: [20, 20], iconAnchor: [10, 10],
      });
      const lm = L.marker([cell.cLat, cell.cLng], { icon: labelIcon }).addTo(map);
      layersRef.current.push(lm);

      poly.on('click', () => setSelectedCell(cell));
      poly.on('mouseover', () => poly.setStyle({ fillOpacity: Math.min(opacity + 0.2, 0.9), weight: 2.5 }));
      poly.on('mouseout',  () => poly.setStyle({ fillOpacity: opacity, weight: hasOpen ? 1.5 : 0.8 }));
      layersRef.current.push(poly);
    });

    // DC / Center markers
    centers.forEach(c => {
      if (!c.latitude || !c.longitude || isNaN(c.latitude)) return;
      const cTickets = filteredTickets.filter(t =>
        t.centerName.toLowerCase().trim() === c.name.toLowerCase().trim() || t.centerName.toLowerCase() === c.normalizedName
      );
      const openCount = cTickets.filter(t => !ignored.has(t.id) && t.status !== 'Resolved' && t.status !== 'Closed').length;
      const hasOpen = openCount > 0;
      const hasIgn  = cTickets.some(t => ignored.has(t.id));

      // Skip DCs with no open tickets when filter is active or hideClearDCs toggle is on
      if ((hideClearDCs || hexFilter !== 'all') && openCount === 0) return;

      const ringColor = hasOpen && activeLayers.has('openTickets') ? '#f97316'
                      : hasIgn && activeLayers.has('ignoredTickets') ? '#94a3b8'
                      : '#0f172a';
      const ringWidth = (hasOpen || hasIgn) ? 3 : 2;
      const icon = L.divIcon({
        className: '',
        html: `<div style="background:#0f172a;color:white;font-size:9px;font-weight:700;width:26px;height:26px;border-radius:5px;display:flex;align-items:center;justify-content:center;border:${ringWidth}px solid ${ringColor};box-shadow:0 2px 5px rgba(0,0,0,.35)">DC</div>`,
        iconSize: [26, 26], iconAnchor: [13, 13],
      });
      const m = L.marker([c.latitude, c.longitude], { icon }).addTo(map);
      m.bindTooltip(`${c.name.replace(/_D$/, '')} — ${openCount} open`, { permanent: false, direction: 'top' });
      m.on('click', () => {
        const cell = grid.find(cell => isInsideHex(c.latitude, c.longitude, cell.cLat, cell.cLng));
        if (cell) setSelectedCell(cell);
      });
      layersRef.current.push(m);
    });

    // Spare vehicle hub markers (diamond ◆)
    if (activeLayers.has('spareHubs')) {
      clusters.forEach(cluster => {
        cluster.spareHubs.forEach(hub => {
          const icon = L.divIcon({
            className: '',
            html: `<div style="display:flex;flex-direction:column;align-items:center;">
              <div style="width:18px;height:18px;background:${cluster.color};transform:rotate(45deg);border:2px solid white;box-shadow:0 2px 5px rgba(0,0,0,.4);"></div>
              <div style="font-size:9px;font-weight:700;color:${cluster.color};background:white;border-radius:3px;padding:0 3px;margin-top:2px;border:1px solid ${cluster.color};white-space:nowrap;">HUB ${hub.hubIndex}</div>
            </div>`,
            iconSize: [36, 36], iconAnchor: [18, 9],
          });
          const m = L.marker([hub.lat, hub.lng], { icon }).addTo(map);
          m.bindTooltip(`Cluster ${cluster.id + 1} · Spare Hub ${hub.hubIndex}\n~${Math.round(cluster.vehicleCount / cluster.spareHubs.length)} vehicles/hub`, { permanent: false, direction: 'top' });
          layersRef.current.push(m);
        });
      });
    }

    // Technician base markers
    if (activeLayers.has('techBases')) {
      allTechs.forEach(t => {
        if (!t.startingLatitude || !t.startingLongitude) return;
        const clusterOfTech = clusters.find(c => c.assignedTech?.id === t.id);
        const dotColor = clusterOfTech ? clusterOfTech.color : '#2563eb';
        const icon = L.divIcon({
          className: '',
          html: `<div style="background:${dotColor};color:white;font-size:10px;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.3)">🔧</div>`,
          iconSize: [22, 22], iconAnchor: [11, 11],
        });
        const m = L.marker([t.startingLatitude, t.startingLongitude], { icon }).addTo(map);
        m.bindTooltip(`${t.name} · ${t.zone || t.city}${clusterOfTech ? ' · Cluster ' + (clusterOfTech.id + 1) : ''}`, { permanent: false, direction: 'top' });
        layersRef.current.push(m);
      });
    }

    // Technician route lines + stop markers
    if (activeLayers.has('techRoutes')) {
      routePlans.forEach((plan, planIdx) => {
        const color = CLUSTER_COLORS[planIdx % CLUSTER_COLORS.length];
        // Build coordinate list: start point → stops in order
        const coords: [number, number][] = [];
        if (plan.startLat && plan.startLng) {
          coords.push([plan.startLat, plan.startLng]);
        }
        const sortedStops = [...plan.stops].sort((a, b) => a.stopOrder - b.stopOrder);
        sortedStops.forEach(stop => {
          if (stop.latitude && stop.longitude) {
            coords.push([stop.latitude, stop.longitude]);
          }
        });
        if (coords.length >= 2) {
          const line = L.polyline(coords, {
            color,
            weight: 2.5,
            opacity: 0.85,
            dashArray: '6 4',
          }).addTo(map);
          line.bindTooltip(`${plan.technicianName} · ${plan.stops.length} stops`, { permanent: false, direction: 'top' });
          line.on('click', () => {
            // Find hex cell for first stop
            if (sortedStops.length > 0) {
              const firstStop = sortedStops[0];
              const cell = grid.find(cell => isInsideHex(firstStop.latitude, firstStop.longitude, cell.cLat, cell.cLng));
              if (cell) setSelectedCell(cell);
            }
          });
          layersRef.current.push(line);
        }
        // Numbered stop circle markers
        sortedStops.forEach(stop => {
          if (!stop.latitude || !stop.longitude) return;
          const stopIcon = L.divIcon({
            className: '',
            html: `<div style="background:${color};color:white;font-weight:700;font-size:10px;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.4);border:2px solid white;">${stop.stopOrder}</div>`,
            iconSize: [20, 20], iconAnchor: [10, 10],
          });
          const sm = L.marker([stop.latitude, stop.longitude], { icon: stopIcon }).addTo(map);
          sm.bindTooltip(`${plan.technicianName} · Stop ${stop.stopOrder}\n${stop.ticketId} · ${stop.centerName.replace(/_D$/, '')}\nETA: ${stop.estimatedArrival}`, { permanent: false, direction: 'top' });
          sm.on('click', () => {
            const cell = grid.find(cell => isInsideHex(stop.latitude, stop.longitude, cell.cLat, cell.cLng));
            if (cell) setSelectedCell(cell);
          });
          layersRef.current.push(sm);
        });
      });
    }

    return () => {
      layersRef.current.forEach(l => { try { map.removeLayer(l); } catch { /**/ } });
      layersRef.current = [];
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredTickets, centers, allTechs, activeLayers, ignored, clusters, activeClusterView, routePlans, hideClearDCs]);

  useEffect(() => () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } }, []);

  // KPIs — exclude ignored from Open Tickets count
  const openAll    = tickets.filter(t => t.status !== 'Resolved' && t.status !== 'Closed' && !ignored.has(t.id));
  const unassigned = openAll.filter(t => !t.assignedTechnicianId);
  const ignoredCount = [...ignored].filter(id => tickets.some(t => t.id === id && t.status !== 'Resolved' && t.status !== 'Closed')).length;
  const criticalZones = grid.filter(c => c.tickets.some(t => !ignored.has(t.id) && t.priority === 'CRITICAL' && t.status !== 'Resolved' && t.status !== 'Closed'));
  const totalVehicles = new Set(tickets.map(t => t.vehicleNumber).filter(Boolean)).size;
  const totalHubs = clusters.reduce((s, c) => s + c.spareHubs.length, 0);

  const LAYER_CONFIG: { id: MapLayer; label: string; color: string; activeColor: string }[] = [
    { id: 'clusters',      label: '12 Clusters',    color: 'border-slate-200 text-slate-600', activeColor: 'bg-purple-600 border-purple-600 text-white' },
    { id: 'openTickets',   label: 'Open Tickets',   color: 'border-slate-200 text-slate-600', activeColor: 'bg-orange-500 border-orange-500 text-white' },
    { id: 'spareHubs',     label: 'Spare Hubs ◆',  color: 'border-slate-200 text-slate-600', activeColor: 'bg-teal-600 border-teal-600 text-white' },
    { id: 'techBases',     label: 'Tech Bases 🔧',  color: 'border-slate-200 text-slate-600', activeColor: 'bg-blue-600 border-blue-600 text-white' },
    { id: 'ignoredTickets',label: 'Ignored',        color: 'border-slate-200 text-slate-600', activeColor: 'bg-slate-500 border-slate-500 text-white' },
    { id: 'techRoutes',    label: 'Tech Routes',    color: 'border-slate-200 text-slate-600', activeColor: 'bg-indigo-600 border-indigo-600 text-white' },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">HEX ZONE MAP</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Delhi NCR · {NUM_CLUSTERS} vehicle-density clusters · 1 technician/cluster · spare hubs every 20 vehicles
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* PLAN ROUTES button */}
          <button
            onClick={() => setPlannerOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors"
          >
            <Compass className="w-3.5 h-3.5" /> PLAN ROUTES
          </button>
          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            {(['open', 'unassigned', 'all'] as const).map(f => (
              <button key={f} onClick={() => setHexFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${hexFilter === f ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {f === 'all' ? 'All Centers' : f === 'open' ? 'With Open Tickets' : 'Unassigned Only'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Layer toggles */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
          <Layers className="w-3.5 h-3.5" /> Layers:
        </div>
        {LAYER_CONFIG.map(l => (
          <button key={l.id} onClick={() => toggleLayer(l.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${activeLayers.has(l.id) ? l.activeColor : `bg-white ${l.color} hover:bg-slate-50`}`}>
            {l.label}
          </button>
        ))}
        {ignoredCount > 0 && (
          <button onClick={() => { persistIgnored(new Set()); toast('All ignored tickets restored'); }}
            className="px-3 py-1.5 rounded-full text-xs font-semibold border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 transition-colors">
            Clear {ignoredCount} ignored
          </button>
        )}
        {/* Hide clear DCs toggle */}
        <button
          onClick={() => setHideClearDCs(v => !v)}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${hideClearDCs ? 'bg-slate-700 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
          Hide clear DCs
        </button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
        {[
          { label: 'Open Tickets',   val: openAll.length,    color: 'text-blue-700',   bg: 'bg-blue-50 border-blue-200' },
          { label: 'Unassigned',     val: unassigned.length, color: 'text-amber-700',  bg: 'bg-amber-50 border-amber-200' },
          { label: 'Total Vehicles', val: totalVehicles,     color: 'text-slate-700',  bg: 'bg-slate-50 border-slate-200' },
          { label: 'Spare Hubs',     val: totalHubs,         color: 'text-teal-700',   bg: 'bg-teal-50 border-teal-200' },
          { label: 'Ignored',        val: ignoredCount,      color: 'text-slate-600',  bg: 'bg-slate-50 border-slate-200' },
          { label: 'Critical Zones', val: criticalZones.length, color: 'text-red-700', bg: 'bg-red-50 border-red-200' },
        ].map(k => (
          <div key={k.label} className={`border rounded-xl px-3 py-3 ${k.bg}`}>
            <div className={`text-2xl font-bold ${k.color}`} style={{ fontFamily: 'JetBrains Mono, monospace' }}>{k.val}</div>
            <div className={`text-[10px] font-semibold ${k.color} opacity-70 uppercase tracking-wide`}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Toast */}
      {successMsg && (
        <div className="flex items-center gap-2 bg-emerald-600 text-white text-xs font-medium px-4 py-2 rounded-lg shadow-sm">
          <CheckCircle2 className="w-4 h-4 shrink-0" />{successMsg}
        </div>
      )}

      {/* Map */}
      <div className="relative rounded-xl overflow-hidden border border-slate-200 shadow-sm bg-slate-100" style={{ height: '580px' }}>
        <div ref={mapContainerRef} className="w-full h-full z-10" />

        {/* Legend */}
        <div className="absolute bottom-3 left-3 z-[500] bg-white/95 backdrop-blur-xs px-3 py-2.5 rounded-lg border border-slate-200 shadow-sm text-xs space-y-1.5">
          <div className="font-semibold text-slate-700 mb-1 text-[11px] uppercase tracking-wide">Legend</div>
          {[
            { color: '#dc2626', label: 'CRITICAL hex' },
            { color: '#ea580c', label: 'HIGH hex' },
            { color: '#ca8a04', label: 'MEDIUM / 3+ tickets' },
            { color: '#3b82f6', label: 'LOW / 1–2 tickets' },
          ].map(l => (
            <div key={l.label} className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-sm inline-block shrink-0" style={{ background: l.color }} />
              <span className="text-slate-600 text-[11px]">{l.label}</span>
            </div>
          ))}
          <div className="pt-1 mt-1 border-t border-slate-100 space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 inline-block shrink-0 border-2 border-white shadow-xs" style={{ background: '#8b5cf6', transform: 'rotate(45deg)' }} />
              <span className="text-[11px] text-slate-600">Spare vehicle hub ◆</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 bg-slate-900 rounded-xs inline-block shrink-0 border-2 border-orange-500" />
              <span className="text-[11px] text-slate-600">DC with open tickets</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-blue-600 rounded-full inline-block shrink-0" />
              <span className="text-[11px] text-slate-600">Technician base</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block shrink-0 w-6 border-t-2 border-dashed border-indigo-500" />
              <span className="text-[11px] text-slate-600">Tech route line</span>
            </div>
          </div>
          <div className="pt-1 mt-1 border-t border-slate-100">
            <div className="text-[10px] font-semibold text-slate-400 uppercase mb-1">Clusters (C1–C{NUM_CLUSTERS})</div>
            <div className="grid grid-cols-4 gap-1">
              {clustersWithRoster.slice(0, 12).map(c => (
                <div key={c.id} className="flex items-center gap-0.5">
                  <span className="w-2.5 h-2.5 rounded-xs inline-block shrink-0" style={{ background: c.color }} />
                  <span className="text-[9px] text-slate-500">C{c.id + 1}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Zone panel */}
        {selectedCell && (
          <ZonePanel
            cell={selectedCell}
            cluster={selectedCluster}
            allTechs={allTechs}
            allTickets={tickets}
            ignored={ignored}
            routePlans={routePlans}
            onIgnore={handleIgnore}
            onUnignore={handleUnignore}
            onReassign={handleReassign}
            onBulkAssign={handleBulkAssign}
            onEditTicket={handleEditTicket}
            onRemoveRouteStop={handleRemoveRouteStop}
            onMoveRouteStop={handleMoveRouteStop}
            onClose={() => setSelectedCell(null)}
          />
        )}

        {!selectedCell && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[500] bg-white/90 backdrop-blur-xs px-3 py-1.5 rounded-full border border-slate-200 shadow-sm text-[11px] text-slate-500 flex items-center gap-1.5 pointer-events-none">
            <AlertTriangle className="w-3 h-3 text-amber-500" />
            Click a coloured hex or DC marker to manage tickets
          </div>
        )}
      </div>

      {/* Route Planner Drawer */}
      <RoutePlannerDrawer
        open={plannerOpen}
        onClose={() => setPlannerOpen(false)}
        routePlans={routePlans}
        setRoutePlans={setRoutePlans}
        tickets={tickets}
        ignored={ignored}
        onToast={toast}
      />

      {/* Cluster Roster (assignment table with manual override) */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
          <Diamond className="w-4 h-4 text-teal-600" />
          <span className="text-sm font-semibold text-slate-800">Cluster Roster</span>
          <span className="text-xs text-slate-400 ml-1">— {NUM_CLUSTERS} zones · manually assign technicians below</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={handleResetRoster}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Reset to Auto
            </button>
            <button
              onClick={handleSaveRoster}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${rosterSaved ? 'bg-emerald-600 text-white border border-emerald-600' : 'bg-blue-600 hover:bg-blue-700 text-white border border-blue-600'}`}
            >
              {rosterSaved ? '✓ Saved' : 'Save Roster'}
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50">
              <tr>
                {['Cluster', 'Color', 'Vehicles', 'Open Tickets', 'Assign Technician', 'Zone/City', 'Spare Hubs', 'Hexes'].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {clustersWithRoster.map(cluster => {
                const openInCluster = cluster.cells.reduce((s, c) =>
                  s + c.tickets.filter(t => !ignored.has(t.id) && t.status !== 'Resolved' && t.status !== 'Closed').length, 0);
                const hasManualOverride = Boolean(clusterRoster[String(cluster.id)]);
                const activeTechList = allTechs.filter(t => t.status === 'Active');
                return (
                  <tr key={cluster.id} className={`transition-colors ${hasManualOverride ? 'bg-indigo-50/40 hover:bg-indigo-50' : 'hover:bg-slate-50'}`}>
                    <td className="px-4 py-2.5 font-bold text-slate-700">
                      <span>C{cluster.id + 1}</span>
                      {hasManualOverride && (
                        <span className="ml-1.5 text-[9px] font-bold text-indigo-600 bg-indigo-100 px-1.5 py-0.5 rounded-full">MANUAL</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="w-4 h-4 rounded inline-block border border-white shadow-xs" style={{ background: cluster.color }} />
                    </td>
                    <td className="px-4 py-2.5 font-mono font-semibold text-slate-900">{cluster.vehicleCount}</td>
                    <td className="px-4 py-2.5">
                      {openInCluster > 0 ? (
                        <span className="text-blue-700 font-semibold">{openInCluster}</span>
                      ) : <span className="text-emerald-600 text-[11px]">✓ clear</span>}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={clusterRoster[String(cluster.id)] ?? cluster.assignedTech?.id ?? ''}
                        onChange={e => handleRosterChange(cluster.id, e.target.value)}
                        className={`text-xs border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[200px] ${hasManualOverride ? 'border-indigo-300 bg-indigo-50 text-indigo-900 font-semibold' : 'border-slate-200 bg-white text-slate-700'}`}
                      >
                        <option value="">— Auto ({cluster.assignedTech?.name ?? 'none'}) —</option>
                        {activeTechList.map(t => (
                          <option key={t.id} value={t.id}>{t.name} · {t.employeeId} · {t.zone || t.city}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2.5 text-slate-500 text-[11px]">
                      {cluster.assignedTech?.zone || cluster.assignedTech?.city || '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1">
                        <span className="w-2.5 h-2.5 inline-block shrink-0 border border-white shadow-xs" style={{ background: cluster.color, transform: 'rotate(45deg)' }} />
                        <span className="font-semibold text-teal-700">{cluster.spareHubs.length}</span>
                        <span className="text-slate-400 text-[10px]">hub{cluster.spareHubs.length > 1 ? 's' : ''}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-400 text-[11px]">{cluster.cells.length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
          <span className="text-[11px] text-slate-400">
            {Object.keys(clusterRoster).length > 0
              ? `${Object.keys(clusterRoster).length} manual override${Object.keys(clusterRoster).length > 1 ? 's' : ''} · rest auto-assigned`
              : 'All clusters auto-assigned by proximity and zone'}
          </span>
          <button
            onClick={handleSaveRoster}
            className={`px-3 py-1 rounded text-xs font-bold transition-colors ${rosterSaved ? 'text-emerald-600' : 'text-blue-600 hover:underline'}`}
          >
            {rosterSaved ? '✓ Roster saved' : 'Save changes'}
          </button>
        </div>
      </div>

      {/* Zone-level table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
          <Users className="w-4 h-4 text-slate-500" />
          <span className="text-sm font-semibold text-slate-800">Active Zones</span>
          <span className="text-xs text-slate-400 ml-1">— click row to manage</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50">
              <tr>
                {['Zone', 'Cluster', 'Centers', 'Open', 'Unassigned', 'Ignored', 'Priority', 'Based Techs'].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {grid
                .filter(c => c.tickets.length > 0 || c.centers.length > 0)
                .sort((a, b) => {
                  const ao = a.tickets.filter(t => !ignored.has(t.id) && t.status !== 'Resolved' && t.status !== 'Closed').length;
                  const bo = b.tickets.filter(t => !ignored.has(t.id) && t.status !== 'Resolved' && t.status !== 'Closed').length;
                  return bo - ao;
                })
                .map(cell => {
                  const open = cell.tickets.filter(t => !ignored.has(t.id) && t.status !== 'Resolved' && t.status !== 'Closed');
                  const ign  = cell.tickets.filter(t => ignored.has(t.id));
                  const una  = open.filter(t => !t.assignedTechnicianId).length;
                  const top  = (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).find(p => open.some(t => t.priority === p));
                  const cCluster = clustersWithRoster.find(c => c.id === cell.clusterId);
                  return (
                    <tr key={cell.key} onClick={() => setSelectedCell(cell)} className="hover:bg-blue-50 cursor-pointer transition-colors">
                      <td className="px-4 py-2.5 font-mono text-slate-500 text-[11px]">{cell.key}</td>
                      <td className="px-4 py-2.5">
                        {cCluster && (
                          <span className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-xs inline-block" style={{ background: cCluster.color }} />
                            <span className="text-[11px] font-semibold text-slate-700">C{cCluster.id + 1}</span>
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-slate-700 text-[11px]">{cell.centers.map(c => c.name.replace(/_D$/, '')).join(', ') || '—'}</td>
                      <td className="px-4 py-2.5 font-bold text-slate-900">{open.length || '—'}</td>
                      <td className="px-4 py-2.5">
                        {una > 0 ? <span className="text-amber-700 font-semibold">{una}</span> : open.length > 0 ? <span className="text-emerald-600 text-[11px]">✓ assigned</span> : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        {ign.length > 0 ? <span className="text-slate-400 flex items-center gap-1"><EyeOff className="w-3 h-3" />{ign.length}</span> : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        {top ? <span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ background: PRIORITY_COLOR[top] }}>{top}</span> : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 text-[11px]">{cell.techs.map(t => t.name.split(' ')[0]).join(', ') || '—'}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
