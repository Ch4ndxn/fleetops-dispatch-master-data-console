/**
 * HexZoneMapPage — hexagonal cluster dispatch view for Delhi NCR
 *
 * Map layers (toggleable):
 *   • Centers with open tickets   — lit hex + DC marker (orange ring)
 *   • Centers with ignored tickets — dim hex + DC marker (grey ring)
 *   • Technician bases             — blue 🔧 dots
 *
 * Click a hex / center → side panel with:
 *   • Per-ticket list: Ignore (skip for today) | Reassign to another tech
 *   • Bulk-assign all open tickets to one technician
 */
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as L from 'leaflet';
import {
  getCenters, getTechnicians, getTickets, saveTickets,
  subscribeToDataChanges,
} from '../../services/storage';
import { Ticket, Technician, Center } from '../../types';
import {
  Users, Zap, CheckCircle2, X, MapPin, AlertTriangle,
  EyeOff, RefreshCw, Filter, Layers,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────
type MapLayer = 'openTickets' | 'ignoredTickets' | 'techBases';

// ─── Hex grid parameters ─────────────────────────────────────────────────────
const BBOX = { minLat: 28.28, maxLat: 28.85, minLng: 76.80, maxLng: 77.58 };
const HEX_R_LAT = 0.055;
const HEX_R_LNG = 0.075;

// ─── Priority colours ─────────────────────────────────────────────────────────
const PRIORITY_COLOR: Record<string, string> = {
  CRITICAL: '#dc2626',
  HIGH:     '#ea580c',
  MEDIUM:   '#ca8a04',
  LOW:      '#16a34a',
};

// ─── Ignored-ticket store (session-level; in localStorage) ───────────────────
const IGNORED_KEY = 'fleetops_ignored_tickets';
function getIgnored(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(IGNORED_KEY) || '[]')); }
  catch { return new Set(); }
}
function setIgnored(s: Set<string>) {
  localStorage.setItem(IGNORED_KEY, JSON.stringify([...s]));
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
      cells.push({
        key: `${col}-${row}`, col, row, cLat, cLng,
        tickets: tickets.filter(t => { const c = centerCoords(t.centerName, centers); return c && isInsideHex(c.lat, c.lng, cLat, cLng); }),
        centers: centers.filter(c => isInsideHex(c.latitude, c.longitude, cLat, cLng)),
        techs: techs.filter(t => t.startingLatitude && t.startingLongitude && isInsideHex(t.startingLatitude, t.startingLongitude, cLat, cLng)),
      });
    }
  }
  return cells;
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

// ─── Side panel ───────────────────────────────────────────────────────────────
interface PanelProps {
  cell: HexCell;
  allTechs: Technician[];
  ignored: Set<string>;
  onIgnore: (id: string) => void;
  onUnignore: (id: string) => void;
  onReassign: (ticketId: string, techId: string) => void;
  onBulkAssign: (techId: string) => void;
  onClose: () => void;
}

