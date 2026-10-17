/**
 * LiveTrackingPage — dispatcher view
 *
 * Shows:
 *   • Planned routes (from saved route plans) overlaid on the map
 *   • Live GPS dots for techs streaming their position via TechTrackerPage
 *
 * Data flow:
 *   TechTrackerPage (tech's phone)
 *     → upserts to Supabase  tech_locations  table
 *       → Supabase Realtime broadcasts INSERT/UPDATE
 *         → LiveTrackingPage receives event → updates live dot on map
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as L from 'leaflet';
import {
  getCenters, getTechnicians, getRoutePlans, subscribeToDataChanges,
} from '../../services/storage';
import { supabase } from '../../lib/supabase';
import { Center, Technician, TechnicianRoutePlan } from '../../types';
import { Radio, Wifi, WifiOff, Copy, ExternalLink, MapPin } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────
interface LiveLocation {
  employee_id: string;
  tech_name:   string;
  lat:         number;
  lng:         number;
  accuracy:    number;
  updated_at:  string;
}

// ── Constants ────────────────────────────────────────────────────
const ROUTE_COLORS = [
  '#2563eb', '#16a34a', '#d97706', '#9333ea',
  '#dc2626', '#0891b2', '#c026d3', '#ea580c',
];

const STALE_MS = 5 * 60 * 1000; // 5 min — dot turns grey

// ── Live dot icon ────────────────────────────────────────────────
function liveDotHtml(initials: string, color: string, isStale: boolean): string {
  const bg = isStale ? '#64748b' : color;
  return `
    <div style="position:relative;display:flex;flex-direction:column;align-items:center;gap:2px">
      ${!isStale ? `
        <div style="position:absolute;top:0;left:0;width:36px;height:36px;border-radius:50%;
          background:${color};opacity:0.3;animation:fo-ping 1.5s cubic-bezier(0,0,0.2,1) infinite"></div>` : ''}
      <div style="
        position:relative;
        background:${bg};
        width:36px;height:36px;border-radius:50%;
        display:flex;align-items:center;justify-content:center;
        border:3px solid #fff;
        box-shadow:0 3px 10px rgba(0,0,0,0.4);
        color:#fff;font-size:12px;font-weight:700;font-family:sans-serif;
        z-index:1;
      ">${initials}</div>
      <div style="
        background:rgba(255,255,255,0.95);color:#1e293b;
        font-size:9px;font-weight:600;font-family:sans-serif;
        padding:1px 5px;border-radius:3px;
        box-shadow:0 1px 3px rgba(0,0,0,0.2);white-space:nowrap;
      ">${isStale ? '⏸ offline' : '● LIVE'}</div>
    </div>`;
}

// ── Ping animation injection ──────────────────────────────────────
function ensurePingStyle() {
  if (document.getElementById('fo-live-ping')) return;
  const s = document.createElement('style');
  s.id = 'fo-live-ping';
  s.textContent = `@keyframes fo-ping { 75%,100% { transform:scale(2.2); opacity:0; } }`;
  document.head.appendChild(s);
}

// ── Helpers ──────────────────────────────────────────────────────
function techInitials(name: string): string {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function techColor(employeeId: string, allIds: string[]): string {
  const idx = allIds.indexOf(employeeId);
  return ROUTE_COLORS[(idx >= 0 ? idx : hashStr(employeeId)) % ROUTE_COLORS.length];
}

function timeSince(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}

// ── Main component ────────────────────────────────────────────────
export const LiveTrackingPage: React.FC = () => {
  // Local data
  const [centers, setCenters]         = useState<Center[]>(() => getCenters());
  const [technicians, setTechnicians] = useState<Technician[]>(() => getTechnicians());
  const [routePlans, setRoutePlans]   = useState<TechnicianRoutePlan[]>(() => getRoutePlans());

  // Live GPS state
  const [liveLocations, setLiveLocations] = useState<Map<string, LiveLocation>>(new Map());
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'connected' | 'error' | 'disabled'>('connecting');
  const [selectedEid, setSelectedEid] = useState<string | null>(null);
  const [, setTick] = useState(0);

  // Map refs
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef          = useRef<L.Map | null>(null);
  const liveLayerRef    = useRef<L.LayerGroup | null>(null);

  // ── Subscribe to localStorage changes ──────────────────────────
  useEffect(() => subscribeToDataChanges(() => {
    setCenters(getCenters());
    setTechnicians(getTechnicians());
    setRoutePlans(getRoutePlans());
  }), []);

  // ── Tick every 30 s for "X ago" freshness labels ──────────────
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // ── Supabase Realtime subscription ────────────────────────────
  useEffect(() => {
    if (!supabase) { setRealtimeStatus('disabled'); return; }

    setRealtimeStatus('connecting');

    // Initial snapshot
    void supabase
      .from('tech_locations')
      .select('*')
      .then(({ data, error }) => {
        if (error) { console.error('[LiveTracking] fetch', error); return; }
        if (!data) return;
        setLiveLocations(prev => {
          const m = new Map(prev);
          (data as LiveLocation[]).forEach(row => m.set(row.employee_id, row));
          return m;
        });
      });

    // Realtime changes
    const channel = supabase
      .channel('tech_locations_live')
      .on(
        'postgres_changes' as Parameters<typeof supabase.channel>[0] extends never ? never : never,
        { event: '*', schema: 'public', table: 'tech_locations' } as Parameters<ReturnType<typeof supabase.channel>['on']>[1],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          const row = (payload.new ?? payload.old) as LiveLocation;
          if (!row?.employee_id) return;
          setLiveLocations(prev => {
            const m = new Map(prev);
            if (payload.eventType === 'DELETE') m.delete(row.employee_id);
            else m.set(row.employee_id, row);
            return m;
          });
        }
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .subscribe((status: any) => {
        if (status === 'SUBSCRIBED') setRealtimeStatus('connected');
        else if (status === 'CHANNEL_ERROR') setRealtimeStatus('error');
      });

    return () => { void supabase!.removeChannel(channel); };
  }, []);

  // ── Build base map once ───────────────────────────────────────
  useEffect(() => {
    ensurePingStyle();
    if (!mapContainerRef.current || mapRef.current) return;

    const CITY_CENTERS: Record<string, [number, number]> = {
      delhi: [28.58, 77.22], gurugram: [28.45, 77.03], noida: [28.57, 77.32],
      mumbai: [19.10, 72.95], bangalore: [12.97, 77.59], bengaluru: [12.97, 77.59],
      pune: [18.52, 73.86], hyderabad: [17.44, 78.50], chennai: [13.08, 80.20],
    };
    const cityKey = (technicians[0]?.city ?? centers[0]?.city ?? '').toLowerCase();
    const initCenter: [number, number] = CITY_CENTERS[cityKey] ?? [28.58, 77.22];

    const map = L.map(mapContainerRef.current, { center: initCenter, zoom: 11 });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors', maxZoom: 19,
    }).addTo(map);

    // Centers as canvas dots
    const dcCanvas = L.canvas({ padding: 0.5 });
    centers.slice(0, 200).forEach(c => {
      if (!c.latitude || !c.longitude) return;
      L.circleMarker([c.latitude, c.longitude], {
        renderer: dcCanvas, radius: 4, color: '#fff', weight: 1, fillColor: '#0f172a', fillOpacity: 1,
      }).addTo(map).bindPopup(`<b>${c.name.replace(/_D$/, '')}</b><br/>${c.city}`);
    });

    // Planned routes as dashed lines
    routePlans.forEach((plan, pi) => {
      if (!plan.stops.length) return;
      const color = ROUTE_COLORS[pi % ROUTE_COLORS.length];
      const path: [number, number][] = [
        [plan.startLat, plan.startLng],
        ...plan.stops.map(s => [s.latitude, s.longitude] as [number, number]),
      ].filter(([la, ln]) => la && ln);
      if (path.length > 1)
        L.polyline(path, { color, weight: 2, opacity: 0.45, dashArray: '6 6' }).addTo(map);
    });

    // Separate layer for live GPS dots
    liveLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      liveLayerRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Re-render live dots on every liveLocations/selectedEid change ─
  const allEids = Array.from(liveLocations.keys()).sort();

  const renderLiveDots = useCallback(() => {
    const layer = liveLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    liveLocations.forEach(loc => {
      const isStale  = Date.now() - new Date(loc.updated_at).getTime() > STALE_MS;
      const color    = techColor(loc.employee_id, allEids);
      const initials = techInitials(loc.tech_name || loc.employee_id);
      const isSelected = selectedEid === loc.employee_id;

      const techInfo = technicians.find(t =>
        t.employeeId?.toUpperCase() === loc.employee_id
      );

      const icon = L.divIcon({
        className: '',
        html: liveDotHtml(initials, color, isStale),
        iconSize: [36, 56],
        iconAnchor: [18, 18],
      });

      L.marker([loc.lat, loc.lng], { icon, zIndexOffset: isSelected ? 1000 : 0 })
        .addTo(layer)
        .bindPopup(`
          <div style="font-family:sans-serif;font-size:12px;min-width:180px">
            <div style="font-weight:700;font-size:13px;color:${color};margin-bottom:4px">
              📍 ${loc.tech_name || loc.employee_id}
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:11px">
              <tr><td style="color:#64748b;width:80px">ID</td>
                  <td style="font-weight:600">${loc.employee_id}</td></tr>
              ${techInfo ? `<tr><td style="color:#64748b">Zone</td>
                  <td>${techInfo.zone || '—'}</td></tr>` : ''}
              <tr><td style="color:#64748b">Accuracy</td>
                  <td>±${Math.round(loc.accuracy ?? 0)} m</td></tr>
              <tr><td style="color:#64748b">Updated</td>
                  <td>${timeSince(loc.updated_at)}</td></tr>
              <tr><td style="color:#64748b">Status</td>
                  <td style="font-weight:600;color:${isStale ? '#94a3b8' : '#16a34a'}">
                    ${isStale ? '⏸ Offline' : '● Live'}
                  </td></tr>
            </table>
          </div>`);
    });
  }, [liveLocations, allEids, selectedEid, technicians]);

  useEffect(() => { renderLiveDots(); }, [renderLiveDots]);

  // ── Tracking link helpers ─────────────────────────────────────
  const baseUrl = `${window.location.origin}${window.location.pathname}`;
  const trackLink = (eid?: string) =>
    eid ? `${baseUrl}#/track?eid=${encodeURIComponent(eid)}` : `${baseUrl}#/track`;
  const copyLink = (eid?: string) =>
    void navigator.clipboard?.writeText(trackLink(eid));

  // ── Stats ─────────────────────────────────────────────────────
  const liveCount = Array.from(liveLocations.values()).filter(
    l => Date.now() - new Date(l.updated_at).getTime() <= STALE_MS
  ).length;

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Radio className="w-5 h-5 text-emerald-600 animate-pulse" />
            LIVE FLEET TRACKING
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time GPS from field technicians · planned routes overlaid
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border ${
            realtimeStatus === 'connected'  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
            : realtimeStatus === 'connecting' ? 'bg-blue-50 border-blue-200 text-blue-600'
            : realtimeStatus === 'disabled'   ? 'bg-slate-50 border-slate-200 text-slate-500'
            : 'bg-red-50 border-red-200 text-red-600'
          }`}>
            {realtimeStatus === 'connected'  && <><span className="w-2 h-2 bg-emerald-500 rounded-full animate-ping inline-block" />Realtime ON</>}
            {realtimeStatus === 'connecting' && <><Wifi className="w-3 h-3 animate-pulse" />Connecting…</>}
            {realtimeStatus === 'error'      && <><WifiOff className="w-3 h-3" />Realtime error</>}
            {realtimeStatus === 'disabled'   && <><WifiOff className="w-3 h-3" />DB not configured</>}
          </span>
          {liveCount > 0 && (
            <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
              {liveCount}/{liveLocations.size} live
            </span>
          )}
        </div>
      </div>

      {/* No DB notice */}
      {realtimeStatus === 'disabled' && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
          <strong>Supabase not connected.</strong>{' '}
          Add <code className="text-xs bg-amber-100 px-1 rounded">VITE_SUPABASE_URL</code> and{' '}
          <code className="text-xs bg-amber-100 px-1 rounded">VITE_SUPABASE_ANON_KEY</code>{' '}
          to your environment variables, run the SQL migration, then redeploy.
        </div>
      )}

      {/* Map */}
      <div className="relative w-full rounded-xl overflow-hidden border border-slate-200 shadow-sm bg-slate-100"
           style={{ height: '480px' }}>
        <div ref={mapContainerRef} className="w-full h-full z-10" />

        {liveCount === 0 && realtimeStatus === 'connected' && (
          <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
            <div className="bg-white/90 backdrop-blur-sm rounded-xl px-5 py-3 border border-slate-200 text-center shadow">
              <MapPin className="w-6 h-6 text-slate-300 mx-auto mb-1" />
              <div className="text-sm font-semibold text-slate-600">No live techs yet</div>
              <div className="text-xs text-slate-400 mt-0.5">Send a tracking link to a technician to see them here</div>
            </div>
          </div>
        )}
      </div>

      {/* Live technician cards */}
      {liveLocations.size > 0 && (
        <div>
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2.5">Live Positions</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from(liveLocations.values())
              .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
              .map(loc => {
                const isStale  = Date.now() - new Date(loc.updated_at).getTime() > STALE_MS;
                const color    = techColor(loc.employee_id, allEids);
                const initials = techInitials(loc.tech_name || loc.employee_id);
                const isSelected = selectedEid === loc.employee_id;
                const plan = routePlans.find(p => {
                  const t = technicians.find(t2 => t2.id === p.technicianId);
                  return t?.employeeId?.toUpperCase() === loc.employee_id;
                });
                return (
                  <div
                    key={loc.employee_id}
                    onClick={() => setSelectedEid(isSelected ? null : loc.employee_id)}
                    className={`p-4 bg-white rounded-xl border cursor-pointer transition-all ${
                      isSelected ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                             style={{ background: isStale ? '#94a3b8' : color }}>
                          {initials}
                        </div>
                        <div>
                          <div className="font-bold text-xs text-slate-900">{loc.tech_name || loc.employee_id}</div>
                          <div className="text-[11px] text-slate-500">{loc.employee_id}</div>
                        </div>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border shrink-0 ${
                        isStale
                          ? 'bg-slate-50 text-slate-500 border-slate-200'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      }`}>
                        {isStale ? 'Offline' : '● Live'}
                      </span>
                    </div>

                    <div className="mt-3 pt-2.5 border-t border-slate-100 text-[11px] space-y-0.5 text-slate-500">
                      <div><span className="text-slate-400">Updated:</span> {timeSince(loc.updated_at)}</div>
                      <div><span className="text-slate-400">Accuracy:</span> ±{Math.round(loc.accuracy ?? 0)} m</div>
                      {plan && (
                        <div><span className="text-slate-400">Route:</span> {plan.stops.length} stops · {plan.totalDistanceKm} km</div>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Send Tracking Links */}
      <div>
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2.5">Send Tracking Links</h2>

        {/* Generic link */}
        <div className="mb-3 p-3.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-slate-700 mb-0.5">Generic tracking page</div>
            <div className="text-[11px] text-slate-400 font-mono truncate">{trackLink()}</div>
          </div>
          <button onClick={() => copyLink()}
            className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 transition-colors shrink-0">
            <Copy className="w-3 h-3" /> Copy
          </button>
          <a href={trackLink()} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 transition-colors shrink-0">
            <ExternalLink className="w-3 h-3" /> Test
          </a>
        </div>

        {/* Per-tech pre-filled links */}
        {technicians.filter(t => t.status === 'Active' && t.employeeId).length > 0 && (
          <div className="space-y-2">
            <div className="text-[11px] text-slate-400 font-medium">Pre-filled links — tech sees their ID already entered:</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {technicians
                .filter(t => t.status === 'Active' && t.employeeId)
                .slice(0, 20)
                .map(tech => {
                  const eidUp  = tech.employeeId!.toUpperCase();
                  const loc    = liveLocations.get(eidUp);
                  const isLive = loc
                    ? Date.now() - new Date(loc.updated_at).getTime() <= STALE_MS
                    : false;
                  return (
                    <div key={tech.id}
                      className="flex items-center gap-2 p-2.5 bg-white rounded-lg border border-slate-200">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-slate-800 truncate">{tech.name}</div>
                        <div className="text-[10px] text-slate-400">{tech.employeeId}</div>
                        {isLive && (
                          <div className="text-[10px] text-emerald-600 font-semibold">
                            ● Live · {timeSince(loc!.updated_at)}
                          </div>
                        )}
                      </div>
                      <button onClick={() => copyLink(tech.employeeId!)} title="Copy link"
                        className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-500 shrink-0">
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <a href={trackLink(tech.employeeId!)} target="_blank" rel="noopener noreferrer"
                        title="Open link" className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-500 shrink-0">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </div>

      {/* Planned Routes Status */}
      <div>
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2.5">Planned Routes Status</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {technicians.filter(t => t.status === 'Active').map(tech => {
            const plan = routePlans.find(p => p.technicianId === tech.id);
            const isDone = (st?: string) => st === 'Resolved' || st === 'Closed';
            const activeStop = plan?.stops.find(st => !isDone(st.ticketStatus));
            const doneCount  = plan ? plan.stops.filter(st => isDone(st.ticketStatus)).length : 0;
            const totalCount = plan?.stops.length ?? 0;
            const eidUp  = tech.employeeId?.toUpperCase() ?? '';
            const loc    = eidUp ? liveLocations.get(eidUp) : undefined;
            const isGpsLive = loc
              ? Date.now() - new Date(loc.updated_at).getTime() <= STALE_MS
              : false;
            return (
              <div key={tech.id} className="p-4 bg-white rounded-xl border border-slate-200">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-bold text-xs text-slate-900">{tech.name}</div>
                    <div className="text-[11px] text-slate-500">{tech.role} · {tech.city}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded font-semibold">
                      On-Field
                    </span>
                    {isGpsLive && (
                      <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded font-semibold">
                        ● GPS Live
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-3 pt-2.5 border-t border-slate-100 text-xs space-y-1">
                  <div className="text-slate-600">
                    <span className="text-slate-400">Task:</span>{' '}
                    {activeStop
                      ? `${activeStop.centerName} (${activeStop.vehicleNumber})`
                      : totalCount ? 'All visits resolved' : 'Standby'}
                    {totalCount > 0 && <span className="ml-1 text-slate-400">· {doneCount}/{totalCount}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
