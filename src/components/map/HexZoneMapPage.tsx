/**
 * HexZoneMapPage — divides Delhi NCR into hexagonal clusters.
 * Each hex shows ticket density. Click a hex → assign a technician
 * to all open tickets in that zone.
 *
 * Hex grid uses a flat-top offset grid projected onto lat/lng.
 * Grid origin is the SW corner of Delhi NCR bbox.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as L from 'leaflet';
import {
  getCenters, getTechnicians, getTickets, saveTickets,
  subscribeToDataChanges
} from '../../services/storage';
import { Ticket, Technician, Center } from '../../types';
import { Users, Zap, CheckCircle2, X, MapPin, AlertTriangle } from 'lucide-react';

// ─── Hex grid parameters ────────────────────────────────────────────────────
// Delhi NCR bounding box
const BBOX = { minLat: 28.30, maxLat: 28.82, minLng: 76.82, maxLng: 77.55 };
// Hex radius in degrees (approx 8 km at 28° N)
const HEX_R_LAT = 0.055;
const HEX_R_LNG = 0.075;

// Priority colours
const PRIORITY_COLOR: Record<string, string> = {
  CRITICAL: '#dc2626',
  HIGH:     '#ea580c',
  MEDIUM:   '#ca8a04',
  LOW:      '#16a34a',
};

// ─── Flat-top hex math ───────────────────────────────────────────────────────
function hexCorners(cLat: number, cLng: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i); // flat-top: 0°=right
    pts.push([cLat + HEX_R_LAT * Math.sin(angle), cLng + HEX_R_LNG * Math.cos(angle)]);
  }
  return pts;
}

interface HexCell {
  key: string;
  col: number;
  row: number;
  cLat: number;
  cLng: number;
  tickets: Ticket[];
  centers: Center[];
  techs: Technician[];
}

function buildGrid(tickets: Ticket[], centers: Center[], techs: Technician[]): HexCell[] {
  // Step between hex centres (flat-top grid)
  const stepLng = HEX_R_LNG * 1.5;          // horizontal spacing
  const stepLat = HEX_R_LAT * Math.sqrt(3); // vertical spacing

  const cols = Math.ceil((BBOX.maxLng - BBOX.minLng) / stepLng) + 1;
  const rows = Math.ceil((BBOX.maxLat - BBOX.minLat) / stepLat) + 1;

  const cells: HexCell[] = [];

  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      const cLng = BBOX.minLng + col * stepLng;
      const offset = (col % 2) * (stepLat / 2);
      const cLat = BBOX.minLat + row * stepLat + offset;

      if (cLat > BBOX.maxLat + HEX_R_LAT) continue;

      // Which tickets fall inside this hex (point-in-hex via closest-centre)
      const hexTickets = tickets.filter(t => {
        const c = findCenterCoords(t.centerName, centers);
        if (!c) return false;
        return isInsideHex(c.lat, c.lng, cLat, cLng);
      });

      const hexCenters = centers.filter(c =>
        isInsideHex(c.latitude, c.longitude, cLat, cLng)
      );

      const hexTechs = techs.filter(t =>
        t.startingLatitude && t.startingLongitude &&
        isInsideHex(t.startingLatitude, t.startingLongitude, cLat, cLng)
      );

      cells.push({ key: `${col}-${row}`, col, row, cLat, cLng, tickets: hexTickets, centers: hexCenters, techs: hexTechs });
    }
  }
  return cells;
}

const centerCoordCache = new Map<string, { lat: number; lng: number } | null>();
function findCenterCoords(name: string, centers: Center[]): { lat: number; lng: number } | null {
  if (centerCoordCache.has(name)) return centerCoordCache.get(name)!;
  const n = name.toLowerCase().trim();
  const c = centers.find(c => c.name.toLowerCase().trim() === n || c.normalizedName === n);
  const result = c ? { lat: c.latitude, lng: c.longitude } : null;
  centerCoordCache.set(name, result);
  return result;
}

function isInsideHex(pLat: number, pLng: number, cLat: number, cLng: number): boolean {
  // Normalise to hex local space
  const q = (pLng - cLng) / HEX_R_LNG;
  const r = (pLat - cLat) / HEX_R_LAT;
  // Flat-top hex: inside if max(|q|, |r + q/2|, |r - q/2|) <= 1
  return Math.max(Math.abs(q), Math.abs(r + q / 2), Math.abs(r - q / 2)) <= 1.0;
}

function hexFillColor(cell: HexCell): string {
  const open = cell.tickets.filter(t => t.status !== 'Resolved' && t.status !== 'Closed');
  if (open.length === 0) return 'transparent';
  const critical = open.some(t => t.priority === 'CRITICAL');
  const high = open.some(t => t.priority === 'HIGH');
  if (critical) return '#dc2626';
  if (high) return '#ea580c';
  if (open.length >= 3) return '#ca8a04';
  return '#3b82f6';
}

function hexOpacity(cell: HexCell): number {
  const n = cell.tickets.filter(t => t.status !== 'Resolved' && t.status !== 'Closed').length;
  if (n === 0) return 0;
  return Math.min(0.15 + n * 0.1, 0.75);
}

// ─── Assignment panel ────────────────────────────────────────────────────────
interface AssignPanelProps {
  cell: HexCell;
  allTechs: Technician[];
  onAssign: (techId: string) => void;
  onClose: () => void;
}

function AssignPanel({ cell, allTechs, onAssign, onClose }: AssignPanelProps) {
  const [selectedTech, setSelectedTech] = useState('');
  const openTickets = cell.tickets.filter(t => t.status !== 'Resolved' && t.status !== 'Closed');
  const activeTechs = allTechs.filter(t => t.status === 'Active');

  return (
    <div className="absolute top-4 right-4 z-[1000] w-80 bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-slate-900 text-white">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-blue-400" />
          <span className="font-semibold text-sm">Zone {cell.key}</span>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center bg-slate-50 rounded-lg py-2">
            <div className="text-lg font-bold text-slate-900">{openTickets.length}</div>
            <div className="text-[10px] text-slate-500 uppercase">Open Tickets</div>
          </div>
          <div className="text-center bg-slate-50 rounded-lg py-2">
            <div className="text-lg font-bold text-slate-900">{cell.centers.length}</div>
            <div className="text-[10px] text-slate-500 uppercase">Centers</div>
          </div>
          <div className="text-center bg-slate-50 rounded-lg py-2">
            <div className="text-lg font-bold text-slate-900">{cell.techs.length}</div>
            <div className="text-[10px] text-slate-500 uppercase">Techs Based</div>
          </div>
        </div>

        {/* Ticket list */}
        {openTickets.length > 0 ? (
          <div className="space-y-1 max-h-40 overflow-y-auto">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Open Tickets</div>
            {openTickets.map(t => (
              <div key={t.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-slate-50 border border-slate-100">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PRIORITY_COLOR[t.priority] ?? '#94a3b8' }} />
                <span className="text-xs font-mono text-slate-600 shrink-0">{t.ticketId}</span>
                <span className="text-xs text-slate-500 truncate">{t.vehicleNumber}</span>
                {t.assignedTechnicianName && (
                  <span className="ml-auto text-[10px] text-emerald-600 shrink-0">✓ {t.assignedTechnicianName.split(' ')[0]}</span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-50 rounded-lg px-3 py-2">
            <CheckCircle2 className="w-4 h-4" />
            No open tickets in this zone
          </div>
        )}

        {/* Assign technician */}
        {openTickets.length > 0 && (
          <div className="space-y-2">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
              Assign Technician to All {openTickets.length} Ticket{openTickets.length > 1 ? 's' : ''}
            </div>
            <select
              value={selectedTech}
              onChange={e => setSelectedTech(e.target.value)}
              className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— Select technician —</option>
              {activeTechs.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name} · {t.specialisation} · {t.zone || t.city}
                </option>
              ))}
            </select>
            <button
              disabled={!selectedTech}
              onClick={() => selectedTech && onAssign(selectedTech)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-xs font-semibold transition-colors"
            >
              <Zap className="w-3.5 h-3.5" />
              Assign to Zone
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export function HexZoneMapPage() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.Layer[]>([]);

  const [tickets, setTickets] = useState<Ticket[]>(() => getTickets());
  const [centers] = useState<Center[]>(() => getCenters());
  const [allTechs] = useState<Technician[]>(() => getTechnicians());
  const [selectedCell, setSelectedCell] = useState<HexCell | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | 'open' | 'unassigned'>('open');
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Subscribe to storage changes
  useEffect(() => {
    const unsub = subscribeToDataChanges(() => setTickets(getTickets()));
    return unsub;
  }, []);

  // Clear coord cache on centers change
  useEffect(() => { centerCoordCache.clear(); }, [centers]);

  const filteredTickets = tickets.filter(t => {
    if (filterStatus === 'open') return t.status !== 'Resolved' && t.status !== 'Closed';
    if (filterStatus === 'unassigned') return !t.assignedTechnicianId && t.status !== 'Resolved' && t.status !== 'Closed';
    return true;
  });

  const grid = buildGrid(filteredTickets, centers, allTechs);

  const handleAssign = useCallback((techId: string) => {
    if (!selectedCell) return;
    const tech = allTechs.find(t => t.id === techId);
    if (!tech) return;
    const openIds = new Set(
      selectedCell.tickets
        .filter(t => t.status !== 'Resolved' && t.status !== 'Closed')
        .map(t => t.id)
    );
    const updated = tickets.map(t => {
      if (!openIds.has(t.id)) return t;
      return {
        ...t,
        assignedTechnicianId: techId,
        assignedTechnicianName: tech.name,
        status: 'Assigned' as const,
        updatedAt: new Date().toISOString(),
      };
    });
    saveTickets(updated);
    setTickets(updated);
    setSuccessMsg(`Assigned ${openIds.size} ticket${openIds.size > 1 ? 's' : ''} to ${tech.name}`);
    setSelectedCell(null);
    setTimeout(() => setSuccessMsg(null), 4000);
  }, [selectedCell, allTechs, tickets]);

  // Build / rebuild map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapRef.current) {
      mapRef.current = L.map(mapContainerRef.current, {
        center: [28.58, 77.22],
        zoom: 11,
        zoomControl: true,
      });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(mapRef.current);
    }

    const map = mapRef.current;

    // Remove old hex layers
    layersRef.current.forEach(l => map.removeLayer(l));
    layersRef.current = [];

    // Draw hexagons
    grid.forEach(cell => {
      const corners = hexCorners(cell.cLat, cell.cLng);
      const fill = hexFillColor(cell);
      const opacity = hexOpacity(cell);
      const openCount = cell.tickets.filter(t => t.status !== 'Resolved' && t.status !== 'Closed').length;

      const poly = L.polygon(corners, {
        color: openCount > 0 ? fill : '#cbd5e1',
        weight: openCount > 0 ? 1.5 : 0.5,
        fillColor: fill,
        fillOpacity: opacity,
        opacity: openCount > 0 ? 0.8 : 0.3,
      }).addTo(map);

      if (openCount > 0) {
        // Label at centre
        const label = L.divIcon({
          className: '',
          html: `<div style="background:${fill};color:white;font-weight:700;font-size:11px;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.4);border:1.5px solid white;">${openCount}</div>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        });
        const marker = L.marker([cell.cLat, cell.cLng], { icon: label }).addTo(map);
        layersRef.current.push(marker);
      }

      poly.on('click', () => setSelectedCell(cell));
      poly.on('mouseover', () => {
        if (openCount > 0) poly.setStyle({ fillOpacity: Math.min(opacity + 0.2, 0.9), weight: 2.5 });
      });
      poly.on('mouseout', () => {
        poly.setStyle({ fillOpacity: opacity, weight: openCount > 0 ? 1.5 : 0.5 });
      });

      layersRef.current.push(poly);
    });

    // Draw DC markers on top
    centers.forEach(c => {
      if (!c.latitude || !c.longitude || isNaN(c.latitude) || isNaN(c.longitude)) return;
      const icon = L.divIcon({
        className: '',
        html: `<div style="background:#0f172a;color:white;font-size:9px;font-weight:700;width:26px;height:26px;border-radius:5px;display:flex;align-items:center;justify-content:center;border:2px solid white;box-shadow:0 2px 5px rgba(0,0,0,.35)">DC</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
      const m = L.marker([c.latitude, c.longitude], { icon }).addTo(map);
      m.bindTooltip(c.name, { permanent: false, direction: 'top', className: 'text-xs' });
      layersRef.current.push(m);
    });

    // Draw technician markers
    allTechs.forEach(t => {
      if (!t.startingLatitude || !t.startingLongitude) return;
      const icon = L.divIcon({
        className: '',
        html: `<div style="background:#2563eb;color:white;font-size:10px;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.3)">🔧</div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      const m = L.marker([t.startingLatitude, t.startingLongitude], { icon }).addTo(map);
      m.bindTooltip(`${t.name} (${t.zone || t.city})`, { permanent: false, direction: 'top' });
      layersRef.current.push(m);
    });

    return () => {
      layersRef.current.forEach(l => { try { map.removeLayer(l); } catch { /**/ } });
      layersRef.current = [];
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredTickets, centers, allTechs]);

  useEffect(() => {
    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, []);

  // Summary counts
  const openTickets = tickets.filter(t => t.status !== 'Resolved' && t.status !== 'Closed');
  const unassigned = openTickets.filter(t => !t.assignedTechnicianId);
  const criticalHexes = grid.filter(c => c.tickets.some(t => t.priority === 'CRITICAL' && t.status !== 'Resolved' && t.status !== 'Closed'));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">HEX ZONE MAP</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Delhi NCR divided into service clusters. Click a hex to bulk-assign a technician.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(['all', 'open', 'unassigned'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilterStatus(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${filterStatus === f ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              {f === 'all' ? 'All Tickets' : f === 'open' ? 'Open Only' : 'Unassigned'}
            </button>
          ))}
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Open Tickets', val: openTickets.length, color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
          { label: 'Unassigned', val: unassigned.length, color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
          { label: 'Critical Zones', val: criticalHexes.length, color: 'text-red-700', bg: 'bg-red-50 border-red-200' },
          { label: 'Active Techs', val: allTechs.filter(t => t.status === 'Active').length, color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
        ].map(k => (
          <div key={k.label} className={`border rounded-xl px-4 py-3 ${k.bg}`}>
            <div className={`text-2xl font-bold ${k.color}`}>{k.val}</div>
            <div className={`text-[11px] font-semibold ${k.color} opacity-70 uppercase tracking-wide`}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Success banner */}
      {successMsg && (
        <div className="flex items-center gap-2 bg-emerald-600 text-white text-xs font-medium px-4 py-2 rounded-lg shadow-sm">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {successMsg}
        </div>
      )}

      {/* Map + Panel */}
      <div className="relative rounded-xl overflow-hidden border border-slate-200 shadow-sm bg-slate-100" style={{ height: '560px' }}>
        <div ref={mapContainerRef} className="w-full h-full z-10" />

        {/* Legend */}
        <div className="absolute bottom-3 left-3 z-[500] bg-white/95 backdrop-blur-xs px-3 py-2.5 rounded-lg border border-slate-200 shadow-sm text-xs space-y-1.5">
          <div className="font-semibold text-slate-700 mb-1">Hex Colour = Highest Priority</div>
          {[
            { color: '#dc2626', label: 'CRITICAL' },
            { color: '#ea580c', label: 'HIGH' },
            { color: '#ca8a04', label: 'MEDIUM / 3+ tickets' },
            { color: '#3b82f6', label: 'LOW / 1–2 tickets' },
          ].map(l => (
            <div key={l.label} className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-sm inline-block shrink-0" style={{ background: l.color }} />
              <span className="text-slate-600">{l.label}</span>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1 border-t border-slate-100 mt-1">
            <span className="w-3 h-3 bg-slate-900 rounded-xs inline-block shrink-0" />
            <span className="text-slate-600">Center / DC</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 bg-blue-600 rounded-full inline-block shrink-0" />
            <span className="text-slate-600">Technician base</span>
          </div>
        </div>

        {/* Assign panel */}
        {selectedCell && (
          <AssignPanel
            cell={selectedCell}
            allTechs={allTechs}
            onAssign={handleAssign}
            onClose={() => setSelectedCell(null)}
          />
        )}

        {/* Hint */}
        {!selectedCell && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[500] bg-white/90 backdrop-blur-xs px-3 py-1.5 rounded-full border border-slate-200 shadow-sm text-[11px] text-slate-500 flex items-center gap-1.5 pointer-events-none">
            <AlertTriangle className="w-3 h-3 text-amber-500" />
            Click any coloured hex to assign a technician
          </div>
        )}
      </div>

      {/* Zone table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
          <Users className="w-4 h-4 text-slate-500" />
          <span className="text-sm font-semibold text-slate-800">Active Zones Summary</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50">
              <tr>
                {['Zone', 'Centers', 'Open', 'Unassigned', 'Highest Priority', 'Based Techs'].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {grid
                .filter(c => c.tickets.length > 0 || c.centers.length > 0)
                .sort((a, b) => {
                  const ao = a.tickets.filter(t => t.status !== 'Resolved' && t.status !== 'Closed').length;
                  const bo = b.tickets.filter(t => t.status !== 'Resolved' && t.status !== 'Closed').length;
                  return bo - ao;
                })
                .map(cell => {
                  const open = cell.tickets.filter(t => t.status !== 'Resolved' && t.status !== 'Closed');
                  const unassignedCount = open.filter(t => !t.assignedTechnicianId).length;
                  const priorities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
                  const topPriority = priorities.find(p => open.some(t => t.priority === p));
                  return (
                    <tr
                      key={cell.key}
                      onClick={() => setSelectedCell(cell)}
                      className="hover:bg-blue-50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-2.5 font-mono text-slate-600">{cell.key}</td>
                      <td className="px-4 py-2.5 text-slate-700">{cell.centers.map(c => c.name.replace('_D', '')).join(', ') || '—'}</td>
                      <td className="px-4 py-2.5 font-semibold text-slate-900">{open.length}</td>
                      <td className="px-4 py-2.5">
                        {unassignedCount > 0
                          ? <span className="text-amber-700 font-semibold">{unassignedCount}</span>
                          : <span className="text-emerald-600">0 ✓</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {topPriority
                          ? <span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ background: PRIORITY_COLOR[topPriority] }}>{topPriority}</span>
                          : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{cell.techs.map(t => t.name.split(' ')[0]).join(', ') || '—'}</td>
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