function ZonePanel({ cell, allTechs, ignored, onIgnore, onUnignore, onReassign, onBulkAssign, onClose }: PanelProps) {
  const [bulkTech, setBulkTech] = useState('');
  const [reassignTarget, setReassignTarget] = useState<string | null>(null);
  const [reassignTech, setReassignTech] = useState('');
  const [tab, setTab] = useState<'open' | 'ignored'>('open');

  const activeTechs = allTechs.filter(t => t.status === 'Active');
  const allTickets = cell.tickets;
  const openTickets  = allTickets.filter(t => !ignored.has(t.id) && t.status !== 'Resolved' && t.status !== 'Closed');
  const ignoredInCell = allTickets.filter(t => ignored.has(t.id));

  return (
    <div className="absolute top-3 right-3 z-[1000] w-84 bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden flex flex-col" style={{ maxHeight: 'calc(100% - 24px)', width: '22rem' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-900 text-white shrink-0">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-blue-400" />
          <div>
            <div className="font-semibold text-sm">Zone {cell.key}</div>
            <div className="text-[10px] text-slate-400 truncate">
              {cell.centers.map(c => c.name.replace(/_D$/, '')).join(' · ') || 'No center'}
            </div>
          </div>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white shrink-0"><X className="w-4 h-4" /></button>
      </div>

      {/* Stats row */}
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
        {(['open', 'ignored'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 text-xs font-semibold transition-colors capitalize ${tab === t ? 'border-b-2 border-blue-600 text-blue-700 bg-blue-50' : 'text-slate-500 hover:text-slate-700'}`}>
            {t === 'open' ? `Open (${openTickets.length})` : `Ignored (${ignoredInCell.length})`}
          </button>
        ))}
      </div>

      {/* Ticket list — scrollable */}
      <div className="overflow-y-auto flex-1 p-3 space-y-2">
        {tab === 'open' && (
          openTickets.length === 0
            ? <div className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-50 rounded-lg px-3 py-2.5"><CheckCircle2 className="w-4 h-4" />All tickets assigned or ignored</div>
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
                {/* Per-ticket actions */}
                <div className="flex border-t border-slate-100">
                  <button
                    onClick={() => onIgnore(t.id)}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[11px] text-slate-500 hover:bg-slate-100 transition-colors font-medium"
                  >
                    <EyeOff className="w-3 h-3" /> Ignore
                  </button>
                  <div className="w-px bg-slate-100" />
                  <button
                    onClick={() => { setReassignTarget(t.id); setReassignTech(t.assignedTechnicianId || ''); }}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[11px] text-blue-600 hover:bg-blue-50 transition-colors font-medium"
                  >
                    <RefreshCw className="w-3 h-3" /> Reassign
                  </button>
                </div>
                {/* Inline reassign dropdown */}
                {reassignTarget === t.id && (
                  <div className="px-2.5 pb-2.5 pt-1 space-y-1.5 bg-blue-50 border-t border-blue-100">
                    <select
                      value={reassignTech}
                      onChange={e => setReassignTech(e.target.value)}
                      className="w-full text-xs border border-blue-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">— Pick technician —</option>
                      {activeTechs.map(tech => (
                        <option key={tech.id} value={tech.id}>
                          {tech.name} · {tech.zone || tech.city}
                          {tech.id === t.assignedTechnicianId ? ' (current)' : ''}
                        </option>
                      ))}
                    </select>
                    <div className="flex gap-1.5">
                      <button
                        disabled={!reassignTech}
                        onClick={() => { onReassign(t.id, reassignTech); setReassignTarget(null); setReassignTech(''); }}
                        className="flex-1 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs rounded-lg font-semibold"
                      >Confirm</button>
                      <button onClick={() => setReassignTarget(null)} className="px-3 py-1 bg-white border border-slate-200 text-xs rounded-lg text-slate-600 hover:bg-slate-50">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            ))
        )}

        {tab === 'ignored' && (
          ignoredInCell.length === 0
            ? <div className="text-xs text-slate-400 text-center py-4">No ignored tickets in this zone</div>
            : ignoredInCell.map(t => (
              <div key={t.id} className="border border-slate-200 rounded-lg bg-slate-50 overflow-hidden opacity-70">
                <div className="flex items-center gap-2 px-2.5 py-2">
                  <EyeOff className="w-3 h-3 text-slate-400 shrink-0" />
                  <span className="text-xs font-mono text-slate-600 shrink-0">{t.ticketId}</span>
                  <span className="text-xs text-slate-400 truncate flex-1">{t.vehicleNumber}</span>
                </div>
                <div className="flex border-t border-slate-100">
                  <button
                    onClick={() => onUnignore(t.id)}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[11px] text-blue-600 hover:bg-blue-50 transition-colors font-medium"
                  >
                    <RefreshCw className="w-3 h-3" /> Restore
                  </button>
                </div>
              </div>
            ))
        )}
      </div>

      {/* Bulk assign footer */}
      {openTickets.length > 0 && (
        <div className="border-t border-slate-200 p-3 space-y-2 bg-slate-50 shrink-0">
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            Bulk assign all {openTickets.length} open ticket{openTickets.length > 1 ? 's' : ''}
          </div>
          <select
            value={bulkTech}
            onChange={e => setBulkTech(e.target.value)}
            className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">— Select technician —</option>
            {activeTechs.map(t => (
              <option key={t.id} value={t.id}>{t.name} · {t.specialisation} · {t.zone || t.city}</option>
            ))}
          </select>
          <button
            disabled={!bulkTech}
            onClick={() => { onBulkAssign(bulkTech); setBulkTech(''); }}
            className="w-full flex items-center justify-center gap-2 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-xs font-semibold"
          >
            <Zap className="w-3.5 h-3.5" /> Assign to Zone
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export function HexZoneMapPage() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.Layer[]>([]);

  const [tickets, setTickets] = useState<Ticket[]>(() => getTickets());
  const [centers]  = useState<Center[]>(() => getCenters());
  const [allTechs] = useState<Technician[]>(() => getTechnicians());

  const [selectedCell, setSelectedCell] = useState<HexCell | null>(null);
  const [ignored, setIgnoredState] = useState<Set<string>>(() => getIgnored());
  const [activeLayers, setActiveLayers] = useState<Set<MapLayer>>(
    () => new Set(['openTickets', 'techBases'] as MapLayer[])
  );
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Ticket filter for hex colouring
  type HexFilter = 'all' | 'open' | 'unassigned';
  const [hexFilter, setHexFilter] = useState<HexFilter>('open');

  useEffect(() => { const u = subscribeToDataChanges(() => setTickets(getTickets())); return u; }, []);
  useEffect(() => { coordCache.clear(); }, [centers]);

  function persistIgnored(s: Set<string>) { setIgnoredState(new Set(s)); setIgnored(s); }

  const handleIgnore = useCallback((id: string) => {
    const s = new Set(ignored); s.add(id); persistIgnored(s);
    toast(`Ticket ignored — won't show on map until restored`);
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

  function toast(msg: string) { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(null), 4000); }

  function toggleLayer(l: MapLayer) {
    setActiveLayers(prev => { const s = new Set(prev); s.has(l) ? s.delete(l) : s.add(l); return s; });
  }

  // Tickets fed to grid (respects hex filter)
  const filteredTickets = useMemo(() => tickets.filter(t => {
    if (hexFilter === 'open') return t.status !== 'Resolved' && t.status !== 'Closed';
    if (hexFilter === 'unassigned') return !t.assignedTechnicianId && t.status !== 'Resolved' && t.status !== 'Closed';
    return true;
  }), [tickets, hexFilter]);

  const grid = useMemo(() => buildGrid(filteredTickets, centers, allTechs), [filteredTickets, centers, allTechs]);

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

    // Hex polygons
    grid.forEach(cell => {
      const open = cell.tickets.filter(t => !ignored.has(t.id) && t.status !== 'Resolved' && t.status !== 'Closed');
      const ign  = cell.tickets.filter(t => ignored.has(t.id));
      const hasOpen = open.length > 0 && activeLayers.has('openTickets');
      const hasIgn  = ign.length > 0 && activeLayers.has('ignoredTickets');
      if (!hasOpen && !hasIgn) return;

      const fill    = hasOpen ? hexFill(cell.tickets, ignored) : '#94a3b8';
      const opacity = hasOpen ? hexOpacity(cell.tickets, ignored) : 0.12;
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
      // Find if this center has open or ignored tickets
      const cTickets = filteredTickets.filter(t => t.centerName.toLowerCase().trim() === c.name.toLowerCase().trim() || t.centerName.toLowerCase() === c.normalizedName);
      const hasOpen = cTickets.some(t => !ignored.has(t.id) && t.status !== 'Resolved' && t.status !== 'Closed');
      const hasIgn  = cTickets.some(t => ignored.has(t.id));

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
      m.bindTooltip(`${c.name.replace(/_D$/, '')} — ${cTickets.filter(t => !ignored.has(t.id) && t.status !== 'Resolved' && t.status !== 'Closed').length} open`, { permanent: false, direction: 'top' });
      // Click center → find its hex cell
      m.on('click', () => {
        const cell = grid.find(cell => isInsideHex(c.latitude, c.longitude, cell.cLat, cell.cLng));
        if (cell) setSelectedCell(cell);
      });
      layersRef.current.push(m);
    });

    // Technician base markers
    if (activeLayers.has('techBases')) {
      allTechs.forEach(t => {
        if (!t.startingLatitude || !t.startingLongitude) return;
        const icon = L.divIcon({
          className: '',
          html: `<div style="background:#2563eb;color:white;font-size:10px;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.3)">🔧</div>`,
          iconSize: [22, 22], iconAnchor: [11, 11],
        });
        const m = L.marker([t.startingLatitude, t.startingLongitude], { icon }).addTo(map);
        m.bindTooltip(`${t.name} · ${t.zone || t.city}`, { permanent: false, direction: 'top' });
        layersRef.current.push(m);
      });
    }

    return () => {
      layersRef.current.forEach(l => { try { map.removeLayer(l); } catch { /**/ } });
      layersRef.current = [];
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredTickets, centers, allTechs, activeLayers, ignored]);

  useEffect(() => () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } }, []);

  // KPIs
  const openAll    = tickets.filter(t => t.status !== 'Resolved' && t.status !== 'Closed');
  const unassigned = openAll.filter(t => !t.assignedTechnicianId && !ignored.has(t.id));
  const ignoredCount = [...ignored].filter(id => openAll.some(t => t.id === id)).length;
  const criticalZones = grid.filter(c => c.tickets.some(t => !ignored.has(t.id) && t.priority === 'CRITICAL' && t.status !== 'Resolved' && t.status !== 'Closed'));

  const LAYER_CONFIG: { id: MapLayer; label: string; color: string; activeColor: string }[] = [
    { id: 'openTickets',    label: 'Open Tickets',    color: 'border-slate-200 text-slate-600',          activeColor: 'bg-orange-500 border-orange-500 text-white' },
    { id: 'ignoredTickets', label: 'Ignored Tickets', color: 'border-slate-200 text-slate-600',          activeColor: 'bg-slate-500 border-slate-500 text-white' },
    { id: 'techBases',      label: 'Tech Bases',      color: 'border-slate-200 text-slate-600',          activeColor: 'bg-blue-600 border-blue-600 text-white' },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">HEX ZONE MAP</h1>
          <p className="text-xs text-slate-500 mt-0.5">Delhi NCR service clusters · click a hex or center to manage tickets</p>
        </div>
        {/* Hex filter */}
        <div className="flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          {(['all', 'open', 'unassigned'] as const).map(f => (
            <button key={f} onClick={() => setHexFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${hexFilter === f ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {f === 'all' ? 'All' : f === 'open' ? 'Open' : 'Unassigned'}
            </button>
          ))}
        </div>
      </div>

      {/* Layer toggles */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
          <Layers className="w-3.5 h-3.5" /> Show:
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
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Open Tickets',   val: openAll.length,    color: 'text-blue-700',    bg: 'bg-blue-50 border-blue-200' },
          { label: 'Unassigned',     val: unassigned.length, color: 'text-amber-700',   bg: 'bg-amber-50 border-amber-200' },
          { label: 'Ignored',        val: ignoredCount,      color: 'text-slate-600',   bg: 'bg-slate-50 border-slate-200' },
          { label: 'Critical Zones', val: criticalZones.length, color: 'text-red-700',  bg: 'bg-red-50 border-red-200' },
        ].map(k => (
          <div key={k.label} className={`border rounded-xl px-4 py-3 ${k.bg}`}>
            <div className={`text-2xl font-bold ${k.color}`}>{k.val}</div>
            <div className={`text-[11px] font-semibold ${k.color} opacity-70 uppercase tracking-wide`}>{k.label}</div>
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
          <div className="font-semibold text-slate-700 mb-1 text-[11px] uppercase tracking-wide">Hex colour</div>
          {[
            { color: '#dc2626', label: 'CRITICAL priority' },
            { color: '#ea580c', label: 'HIGH priority' },
            { color: '#ca8a04', label: 'MEDIUM / 3+ tickets' },
            { color: '#3b82f6', label: 'LOW / 1–2 tickets' },
            { color: '#94a3b8', label: 'Ignored tickets' },
          ].map(l => (
            <div key={l.label} className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-sm inline-block shrink-0" style={{ background: l.color }} />
              <span className="text-slate-600 text-[11px]">{l.label}</span>
            </div>
          ))}
          <div className="pt-1 mt-1 border-t border-slate-100 space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 bg-slate-900 rounded-xs inline-block shrink-0 border-2 border-orange-500" />
              <span className="text-[11px] text-slate-600">DC with open tickets</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 bg-slate-900 rounded-xs inline-block shrink-0 border-2 border-slate-400" />
              <span className="text-[11px] text-slate-600">DC with ignored tickets</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-blue-600 rounded-full inline-block shrink-0" />
              <span className="text-[11px] text-slate-600">Technician base</span>
            </div>
          </div>
        </div>

        {/* Zone panel */}
        {selectedCell && (
          <ZonePanel
            cell={selectedCell}
            allTechs={allTechs}
            ignored={ignored}
            onIgnore={handleIgnore}
            onUnignore={handleUnignore}
            onReassign={handleReassign}
            onBulkAssign={handleBulkAssign}
            onClose={() => setSelectedCell(null)}
          />
        )}

        {!selectedCell && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[500] bg-white/90 backdrop-blur-xs px-3 py-1.5 rounded-full border border-slate-200 shadow-sm text-[11px] text-slate-500 flex items-center gap-1.5 pointer-events-none">
            <AlertTriangle className="w-3 h-3 text-amber-500" />
            Click a coloured hex or center marker to manage tickets
          </div>
        )}
      </div>

      {/* Zone table */}
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
                {['Zone', 'Centers', 'Open', 'Unassigned', 'Ignored', 'Priority', 'Based Techs'].map(h => (
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
                  return (
                    <tr key={cell.key} onClick={() => setSelectedCell(cell)} className="hover:bg-blue-50 cursor-pointer transition-colors">
                      <td className="px-4 py-2.5 font-mono text-slate-500 text-[11px]">{cell.key}</td>
                      <td className="px-4 py-2.5 text-slate-700 text-[11px]">{cell.centers.map(c => c.name.replace(/_D$/, '')).join(', ') || '—'}</td>
                      <td className="px-4 py-2.5 font-bold text-slate-900">{open.length || '—'}</td>
                      <td className="px-4 py-2.5">
                        {una > 0 ? <span className="text-amber-700 font-semibold">{una}</span> : open.length > 0 ? <span className="text-emerald-600 text-[11px]">✓ all assigned</span> : '—'}
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
