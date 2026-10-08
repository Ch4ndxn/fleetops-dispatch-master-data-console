/**
 * SmartRoutePlannerPage — Enhanced dispatcher console for Delhi NCR EV fleet
 * Multi-mode planning: Auto | Manual Override | Hybrid
 * Constraint panel · Live metrics · Leaflet map · Per-tech drag-to-reorder cards
 * AI re-optimize via Gemini (Groq fallback) · CSV / WhatsApp / JSON export
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  TechnicianRoutePlan, RouteStop, Ticket,
} from '../../types';
import {
  getTechnicians, getCenters, getTickets, getAttendance,
  saveRoutePlans, saveTickets,
} from '../../services/storage';
import { planBalancedRoutes, calculateDistanceKm } from '../../services/routeOptimizer';
import Groq from 'groq-sdk';
import {
  BrainCircuit, Zap, Map, List, Sliders, RefreshCw,
  Download, CheckCircle2, Loader2, ChevronDown, ChevronUp,
  X, Plus, GripVertical, Navigation, AlertTriangle, Home,
  Copy, FileJson, MessageSquare, Save, Sparkles, RotateCcw,
} from 'lucide-react';

// ─── Constants ────────────────────────────────────────────────────
const TECH_COLORS = [
  '#0E6B6E','#2563EB','#7C3AED','#DB2777','#D97706',
  '#16A34A','#DC2626','#0891B2','#9333EA','#EA580C',
  '#065F46','#1D4ED8','#6D28D9','#BE185D','#B45309',
];

const PRIO_CLASS: Record<string, string> = {
  CRITICAL: 'bg-rose-100 text-rose-700 border-rose-200',
  HIGH:     'bg-orange-100 text-orange-700 border-orange-200',
  MEDIUM:   'bg-amber-100 text-amber-700 border-amber-200',
  LOW:      'bg-slate-100 text-slate-600 border-slate-200',
};
const PRIO_MAP_COLOR: Record<string, string> = {
  CRITICAL: '#DC2626', HIGH: '#EA580C', MEDIUM: '#D97706', LOW: '#64748B',
};
const PRIO_ORDER: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

type PlanningMode = 'auto' | 'manual' | 'hybrid';
type ViewMode = 'cards' | 'map';

interface Constraints {
  maxStops: number;
  maxKm: number;
  priorityFilter: 'critical_high' | 'all' | 'custom';
  customPriorities: string[];
  shiftStart: string;
  shiftEnd: string;
  skillMatch: boolean;
  avoidReassignment: boolean;
}

// ─── Groq client helper ──────────────────────────────────────────
function getGroqClient(): Groq {
  let key = '';
  try { key = localStorage.getItem('fo_groq_key') || ''; } catch {}
  if (!key) key = (import.meta.env.VITE_GROQ_API_KEY as string) || '';
  if (!key) throw new Error('Groq API key not set');
  return new Groq({ apiKey: key, dangerouslyAllowBrowser: true });
}

function getGeminiKey(): string {
  let key = '';
  try { key = localStorage.getItem('fo_gemini_key') || ''; } catch {}
  if (!key) key = (import.meta.env.VITE_GEMINI_API_KEY as string) || '';
  return key;
}

// ─── Plan parsing (reuse AI route planner pattern) ───────────────
function parseAiRoutes(jsonText: string, basePlans: TechnicianRoutePlan[]): TechnicianRoutePlan[] | null {
  try {
    const match = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/) || jsonText.match(/(\[[\s\S]*\])/);
    const raw = match ? match[1].trim() : jsonText.trim();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;

    const technicians = getTechnicians();
    const centers = getCenters();
    const centerMap = new Map(centers.map(c => [c.name.trim().toLowerCase(), c]));
    const techMap = new Map(technicians.map(t => [t.employeeId.toUpperCase(), t]));

    return parsed.map((p: Record<string, unknown>, idx: number) => {
      const empId = String(p.empId || p.employeeId || '');
      const tech = techMap.get(empId.toUpperCase());
      const base = basePlans.find(b => b.employeeId.toUpperCase() === empId.toUpperCase()) || basePlans[idx];

      const stopsRaw = (p.stops as Record<string, unknown>[]) || [];
      const stops: RouteStop[] = stopsRaw.map((s: Record<string, unknown>, si: number) => {
        const centerName = String(s.center || s.centerName || '');
        const center = centerMap.get(centerName.trim().toLowerCase());
        const prevStop = si === 0 ? null : stopsRaw[si - 1];
        const prevCenterName = prevStop ? String(prevStop.center || prevStop.centerName || '') : '';
        const prevCenter = prevCenterName ? centerMap.get(prevCenterName.trim().toLowerCase()) : null;
        const prevLat = si === 0 ? (tech?.startingLatitude ?? base?.startLat ?? 28.6) : (prevCenter?.latitude ?? 28.6);
        const prevLng = si === 0 ? (tech?.startingLongitude ?? base?.startLng ?? 77.2) : (prevCenter?.longitude ?? 77.2);
        const dist = center ? calculateDistanceKm(prevLat, prevLng, center.latitude, center.longitude) : 5;
        const elapsed = 30 + si * 60 + Math.round(dist * 2.5);
        const h = Math.floor(9 + elapsed / 60), m = elapsed % 60;
        const priority = String(s.priority || 'MEDIUM') as RouteStop['priority'];
        return {
          stopOrder: si + 1,
          ticketId: String(s.ticketId || s.ticket || `TKT-${si}`),
          centerName: centerName || 'Unknown',
          vehicleNumber: String(s.vehicle || s.vehicleNumber || ''),
          issue: String(s.issue || ''),
          priority,
          latitude: center?.latitude ?? prevLat,
          longitude: center?.longitude ?? prevLng,
          estimatedArrival: String(s.eta || `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`),
          estimatedDurationMins: priority === 'CRITICAL' ? 60 : 45,
        } as RouteStop;
      });

      let totalDist = 0;
      let curLat = tech?.startingLatitude ?? base?.startLat ?? 28.6;
      let curLng = tech?.startingLongitude ?? base?.startLng ?? 77.2;
      stops.forEach(s => {
        totalDist += calculateDistanceKm(curLat, curLng, s.latitude, s.longitude);
        curLat = s.latitude; curLng = s.longitude;
      });

      return {
        technicianId:   tech?.id ?? base?.technicianId ?? `ai-${idx}`,
        technicianName: tech?.name ?? base?.technicianName ?? String(p.tech || p.name || `Tech ${idx+1}`),
        employeeId:     tech?.employeeId ?? base?.employeeId ?? empId,
        startLat: tech?.startingLatitude  ?? base?.startLat ?? 28.6,
        startLng: tech?.startingLongitude ?? base?.startLng ?? 77.2,
        defaultDc: tech?.defaultDc ?? base?.defaultDc ?? '',
        stops,
        totalDistanceKm: Math.round(totalDist * 10) / 10,
        totalEstimatedMins: stops.reduce((a, s) => a + s.estimatedDurationMins, 0) + Math.round(totalDist * 2.5),
        status: 'Draft' as const,
      } as TechnicianRoutePlan;
    }).filter((p: TechnicianRoutePlan) => p.stops.length > 0);
  } catch {
    return null;
  }
}

// ─── Recalculate plan metrics after drag/reorder ─────────────────
function recalcPlan(plan: TechnicianRoutePlan): TechnicianRoutePlan {
  let curLat = plan.startLat, curLng = plan.startLng;
  let totalDist = 0;
  const stops = plan.stops.map((s, i) => {
    const dist = calculateDistanceKm(curLat, curLng, s.latitude, s.longitude);
    totalDist += dist;
    curLat = s.latitude; curLng = s.longitude;
    const elapsed = 30 + i * 60 + Math.round(totalDist * 2.5);
    const h = Math.floor(9 + elapsed / 60), m = elapsed % 60;
    return { ...s, stopOrder: i + 1, estimatedArrival: `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}` };
  });
  return {
    ...plan, stops,
    totalDistanceKm: Math.round(totalDist * 10) / 10,
    totalEstimatedMins: stops.reduce((a, s) => a + s.estimatedDurationMins, 0) + Math.round(totalDist * 2.5),
  };
}

// ─── Apply constraints to base plan ─────────────────────────────
function applyConstraints(plans: TechnicianRoutePlan[], constraints: Constraints, allTickets: Ticket[]): {
  plans: TechnicianRoutePlan[];
  unrouted: Ticket[];
} {
  const assignedTicketIds = new Set<string>();
  const filteredPlans = plans.map(plan => {
    let stops = [...plan.stops];

    // Priority filter
    if (constraints.priorityFilter === 'critical_high') {
      stops = stops.filter(s => s.priority === 'CRITICAL' || s.priority === 'HIGH');
    } else if (constraints.priorityFilter === 'custom') {
      stops = stops.filter(s => constraints.customPriorities.includes(s.priority));
    }

    // Max stops
    stops = stops.slice(0, constraints.maxStops);

    // Max km — greedy drop from end
    let runKm = 0;
    let curLat = plan.startLat, curLng = plan.startLng;
    const keptStops: RouteStop[] = [];
    for (const s of stops) {
      const d = calculateDistanceKm(curLat, curLng, s.latitude, s.longitude);
      if (runKm + d > constraints.maxKm) break;
      runKm += d;
      curLat = s.latitude; curLng = s.longitude;
      keptStops.push(s);
    }
    stops = keptStops;

    // Avoid re-assignment
    if (constraints.avoidReassignment) {
      const centers = getCenters();
      const centerMap = new Map(centers.map(c => [c.name.trim().toLowerCase(), c]));
      void centerMap;
      const tickets = allTickets;
      stops = stops.filter(s => {
        const tk = tickets.find(t => t.ticketId === s.ticketId);
        return !tk?.assignedTechnicianId || tk.assignedTechnicianId === plan.technicianId;
      });
    }

    stops.forEach(s => assignedTicketIds.add(s.ticketId));
    const newPlan = recalcPlan({ ...plan, stops });
    return newPlan;
  }).filter(p => p.stops.length > 0);

  const unrouted = allTickets.filter(t =>
    !assignedTicketIds.has(t.ticketId) &&
    t.status !== 'Resolved' && t.status !== 'Closed'
  ).sort((a, b) => (PRIO_ORDER[b.priority] || 0) - (PRIO_ORDER[a.priority] || 0));

  return { plans: filteredPlans, unrouted };
}

// ─── Slider component ────────────────────────────────────────────
function Slider({ label, min, max, value, onChange, unit }: {
  label: string; min: number; max: number; value: number; onChange: (v: number) => void; unit?: string;
}) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-[11px] font-semibold text-slate-600">{label}</span>
        <span className="text-[11px] font-mono font-bold text-blue-700">{value}{unit}</span>
      </div>
      <input
        type="range" min={min} max={max} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1.5 accent-blue-600 cursor-pointer"
      />
    </div>
  );
}

// ─── Live metrics bar ─────────────────────────────────────────────
function MetricsBar({ plans, unrouted, streaming, kmSaved, balanceScore, timeSavedMins, shiftStartHour }: {
  plans: TechnicianRoutePlan[];
  unrouted: Ticket[];
  streaming: boolean;
  kmSaved: number;
  balanceScore: number;
  timeSavedMins: number;
  shiftStartHour: number;
}) {
  const totalKm = Math.round(plans.reduce((a, p) => a + p.totalDistanceKm, 0) * 10) / 10;
  const totalStops = plans.reduce((a, p) => a + p.stops.length, 0);
  const avgStops = plans.length ? (totalStops / plans.length).toFixed(1) : '—';
  const allOpen = getTickets().filter(t => t.status !== 'Resolved' && t.status !== 'Closed').length;
  const coveragePct = allOpen > 0 ? Math.round((totalStops / allOpen) * 100) : 0;
  const maxMins = Math.max(...plans.map(p => p.totalEstimatedMins), 0);
  const shiftStartMins = shiftStartHour * 60 + 30;
  const estCompletionH = Math.floor((shiftStartMins + maxMins) / 60);
  const estCompletionM = (shiftStartMins + maxMins) % 60;

  const stats = [
    { label: 'Fleet km', value: `${totalKm}`, unit: 'km', color: 'text-blue-700' },
    { label: 'Km saved', value: `${kmSaved}`, unit: 'km', color: kmSaved > 0 ? 'text-emerald-700' : 'text-slate-400', title: 'vs naive round-robin' },
    { label: 'Time saved', value: `${timeSavedMins}`, unit: 'min', color: timeSavedMins > 0 ? 'text-emerald-700' : 'text-slate-400', title: 'vs naive assignment' },
    { label: 'Avg stops/tech', value: avgStops, unit: '', color: 'text-violet-700' },
    { label: 'Balance', value: `${balanceScore}`, unit: '/100', color: balanceScore >= 80 ? 'text-emerald-700' : balanceScore >= 60 ? 'text-amber-700' : 'text-rose-700', title: '100 = perfect workload balance' },
    { label: 'Coverage', value: `${coveragePct}`, unit: '%', color: coveragePct >= 80 ? 'text-emerald-700' : 'text-amber-700' },
    { label: 'Unrouted', value: `${unrouted.length}`, unit: '', color: unrouted.length > 0 ? 'text-rose-700' : 'text-emerald-700' },
    { label: 'Est. complete', value: `${String(estCompletionH).padStart(2,'0')}:${String(estCompletionM).padStart(2,'0')}`, unit: '', color: 'text-slate-800' },
  ];

  return (
    <div className="flex gap-2 flex-wrap">
      {stats.map(s => (
        <div key={s.label} className="flex-1 min-w-[90px] bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-xs" title={(s as {title?: string}).title}>
          <div className="text-[9px] text-slate-400 font-semibold uppercase tracking-wider">{s.label}</div>
          <div className={`text-base font-bold font-mono mt-0.5 ${s.color} ${streaming ? 'animate-pulse' : ''}`}>
            {s.value}<span className="text-[10px] font-normal text-slate-400 ml-0.5">{s.unit}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Per-tech route card (with drag-to-reorder) ──────────────────
function TechRouteCard({
  plan, color, idx, unrouted, mode,
  onReorder, onRemoveStop, onAddStop, onExcludeStop,
}: {
  plan: TechnicianRoutePlan;
  color: string;
  idx: number;
  unrouted: Ticket[];
  mode: PlanningMode;
  onReorder: (planId: string, from: number, to: number) => void;
  onRemoveStop: (planId: string, stopOrder: number) => void;
  onAddStop: (planId: string, ticket: Ticket) => void;
  onExcludeStop: (planId: string, stopOrder: number) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showAddDropdown, setShowAddDropdown] = useState(false);
  const dragFrom = useRef<number | null>(null);
  const dragOver = useRef<number | null>(null);

  const isEditable = mode === 'manual' || mode === 'hybrid';

  function handleDragStart(i: number) { dragFrom.current = i; }
  function handleDragEnter(i: number) { dragOver.current = i; }
  function handleDragEnd() {
    if (dragFrom.current !== null && dragOver.current !== null && dragFrom.current !== dragOver.current) {
      onReorder(plan.technicianId, dragFrom.current, dragOver.current);
    }
    dragFrom.current = null; dragOver.current = null;
  }

  // running totals
  let runKm = 0, runMins = 0;
  let curLat = plan.startLat, curLng = plan.startLng;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors select-none"
        onClick={() => setExpanded(e => !e)}
        style={{ borderLeft: `4px solid ${color}` }}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0" style={{ background: color }}>
            {plan.technicianName.charAt(0)}
          </div>
          <div>
            <div className="text-sm font-bold text-slate-900">{plan.technicianName}</div>
            <div className="text-[10px] text-slate-500 font-mono">{plan.employeeId}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-xs font-bold text-slate-900 font-mono">{plan.stops.length} stops · {plan.totalDistanceKm} km</div>
            <div className="text-[10px] text-slate-500">~{Math.floor(plan.totalEstimatedMins/60)}h {plan.totalEstimatedMins%60}m</div>
          </div>
          {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </div>
      </div>

      {/* Stop list */}
      {expanded && (
        <div className="border-t border-slate-100">
          {plan.stops.map((stop, i) => {
            const segKm = calculateDistanceKm(curLat, curLng, stop.latitude, stop.longitude);
            runKm += segKm; runMins += Math.round(segKm * 2.5) + stop.estimatedDurationMins;
            curLat = stop.latitude; curLng = stop.longitude;
            const thisKm = Math.round(runKm * 10) / 10;
            const thisMins = runMins;

            return (
              <div
                key={stop.ticketId}
                draggable={isEditable}
                onDragStart={() => handleDragStart(i)}
                onDragEnter={() => handleDragEnter(i)}
                onDragEnd={handleDragEnd}
                onDragOver={e => e.preventDefault()}
                className="flex items-start gap-3 px-3 py-2.5 border-b border-slate-50 last:border-0 hover:bg-slate-50/60 transition-colors"
              >
                {isEditable && (
                  <GripVertical className="w-3.5 h-3.5 text-slate-300 shrink-0 mt-1 cursor-grab" />
                )}
                <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0 mt-0.5" style={{ background: color }}>
                  {stop.stopOrder}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-semibold text-slate-900 truncate max-w-[160px]">{stop.centerName}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${PRIO_CLASS[stop.priority] || PRIO_CLASS.LOW}`}>{stop.priority}</span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5 truncate">{stop.vehicleNumber} · {stop.issue}</div>
                  <div className="text-[10px] text-slate-400 font-mono mt-0.5">+{Math.round(segKm*10)/10}km · cumul {thisKm}km · {Math.floor(thisMins/60)}h{thisMins%60}m</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs font-mono font-bold text-blue-700">{stop.estimatedArrival}</div>
                  <div className="text-[10px] text-slate-400">{stop.estimatedDurationMins}m</div>
                  {isEditable && (
                    <div className="flex flex-col items-end gap-0.5 mt-1">
                      <button
                        onClick={e => { e.stopPropagation(); onRemoveStop(plan.technicianId, stop.stopOrder); }}
                        className="p-0.5 text-slate-300 hover:text-amber-500 transition-colors"
                        title="Remove stop (back to unrouted)"
                      >
                        <X className="w-3 h-3" />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); onExcludeStop(plan.technicianId, stop.stopOrder); }}
                        className="text-[9px] font-bold text-slate-300 hover:text-rose-600 transition-colors leading-none"
                        title="Exclude ticket from plan entirely"
                      >
                        🚫
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Add stop (manual/hybrid) */}
          {isEditable && unrouted.length > 0 && (
            <div className="px-3 py-2 border-t border-slate-100">
              <div className="relative">
                <button
                  onClick={() => setShowAddDropdown(d => !d)}
                  className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-600 hover:text-blue-700 px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Add stop from unrouted pool
                </button>
                {showAddDropdown && (
                  <div className="absolute left-0 top-7 z-30 w-72 bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                    {unrouted.slice(0, 20).map(tk => (
                      <button
                        key={tk.ticketId}
                        onClick={() => { onAddStop(plan.technicianId, tk); setShowAddDropdown(false); }}
                        className="w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0"
                      >
                        <div className="flex items-center gap-2">
                          <span className={`text-[9px] font-bold px-1 py-0.5 rounded border ${PRIO_CLASS[tk.priority]}`}>{tk.priority}</span>
                          <span className="text-xs font-semibold text-slate-900 truncate">{tk.centerName}</span>
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5 pl-6">{tk.ticketId} · {tk.vehicleNumber}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Leaflet map view ─────────────────────────────────────────────
function LeafletMapView({ plans }: { plans: TechnicianRoutePlan[] }) {
  const mapRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstance = useRef<any>(null);

  useEffect(() => {
    if (!mapRef.current) return;
    if (mapInstance.current) {
      mapInstance.current.remove();
      mapInstance.current = null;
    }

    // Dynamically load Leaflet CSS if not already loaded
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }

    // Dynamically load Leaflet JS
    const loadLeaflet = async () => {
      if (!(window as Record<string, unknown>).L) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Leaflet load failed'));
          document.head.appendChild(script);
        });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const L = (window as any).L;
      if (!mapRef.current) return;

      const map = L.map(mapRef.current, { zoomControl: true }).setView([28.55, 77.25], 11);
      mapInstance.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 18,
      }).addTo(map);

      const allLatLngs: [number, number][] = [];

      plans.forEach((plan, pi) => {
        const color = TECH_COLORS[pi % TECH_COLORS.length];

        // Home marker
        const homeIcon = L.divIcon({
          html: `<div style="background:${color};color:white;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.4)">${plan.technicianName.charAt(0)}</div>`,
          className: '',
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });
        L.marker([plan.startLat, plan.startLng], { icon: homeIcon })
          .addTo(map)
          .bindPopup(`<strong>${plan.technicianName}</strong><br/>${plan.employeeId}<br/>Base`);
        allLatLngs.push([plan.startLat, plan.startLng]);

        // Polyline
        const latlngs: [number, number][] = [[plan.startLat, plan.startLng]];
        plan.stops.forEach(s => { latlngs.push([s.latitude, s.longitude]); allLatLngs.push([s.latitude, s.longitude]); });
        if (latlngs.length > 1) {
          L.polyline(latlngs, { color, weight: 2.5, opacity: 0.75, dashArray: undefined }).addTo(map);
        }

        // Stop markers
        plan.stops.forEach(stop => {
          const pColor = PRIO_MAP_COLOR[stop.priority] || '#64748B';
          const stopIcon = L.divIcon({
            html: `<div style="background:${pColor};color:white;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:bold;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.4)">${stop.stopOrder}</div>`,
            className: '',
            iconSize: [20, 20],
            iconAnchor: [10, 10],
          });
          L.marker([stop.latitude, stop.longitude], { icon: stopIcon })
            .addTo(map)
            .bindPopup(`<strong>${stop.centerName}</strong><br/>${stop.ticketId} · ${stop.priority}<br/>ETA: ${stop.estimatedArrival}<br/>${stop.vehicleNumber}<br/>${stop.issue}`);
        });
      });

      if (allLatLngs.length > 0) {
        map.fitBounds(allLatLngs, { padding: [30, 30] });
      }
    };

    loadLeaflet().catch(console.error);
    return () => {
      if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null; }
    };
  }, [plans]);

  return (
    <div ref={mapRef} style={{ height: '100%', minHeight: '500px', borderRadius: '12px', overflow: 'hidden' }} />
  );
}

// ─── Unrouted tickets panel ──────────────────────────────────────
function UnroutedPanel({ tickets, plans, onAssign, onExclude }: {
  tickets: Ticket[];
  plans: TechnicianRoutePlan[];
  onAssign: (ticket: Ticket, techId: string) => void;
  onExclude: (ticket: Ticket) => void;
}) {
  const [assignTarget, setAssignTarget] = useState<string | null>(null);

  if (tickets.length === 0) {
    return (
      <div className="text-center py-6">
        <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
        <p className="text-xs text-slate-500">All tickets routed</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {tickets.slice(0, 30).map(tk => (
        <div key={tk.ticketId} className="bg-white border border-slate-200 rounded-lg p-2.5 shadow-xs">
          <div className="flex items-center gap-1.5 mb-1">
            <span className={`text-[9px] font-bold px-1 py-0.5 rounded border ${PRIO_CLASS[tk.priority]}`}>{tk.priority}</span>
            <span className="text-[11px] font-semibold text-slate-900 truncate">{tk.centerName}</span>
          </div>
          <div className="text-[10px] text-slate-500 truncate mb-1.5">{tk.ticketId} · {tk.vehicleNumber}</div>
          {assignTarget === tk.ticketId ? (
            <div className="flex flex-col gap-1">
              {plans.map(p => (
                <button
                  key={p.technicianId}
                  onClick={() => { onAssign(tk, p.technicianId); setAssignTarget(null); }}
                  className="text-left text-[10px] font-medium px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                >
                  → {p.technicianName} ({p.stops.length} stops)
                </button>
              ))}
              <button onClick={() => setAssignTarget(null)} className="text-[10px] text-slate-400 hover:text-slate-600">cancel</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setAssignTarget(tk.ticketId)}
                className="text-[10px] font-semibold text-blue-600 hover:text-blue-700"
              >
                <Plus className="w-3 h-3 inline mr-0.5" />Assign
              </button>
              <button
                onClick={() => onExclude(tk)}
                className="text-[10px] font-semibold text-rose-500 hover:text-rose-700"
                title="Exclude from plan"
              >
                🚫 Exclude
              </button>
            </div>
          )}
        </div>
      ))}
      {tickets.length > 30 && (
        <p className="text-[10px] text-slate-400 text-center">+{tickets.length - 30} more</p>
      )}
    </div>
  );
}

// ─── Excluded tickets panel ───────────────────────────────────────
function ExcludedPanel({ tickets, onRestore }: {
  tickets: Ticket[];
  onRestore: (ticket: Ticket) => void;
}) {
  if (tickets.length === 0) return null;
  return (
    <div className="space-y-1">
      {tickets.map(tk => (
        <div key={tk.ticketId} className="bg-rose-50 border border-rose-200 rounded-lg p-2.5 opacity-80">
          <div className="flex items-center gap-1.5 mb-1">
            <span className={`text-[9px] font-bold px-1 py-0.5 rounded border ${PRIO_CLASS[tk.priority]}`}>{tk.priority}</span>
            <span className="text-[11px] font-semibold text-slate-700 truncate line-through">{tk.centerName}</span>
          </div>
          <div className="text-[10px] text-slate-400 truncate mb-1.5">{tk.ticketId}</div>
          <button
            onClick={() => onRestore(tk)}
            className="text-[10px] font-semibold text-emerald-600 hover:text-emerald-700"
            title="Restore to unrouted pool"
          >
            ↩ Restore
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────
export const SmartRoutePlannerPage: React.FC = () => {
  const [mode, setMode] = useState<PlanningMode>('auto');
  const [view, setView] = useState<ViewMode>('cards');
  const [phase, setPhase] = useState<'idle' | 'building' | 'ai' | 'done' | 'error'>('idle');
  const [basePlans, setBasePlans] = useState<TechnicianRoutePlan[]>([]);
  const [plans, setPlans] = useState<TechnicianRoutePlan[]>([]);
  const [unrouted, setUnrouted] = useState<Ticket[]>([]);
  const [excludedTickets, setExcludedTickets] = useState<Ticket[]>([]);
  const [kmSaved, setKmSaved] = useState(0);
  const [balanceScore, setBalanceScore] = useState(0);
  const [timeSavedMins, setTimeSavedMins] = useState(0);
  const [streamLog, setStreamLog] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [toast, setToast] = useState('');
  const [aiStreamActive, setAiStreamActive] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const [constraints, setConstraints] = useState<Constraints>({
    maxStops: 8,
    maxKm: 80,
    priorityFilter: 'all',
    customPriorities: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
    shiftStart: '09:00',
    shiftEnd: '18:00',
    skillMatch: false,
    avoidReassignment: false,
  });

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [streamLog]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  // Rebuild unrouted when plans change (excluding already-excluded tickets)
  const rebuildUnrouted = useCallback((currentPlans: TechnicianRoutePlan[], excluded: Ticket[] = []) => {
    const assignedIds = new Set(currentPlans.flatMap(p => p.stops.map(s => s.ticketId)));
    const excludedIds = new Set(excluded.map(t => t.ticketId));
    const allTickets = getTickets();
    const ur = allTickets
      .filter(t => !assignedIds.has(t.ticketId) && !excludedIds.has(t.ticketId) && t.status !== 'Resolved' && t.status !== 'Closed')
      .sort((a, b) => (PRIO_ORDER[b.priority] || 0) - (PRIO_ORDER[a.priority] || 0));
    setUnrouted(ur);
  }, []);

  // ── Build base plan ──────────────────────────────────────────
  async function handleBuild() {
    setPhase('building');
    setError('');
    setStreamLog('');
    setSaved(false);

    await new Promise(r => setTimeout(r, 100));

    // Parse shift times from HH:MM strings
    const [startH] = constraints.shiftStart.split(':').map(Number);
    const [endH]   = constraints.shiftEnd.split(':').map(Number);

    const excludedIds = new Set(excludedTickets.map(t => t.ticketId));

    const result = planBalancedRoutes({
      maxStopsPerTech: constraints.maxStops,
      maxKmPerTech:    constraints.maxKm,
      priorityFilter:  constraints.priorityFilter === 'critical_high' ? 'critical_high' : 'all',
      skillMatch:      constraints.skillMatch,
      shiftStartHour:  isNaN(startH) ? 9  : startH,
      shiftEndHour:    isNaN(endH)   ? 18 : endH,
      excludedTicketIds: excludedIds,
    });

    if (result.plans.length === 0) {
      setError('No routable tickets or available technicians. Import data and ensure technicians have coordinates.');
      setPhase('error');
      return;
    }

    // Apply avoid-reassignment constraint on top (not in balanced planner)
    let finalPlans = result.plans;
    if (constraints.avoidReassignment) {
      const allTickets = getTickets();
      finalPlans = finalPlans.map(plan => ({
        ...plan,
        stops: plan.stops.filter(s => {
          const tk = allTickets.find(t => t.ticketId === s.ticketId);
          return !tk?.assignedTechnicianId || tk.assignedTechnicianId === plan.technicianId;
        }),
      })).filter(p => p.stops.length > 0);
    }

    setBasePlans(finalPlans);
    setKmSaved(result.kmSaved);
    setBalanceScore(result.balanceScore);
    setTimeSavedMins(result.timeSavedMins);

    // Rebuild unrouted accounting for avoid-reassignment filter and excluded tickets
    const assignedIds = new Set(finalPlans.flatMap(p => p.stops.map(s => s.ticketId)));
    const ur = [...result.unrouted, ...getTickets().filter(t =>
      !assignedIds.has(t.ticketId) && t.status !== 'Resolved' && t.status !== 'Closed' &&
      !excludedIds.has(t.ticketId) &&
      !result.unrouted.find(u => u.ticketId === t.ticketId)
    )].sort((a, b) => (PRIO_ORDER[b.priority] || 0) - (PRIO_ORDER[a.priority] || 0));
    setUnrouted(ur);

    if (mode === 'auto' || mode === 'manual') {
      setPlans(finalPlans);
      setPhase('done');
    } else {
      // hybrid: build base, then ask AI to improve
      setPlans(finalPlans);
      setPhase('ai');
      await runAiOptimize(finalPlans, finalPlans);
    }
  }

  // ── AI optimization ─────────────────────────────────────────
  async function runAiOptimize(currentPlans: TechnicianRoutePlan[], base: TechnicianRoutePlan[]) {
    setAiStreamActive(true);
    setStreamLog('');

    const technicians = getTechnicians();
    const centers = getCenters();
    const allTickets = getTickets();
    const attendance = getAttendance();
    const today = new Date().toISOString().split('T')[0];
    const centerMap = new Map(centers.map(c => [c.name.trim().toLowerCase(), c]));
    const presentTechs = technicians.filter(t => {
      if (t.status !== 'Active') return false;
      const att = attendance.find(a => a.employeeId.toUpperCase() === t.employeeId.toUpperCase() && a.date === today);
      return !att || att.status === 'Present' || att.status === 'Half-Day';
    });
    const openTickets = allTickets.filter(t => t.status !== 'Resolved' && t.status !== 'Closed');

    const systemPrompt = `You are an expert field operations dispatcher for a Delhi NCR electric vehicle (EV) fleet.
Given a current route plan and constraints, produce an IMPROVED plan staying within constraints.

Constraints:
- Max stops per tech: ${constraints.maxStops}
- Max km per tech: ${constraints.maxKm}
- Priority filter: ${constraints.priorityFilter}
- Shift: ${constraints.shiftStart}–${constraints.shiftEnd}
- Skill matching enforced: ${constraints.skillMatch}

Rules:
1. CRITICAL tickets must be first stop for nearest qualified tech
2. Keep techs in their home zone; minimise cross-zone travel
3. Specialisation: Battery Specialist → battery issues; Electrical → electrical; General can handle all
4. Delhi-Gurgaon NH48 congested 08–10am (1.5x); Noida-Delhi via Mayur Vihar 09–11am (1.5x)
5. Respect max stops and max km limits strictly
6. Return unrouted tickets as a flat list at the end

OUTPUT: strict JSON array, no prose outside the block:
\`\`\`json
[{"empId":"NCR-1101","tech":"Mohit","stops":[{"ticketId":"INC001","center":"Delhi_Badharpur_D","vehicle":"DL1VW2345","issue":"Battery","priority":"CRITICAL","eta":"09:30"}]}]
\`\`\`
After the JSON, write REASONING (max 200 words).`;

    const userMsg = `TODAY: ${today}
TECHS: ${presentTechs.map(t => `${t.name}(${t.employeeId})|${t.city}|${t.zone}|${t.specialisation}`).join('; ')}
OPEN TICKETS (${openTickets.length}): ${openTickets.slice(0,30).map(t => { const c = centerMap.get(t.centerName.trim().toLowerCase()); return `[${t.ticketId}]${t.priority}|${t.centerName}|${t.vehicleNumber}|${t.issue}|lat:${c?.latitude?.toFixed(3)}|lng:${c?.longitude?.toFixed(3)}`; }).join('\n')}
CURRENT PLAN: ${currentPlans.map(p => `${p.technicianName}(${p.employeeId}): ${p.stops.map(s => `${s.stopOrder}.${s.ticketId}@${s.centerName}(${s.priority},${s.estimatedArrival})`).join('→')} | ${p.totalDistanceKm}km`).join('\n')}
BASE PLAN KM: ${base.reduce((a,p)=>a+p.totalDistanceKm,0).toFixed(1)}km total

Optimize within constraints.`;

    let fullText = '';
    const geminiKey = getGeminiKey();

    try {
      if (!geminiKey) throw new Error('no-key');
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse&key=${geminiKey}`;
      const res = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userMsg }] }],
          generationConfig: { maxOutputTokens: 2048, temperature: 0.2 },
        }),
      });
      if (!res.ok) throw new Error(`Gemini ${res.status}`);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') break;
          try {
            const j = JSON.parse(data);
            const t = j?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            fullText += t; setStreamLog(fullText);
          } catch {}
        }
      }
    } catch {
      // Groq fallback
      try {
        const client = getGroqClient();
        const stream = await client.chat.completions.create({
          model: 'llama3-70b-8192',
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMsg }],
          stream: true, max_tokens: 2048, temperature: 0.2,
        });
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content || '';
          fullText += delta; setStreamLog(fullText);
        }
      } catch (groqErr: unknown) {
        const msg = groqErr instanceof Error ? groqErr.message : String(groqErr);
        setError(`AI optimization failed: ${msg}`);
        setPhase('error'); setAiStreamActive(false);
        return;
      }
    }

    const aiRoutes = parseAiRoutes(fullText, base);
    if (aiRoutes && aiRoutes.length > 0) {
      // Re-apply constraints to AI output
      const { plans: final, unrouted: ur } = applyConstraints(aiRoutes, constraints, getTickets());
      setPlans(final);
      setUnrouted(ur);
    }
    setAiStreamActive(false);
    setPhase('done');
  }

  // ── Drag-to-reorder handler ──────────────────────────────────
  function handleReorder(techId: string, from: number, to: number) {
    setPlans(prev => {
      return prev.map(p => {
        if (p.technicianId !== techId) return p;
        const stops = [...p.stops];
        const [moved] = stops.splice(from, 1);
        stops.splice(to, 0, moved);
        return recalcPlan({ ...p, stops });
      });
    });
  }

  // ── Remove stop → back to unrouted ──────────────────────────
  function handleRemoveStop(techId: string, stopOrder: number) {
    let removedTicketId = '';
    setPlans(prev => {
      return prev.map(p => {
        if (p.technicianId !== techId) return p;
        const stop = p.stops.find(s => s.stopOrder === stopOrder);
        if (stop) removedTicketId = stop.ticketId;
        const stops = p.stops.filter(s => s.stopOrder !== stopOrder);
        return recalcPlan({ ...p, stops });
      });
    });
    if (removedTicketId) {
      const tk = getTickets().find(t => t.ticketId === removedTicketId);
      if (tk) setUnrouted(prev => [tk, ...prev].sort((a, b) => (PRIO_ORDER[b.priority]||0) - (PRIO_ORDER[a.priority]||0)));
    }
  }

  // ── Add stop from unrouted pool ──────────────────────────────
  function handleAddStop(techId: string, ticket: Ticket) {
    const centers = getCenters();
    const centerMap = new Map(centers.map(c => [c.name.trim().toLowerCase(), c]));
    const center = centerMap.get(ticket.centerName.trim().toLowerCase());
    if (!center) { showToast('Center coordinates not found for this ticket'); return; }

    setPlans(prev => {
      return prev.map(p => {
        if (p.technicianId !== techId) return p;
        const newStop: RouteStop = {
          stopOrder: p.stops.length + 1,
          ticketId: ticket.ticketId,
          centerName: ticket.centerName,
          vehicleNumber: ticket.vehicleNumber,
          issue: ticket.issue,
          priority: ticket.priority,
          latitude: center.latitude,
          longitude: center.longitude,
          estimatedArrival: '—',
          estimatedDurationMins: ticket.priority === 'CRITICAL' ? 60 : 45,
        };
        return recalcPlan({ ...p, stops: [...p.stops, newStop] });
      });
    });
    setUnrouted(prev => prev.filter(t => t.ticketId !== ticket.ticketId));
  }

  // ── Assign unrouted ticket to tech ──────────────────────────
  function handleAssignFromPanel(ticket: Ticket, techId: string) {
    handleAddStop(techId, ticket);
  }

  // ── Exclude ticket from plan (from unrouted pool or from a stop) ─
  function handleExcludeTicket(ticket: Ticket) {
    setExcludedTickets(prev => {
      if (prev.find(t => t.ticketId === ticket.ticketId)) return prev;
      return [...prev, ticket];
    });
    setUnrouted(prev => prev.filter(t => t.ticketId !== ticket.ticketId));
  }

  // ── Exclude stop (remove from route AND add to excluded pool) ────
  function handleExcludeStop(techId: string, stopOrder: number) {
    let removedTicket: Ticket | null = null;
    setPlans(prev => prev.map(p => {
      if (p.technicianId !== techId) return p;
      const stop = p.stops.find(s => s.stopOrder === stopOrder);
      if (stop) {
        const tk = getTickets().find(t => t.ticketId === stop.ticketId);
        if (tk) removedTicket = tk;
      }
      const stops = p.stops.filter(s => s.stopOrder !== stopOrder);
      return recalcPlan({ ...p, stops });
    }));
    if (removedTicket) {
      handleExcludeTicket(removedTicket);
    }
  }

  // ── Restore excluded ticket back to unrouted pool ────────────────
  function handleRestoreTicket(ticket: Ticket) {
    setExcludedTickets(prev => prev.filter(t => t.ticketId !== ticket.ticketId));
    setUnrouted(prev => {
      if (prev.find(t => t.ticketId === ticket.ticketId)) return prev;
      return [...prev, ticket].sort((a, b) => (PRIO_ORDER[b.priority] || 0) - (PRIO_ORDER[a.priority] || 0));
    });
  }

  // ── Re-optimize current plan ─────────────────────────────────
  async function handleReOptimize() {
    setPhase('ai');
    setStreamLog('');
    setSaved(false);
    await runAiOptimize(plans, basePlans.length > 0 ? basePlans : plans);
  }

  // ── Save plan ────────────────────────────────────────────────
  function handleSave() {
    const confirmed = plans.map(p => ({ ...p, status: 'Confirmed' as const }));
    saveRoutePlans(confirmed);
    const dateStr = new Date().toISOString().split('T')[0];
    try { localStorage.setItem(`fo_route_plan_${dateStr}`, JSON.stringify(confirmed)); } catch {}

    const allTickets = getTickets();
    const updated = allTickets.map(tk => {
      for (const plan of plans) {
        const stop = plan.stops.find(s => s.ticketId === tk.ticketId);
        if (stop) return { ...tk, assignedTechnicianId: plan.technicianId, assignedTechnicianName: plan.technicianName, status: 'Assigned' as const, scheduledSlot: stop.estimatedArrival, updatedAt: new Date().toISOString() };
      }
      return tk;
    });
    saveTickets(updated);
    setSaved(true);
    showToast(`Plan saved as fo_route_plan_${dateStr}`);
  }

  // ── Export CSV ───────────────────────────────────────────────
  function handleExportCsv() {
    const rows = ['Technician,EmpID,Stop,TicketID,Center,Vehicle,Issue,Priority,ETA,TotalKm'];
    plans.forEach(p => p.stops.forEach(s =>
      rows.push(`"${p.technicianName}","${p.employeeId}",${s.stopOrder},"${s.ticketId}","${s.centerName}","${s.vehicleNumber}","${s.issue}",${s.priority},${s.estimatedArrival},${p.totalDistanceKm}`)
    ));
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `smart_routes_${new Date().toISOString().split('T')[0]}.csv`; a.click();
  }

  // ── Export WhatsApp ──────────────────────────────────────────
  function handleExportWhatsApp() {
    const lines: string[] = [`*FleetOps Routes — ${new Date().toLocaleDateString('en-IN')}*\n`];
    plans.forEach((p, i) => {
      lines.push(`*${i+1}. ${p.technicianName} (${p.employeeId})*`);
      lines.push(`Stops: ${p.stops.length} | Distance: ${p.totalDistanceKm} km`);
      p.stops.forEach(s => {
        lines.push(`  ${s.stopOrder}. ${s.centerName} — ${s.ticketId} [${s.priority}] ETA ${s.estimatedArrival}`);
      });
      lines.push('');
    });
    navigator.clipboard.writeText(lines.join('\n')).then(() => showToast('WhatsApp format copied to clipboard!'));
  }

  // ── Export JSON ──────────────────────────────────────────────
  function handleExportJson() {
    const blob = new Blob([JSON.stringify(plans, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `smart_routes_${new Date().toISOString().split('T')[0]}.json`; a.click();
  }

  // ── Constraint updater helpers ───────────────────────────────
  function setC<K extends keyof Constraints>(k: K, v: Constraints[K]) {
    setConstraints(prev => ({ ...prev, [k]: v }));
  }

  const isRunning = phase === 'building' || phase === 'ai';

  return (
    <div className="flex h-full" style={{ minHeight: 0 }}>
      {/* ── Left sidebar: constraints + unrouted ───────────────── */}
      <aside className="w-[280px] shrink-0 bg-slate-900 text-white flex flex-col h-full overflow-y-auto border-r border-slate-800">
        {/* Sidebar header */}
        <div className="px-4 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2 mb-0.5">
            <Sliders className="w-4 h-4 text-blue-400" />
            <span className="text-sm font-bold text-white">Constraints</span>
          </div>
          <p className="text-[10px] text-slate-400">Limits applied to each route</p>
        </div>

        <div className="px-4 py-4 space-y-4 border-b border-slate-800">
          <Slider label="Max stops / tech" min={1} max={15} value={constraints.maxStops} onChange={v => setC('maxStops', v)} />
          <Slider label="Max km / tech" min={10} max={200} value={constraints.maxKm} onChange={v => setC('maxKm', v)} unit=" km" />

          <div>
            <label className="text-[11px] font-semibold text-slate-400 block mb-1">Priority filter</label>
            <select
              value={constraints.priorityFilter}
              onChange={e => setC('priorityFilter', e.target.value as Constraints['priorityFilter'])}
              className="w-full text-xs bg-slate-800 border border-slate-700 text-white rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-500"
            >
              <option value="critical_high">CRITICAL + HIGH only</option>
              <option value="all">All priorities</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-semibold text-slate-400 block mb-1">Shift start</label>
              <input type="time" value={constraints.shiftStart} onChange={e => setC('shiftStart', e.target.value)}
                className="w-full text-xs bg-slate-800 border border-slate-700 text-white rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-500" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-400 block mb-1">Shift end</label>
              <input type="time" value={constraints.shiftEnd} onChange={e => setC('shiftEnd', e.target.value)}
                className="w-full text-xs bg-slate-800 border border-slate-700 text-white rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-500" />
            </div>
          </div>

          <div className="space-y-2">
            {[
              { key: 'skillMatch' as const, label: 'Enforce skill matching' },
              { key: 'avoidReassignment' as const, label: 'Avoid re-assignment' },
            ].map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <div
                  onClick={() => setC(key, !constraints[key])}
                  className={`w-8 h-4 rounded-full transition-colors cursor-pointer flex items-center ${constraints[key] ? 'bg-blue-500' : 'bg-slate-700'}`}
                >
                  <div className={`w-3 h-3 bg-white rounded-full transition-transform mx-0.5 ${constraints[key] ? 'translate-x-4' : ''}`} />
                </div>
                <span className="text-[11px] text-slate-300">{label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Unrouted tickets */}
        <div className="px-4 py-3 border-b border-slate-800">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-slate-300">Unrouted tickets</span>
            <span className="text-[11px] font-mono font-bold text-rose-400">{unrouted.length}</span>
          </div>
        </div>
        <div className="overflow-y-auto px-3 py-3" style={{ maxHeight: excludedTickets.length > 0 ? '40%' : undefined, flex: excludedTickets.length > 0 ? 'none' : 1 }}>
          <UnroutedPanel tickets={unrouted} plans={plans} onAssign={handleAssignFromPanel} onExclude={handleExcludeTicket} />
        </div>

        {/* Excluded tickets */}
        {excludedTickets.length > 0 && (
          <>
            <div className="px-4 py-2 border-t border-slate-700 border-b border-slate-800 bg-slate-800/50">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-rose-400 flex items-center gap-1">
                  🚫 Excluded
                </span>
                <span className="text-[11px] font-mono font-bold text-rose-400">{excludedTickets.length}</span>
              </div>
              <p className="text-[9px] text-slate-500 mt-0.5">Skipped in next Rebuild</p>
            </div>
            <div className="overflow-y-auto px-3 py-3" style={{ maxHeight: '30%' }}>
              <ExcludedPanel tickets={excludedTickets} onRestore={handleRestoreTicket} />
            </div>
          </>
        )}
      </aside>

      {/* ── Main content ────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-100 bg-white shrink-0 flex-wrap">
          <div>
            <h1 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Navigation className="w-4 h-4 text-blue-600" />
              Smart Route Planner
            </h1>
            <p className="text-[10px] text-slate-400">Multi-mode dispatch console · Delhi NCR EV Fleet</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {phase === 'done' && (
              <>
                <button onClick={handleExportCsv} className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg border border-slate-200 transition-colors">
                  <Download className="w-3 h-3" /> CSV
                </button>
                <button onClick={handleExportWhatsApp} className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold bg-green-50 hover:bg-green-100 text-green-700 rounded-lg border border-green-200 transition-colors">
                  <MessageSquare className="w-3 h-3" /> WhatsApp
                </button>
                <button onClick={handleExportJson} className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg border border-slate-200 transition-colors">
                  <FileJson className="w-3 h-3" /> JSON
                </button>
                <button onClick={handleReOptimize} disabled={isRunning} className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold bg-violet-50 hover:bg-violet-100 text-violet-700 rounded-lg border border-violet-200 transition-colors disabled:opacity-50">
                  <Sparkles className="w-3 h-3" /> AI Re-optimize
                </button>
                {saved ? (
                  <span className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold bg-emerald-100 text-emerald-700 rounded-lg border border-emerald-200">
                    <CheckCircle2 className="w-3 h-3" /> Saved
                  </span>
                ) : (
                  <button onClick={handleSave} className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors">
                    <Save className="w-3 h-3" /> Save Plan
                  </button>
                )}
              </>
            )}
            <button
              onClick={handleBuild}
              disabled={isRunning}
              className="flex items-center gap-2 px-3.5 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-lg transition-colors shadow-xs"
            >
              {phase === 'building' ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Building…</> :
               phase === 'ai' ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> AI optimising…</> :
               <><Zap className="w-3.5 h-3.5" /> {phase === 'done' ? 'Rebuild' : 'Build Routes'}</>}
            </button>
          </div>
        </div>

        {/* Mode tabs */}
        <div className="flex items-center gap-1 px-5 py-2 border-b border-slate-100 bg-white shrink-0">
          {([
            { key: 'auto', label: 'Auto', icon: <Zap className="w-3 h-3" />, desc: 'AI picks everything' },
            { key: 'manual', label: 'Manual Override', icon: <GripVertical className="w-3 h-3" />, desc: 'Drag to edit routes' },
            { key: 'hybrid', label: 'Hybrid', icon: <Sparkles className="w-3 h-3" />, desc: 'AI plan + edit' },
          ] as const).map(m => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${mode === m.key ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              title={m.desc}
            >
              {m.icon}{m.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-1">
            <button onClick={() => setView('cards')} className={`p-1.5 rounded-lg transition-colors ${view === 'cards' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`} title="Card view">
              <List className="w-4 h-4" />
            </button>
            <button onClick={() => setView('map')} className={`p-1.5 rounded-lg transition-colors ${view === 'map' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`} title="Map view">
              <Map className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Metrics bar */}
        {phase === 'done' && (
          <div className="px-5 py-2 bg-slate-50 border-b border-slate-100 shrink-0">
            <MetricsBar
              plans={plans}
              unrouted={unrouted}
              streaming={aiStreamActive}
              kmSaved={kmSaved}
              balanceScore={balanceScore}
              timeSavedMins={timeSavedMins}
              shiftStartHour={parseInt(constraints.shiftStart.split(':')[0]) || 9}
            />
          </div>
        )}

        {/* Error */}
        {phase === 'error' && (
          <div className="mx-5 mt-4 flex items-start gap-2.5 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
            <div><strong>Error:</strong> {error}</div>
          </div>
        )}

        {/* Main scrollable content */}
        <div className="flex-1 overflow-y-auto min-h-0 p-5">
          {/* Idle state */}
          {phase === 'idle' && (
            <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
              <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center">
                <Navigation className="w-8 h-8 text-blue-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 mb-1">Smart Route Planner</h3>
                <p className="text-sm text-slate-500 max-w-md leading-relaxed">
                  Choose a mode, set constraints in the left panel, then click <strong>Build Routes</strong> to generate optimised dispatch routes for today's open tickets.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-4 max-w-xl text-left">
                {[
                  { icon: <Zap className="w-4 h-4 text-blue-600" />, title: 'Auto', desc: 'AI optimises the full plan using skill matching and zone clustering' },
                  { icon: <GripVertical className="w-4 h-4 text-violet-600" />, title: 'Manual', desc: 'Drag-and-drop stops between techs, add or remove as needed' },
                  { icon: <Sparkles className="w-4 h-4 text-amber-600" />, title: 'Hybrid', desc: 'AI-generated base plan that you refine before saving' },
                ].map(f => (
                  <div key={f.title} className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                    {f.icon}
                    <div className="text-xs font-bold text-slate-800 mt-1.5">{f.title}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">{f.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI stream log */}
          {(phase === 'ai' || aiStreamActive) && streamLog && (
            <div className="bg-slate-900 rounded-xl overflow-hidden mb-4">
              <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-700">
                <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                <span className="text-xs font-mono text-slate-400">Gemini → Groq fallback · streaming</span>
              </div>
              <div ref={logRef} className="px-4 py-3 text-[11px] font-mono text-slate-300 max-h-40 overflow-y-auto leading-relaxed whitespace-pre-wrap">
                {streamLog}
              </div>
            </div>
          )}

          {/* Map view */}
          {phase === 'done' && view === 'map' && plans.length > 0 && (
            <div style={{ height: 'calc(100vh - 240px)', minHeight: '400px' }}>
              <LeafletMapView plans={plans} />
            </div>
          )}

          {/* Card view */}
          {phase === 'done' && view === 'cards' && plans.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {plans.map((plan, idx) => (
                <TechRouteCard
                  key={plan.technicianId}
                  plan={plan}
                  color={TECH_COLORS[idx % TECH_COLORS.length]}
                  idx={idx}
                  unrouted={unrouted}
                  mode={mode}
                  onReorder={handleReorder}
                  onRemoveStop={handleRemoveStop}
                  onAddStop={handleAddStop}
                  onExcludeStop={handleExcludeStop}
                />
              ))}
            </div>
          )}

          {phase === 'done' && plans.length === 0 && (
            <div className="text-center py-12">
              <RotateCcw className="w-8 h-8 text-slate-300 mx-auto mb-3" />
              <p className="text-sm text-slate-500">No routes generated — try relaxing constraints or importing tickets.</p>
            </div>
          )}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white text-xs font-medium px-4 py-2.5 rounded-xl shadow-xl flex items-center gap-2 animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          {toast}
        </div>
      )}
    </div>
  );
};
