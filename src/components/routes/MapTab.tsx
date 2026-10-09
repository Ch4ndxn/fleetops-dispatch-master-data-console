import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import * as L from 'leaflet';
import { TechnicianRoutePlan, RouteStop, Technician, Center, Ticket } from '../../types';
import {
  Search,
  Navigation,
  MapPin,
  ExternalLink,
  ChevronDown,
  X,
  Clock,
  Layers,
  LocateFixed,
  Wifi,
  WifiOff,
} from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────────────────
interface MapTabProps {
  routePlans: TechnicianRoutePlan[];
  technicians: Technician[];
  centers: Center[];
  allTickets: Ticket[];
}

// ─── Constants ─────────────────────────────────────────────────────────────────
const ROUTE_COLORS = [
  '#2563eb', '#16a34a', '#d97706', '#9333ea',
  '#dc2626', '#0891b2', '#c026d3', '#ea580c',
];

const PRIORITY_COLOR: Record<string, string> = {
  CRITICAL: '#dc2626',
  HIGH:     '#ea580c',
  MEDIUM:   '#d97706',
  LOW:      '#16a34a',
};

const CLOSED_STATUSES = new Set(['Resolved', 'Closed']);

// ─── Distance helper (Haversine, km) ─────────────────────────────────────────
function distKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Pin helpers ───────────────────────────────────────────────────────────────
function stopPin(num: number, color: string, isClosed: boolean, priority: string): string {
  const bg = isClosed ? '#16a34a' : (PRIORITY_COLOR[priority] ?? color);
  return `<div style="background:${bg};width:28px;height:28px;border-radius:50%;
    display:flex;align-items:center;justify-content:center;border:2px solid #fff;
    box-shadow:0 2px 8px rgba(0,0,0,0.35);color:#fff;font-size:11px;font-weight:700;
    font-family:sans-serif;">${isClosed ? '✓' : num}</div>`;
}

function homePin(color: string, initials: string): string {
  return `<div style="background:${color};width:30px;height:30px;border-radius:6px;
    display:flex;align-items:center;justify-content:center;border:2.5px solid #fff;
    box-shadow:0 2px 8px rgba(0,0,0,0.35);color:#fff;font-size:11px;font-weight:700;
    font-family:sans-serif;">${initials}</div>`;
}

// ─── Google Maps URL builders ─────────────────────────────────────────────────
function buildGoogleMapsRoute(plan: TechnicianRoutePlan): string {
  const origin = `${plan.startLat},${plan.startLng}`;
  const stops = plan.stops.slice().sort((a, b) => a.stopOrder - b.stopOrder);
  if (stops.length === 0) return `https://www.google.com/maps/search/?api=1&query=${origin}`;
  const destination = `${stops[stops.length - 1].latitude},${stops[stops.length - 1].longitude}`;
  const waypoints = stops
    .slice(0, -1)
    .map(s => `${s.latitude},${s.longitude}`)
    .join('|');
  const base = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=driving`;
  return waypoints ? `${base}&waypoints=${encodeURIComponent(waypoints)}` : base;
}

function buildGoogleMapsStop(stop: RouteStop): string {
  return `https://www.google.com/maps/search/?api=1&query=${stop.latitude},${stop.longitude}`;
}

// ─── MapTab component ─────────────────────────────────────────────────────────
export const MapTab: React.FC<MapTabProps> = ({
  routePlans,
  technicians,
  centers,
  allTickets,
}) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const myMarkerRef = useRef<L.Marker | null>(null);
  const myCircleRef = useRef<L.Circle | null>(null);
  const watchIdRef = useRef<number | null>(null);

  const [search, setSearch] = useState('');
  const [selectedTechId, setSelectedTechId] = useState<string | 'all'>('all');
  const [techDropdownOpen, setTechDropdownOpen] = useState(false);
  const [selectedStop, setSelectedStop] = useState<{ stop: RouteStop; plan: TechnicianRoutePlan } | null>(null);
  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  // ticket status map
  const statusMap = useMemo(
    () => new Map(allTickets.map(t => [t.ticketId, t.status])),
    [allTickets],
  );

  // filtered plans by tech selection
  const activePlans = useMemo(() => {
    if (selectedTechId === 'all') return routePlans;
    return routePlans.filter(p => p.technicianId === selectedTechId);
  }, [routePlans, selectedTechId]);

  // all stops flat, filtered by search
  const allStops = useMemo(() => {
    return activePlans.flatMap(plan =>
      plan.stops.map(stop => ({ stop, plan })),
    );
  }, [activePlans]);

  const searchLower = search.trim().toLowerCase();
  const filteredStops = useMemo(() => {
    if (!searchLower) return allStops;
    return allStops.filter(({ stop, plan }) =>
      stop.ticketId.toLowerCase().includes(searchLower) ||
      stop.centerName.toLowerCase().includes(searchLower) ||
      stop.vehicleNumber.toLowerCase().includes(searchLower) ||
      plan.technicianName.toLowerCase().includes(searchLower),
    );
  }, [allStops, searchLower]);

  // nearest DC to my location
  const nearestDC = useMemo(() => {
    if (!myLocation) return null;
    const validCenters = centers.filter(c => c.latitude && c.longitude && !isNaN(c.latitude) && !isNaN(c.longitude));
    if (validCenters.length === 0) return null;
    let best = validCenters[0];
    let bestDist = distKm(myLocation.lat, myLocation.lng, best.latitude, best.longitude);
    validCenters.forEach(c => {
      const d = distKm(myLocation.lat, myLocation.lng, c.latitude, c.longitude);
      if (d < bestDist) { bestDist = d; best = c; }
    });
    return { center: best, distKm: bestDist };
  }, [myLocation, centers]);

  // selected tech label
  const selectedTechLabel = useMemo(() => {
    if (selectedTechId === 'all') return 'All Technicians';
    return routePlans.find(p => p.technicianId === selectedTechId)?.technicianName ?? 'Unknown';
  }, [selectedTechId, routePlans]);

  // ── Map initialise / update ─────────────────────────────────────────────────
  const buildMap = useCallback(() => {
    if (!mapRef.current) return;
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const map = L.map(mapRef.current, {
      center: [28.58, 77.22],
      zoom: 11,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    const bounds = L.latLngBounds([]);

    // DC markers
    centers.forEach(c => {
      if (!c.latitude || !c.longitude || isNaN(c.latitude) || isNaN(c.longitude)) return;
      bounds.extend([c.latitude, c.longitude]);
      const icon = L.divIcon({
        className: '',
        html: `<div style="background:#0f172a;width:22px;height:22px;border-radius:5px;
          display:flex;align-items:center;justify-content:center;border:2px solid #fff;
          box-shadow:0 1px 5px rgba(0,0,0,0.3);color:#fff;font-size:8px;font-weight:700;font-family:sans-serif;">DC</div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      L.marker([c.latitude, c.longitude], { icon })
        .addTo(map)
        .bindPopup(`<b style="font-family:sans-serif;font-size:13px">${c.name.replace(/_D$/, '')}</b><br/><span style="color:#64748b;font-size:11px">${c.city}</span>`);
    });

    // Route plans
    const plansToRender = selectedTechId === 'all'
      ? routePlans
      : routePlans.filter(p => p.technicianId === selectedTechId);

    plansToRender.forEach(plan => {
      if (plan.stops.length === 0) return;
      const colorIdx = routePlans.findIndex(p => p.technicianId === plan.technicianId) % ROUTE_COLORS.length;
      const color = ROUTE_COLORS[colorIdx];
      const isSelected = selectedTechId === plan.technicianId;

      // Home base
      if (plan.startLat && plan.startLng) {
        bounds.extend([plan.startLat, plan.startLng]);
        const initials = plan.technicianName.split(' ').map((w: string) => w[0]).slice(0, 2).join('');
        const hIcon = L.divIcon({
          className: '',
          html: homePin(color, initials),
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        });
        L.marker([plan.startLat, plan.startLng], { icon: hIcon })
          .addTo(map)
          .bindPopup(`
            <div style="font-family:sans-serif;font-size:12px;min-width:180px">
              <b style="color:${color};font-size:13px">🔧 ${plan.technicianName}</b><br/>
              <span style="color:#475569">${plan.employeeId} · ${plan.stops.length} stops · ${plan.totalDistanceKm} km</span>
              <br/><a href="${buildGoogleMapsRoute(plan)}" target="_blank"
                style="display:inline-block;margin-top:6px;padding:4px 10px;background:${color};color:#fff;
                border-radius:6px;font-size:11px;font-weight:700;text-decoration:none;">
                Open in Google Maps ↗
              </a>
            </div>`);
      }

      // Polyline
      const latlngs: [number, number][] = [
        [plan.startLat, plan.startLng],
        ...plan.stops.map(s => [s.latitude, s.longitude] as [number, number]),
      ];
      L.polyline(latlngs, {
        color,
        weight: isSelected ? 5 : 3,
        opacity: isSelected ? 0.95 : 0.7,
        dashArray: isSelected ? undefined : '6,10',
      }).addTo(map);

      // Arrow decorators
      for (let i = 0; i < latlngs.length - 1; i++) {
        const [la1, ln1] = latlngs[i];
        const [la2, ln2] = latlngs[i + 1];
        const midLat = (la1 + la2) / 2;
        const midLng = (ln1 + ln2) / 2;
        const dLng = (ln2 - ln1) * (Math.PI / 180);
        const la1R = la1 * (Math.PI / 180);
        const la2R = la2 * (Math.PI / 180);
        const y = Math.sin(dLng) * Math.cos(la2R);
        const x = Math.cos(la1R) * Math.sin(la2R) - Math.sin(la1R) * Math.cos(la2R) * Math.cos(dLng);
        const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
        const arrowIcon = L.divIcon({
          className: '',
          html: `<div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:10px solid ${color};transform:rotate(${bearing}deg);opacity:0.8"></div>`,
          iconSize: [10, 10],
          iconAnchor: [5, 5],
        });
        L.marker([midLat, midLng], { icon: arrowIcon, interactive: false }).addTo(map);
      }

      // Stop markers
      plan.stops.slice().sort((a, b) => a.stopOrder - b.stopOrder).forEach(stop => {
        if (!stop.latitude || !stop.longitude) return;
        bounds.extend([stop.latitude, stop.longitude]);

        const liveStatus = statusMap.get(stop.ticketId) ?? 'Open';
        const isClosed = CLOSED_STATUSES.has(liveStatus);
        const priColor = PRIORITY_COLOR[stop.priority] ?? '#64748b';
        const statusBg = isClosed ? '#ecfdf5' : liveStatus === 'In Progress' ? '#eff6ff' : '#f1f5f9';
        const statusFg = isClosed ? '#047857' : liveStatus === 'In Progress' ? '#1d4ed8' : '#64748b';

        const sIcon = L.divIcon({
          className: '',
          html: stopPin(stop.stopOrder, color, isClosed, stop.priority),
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });

        L.marker([stop.latitude, stop.longitude], { icon: sIcon })
          .addTo(map)
          .bindPopup(`
            <div style="font-family:sans-serif;font-size:12px;min-width:220px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <b style="font-size:13px;color:#0f172a">Stop ${stop.stopOrder} · ${stop.centerName.replace(/_D$/, '')}</b>
                <span style="padding:2px 6px;border-radius:3px;font-size:10px;font-weight:700;
                  color:#fff;background:${priColor}">${stop.priority}</span>
              </div>
              <table style="width:100%;border-collapse:collapse;font-size:11px;color:#475569">
                <tr><td style="padding:2px 0;width:80px">Ticket</td><td style="font-weight:600;color:#0f172a;font-family:monospace">${stop.ticketId}</td></tr>
                <tr><td style="padding:2px 0">Vehicle</td><td>${stop.vehicleNumber}</td></tr>
                <tr><td style="padding:2px 0">Tech</td><td style="color:${color};font-weight:600">${plan.technicianName}</td></tr>
                <tr><td style="padding:2px 0">ETA</td><td style="font-weight:600;color:#2563eb">${stop.estimatedArrival}</td></tr>
                <tr><td style="padding:2px 0">Status</td><td><span style="padding:2px 7px;border-radius:4px;font-size:10px;font-weight:600;background:${statusBg};color:${statusFg}">${liveStatus}</span></td></tr>
              </table>
              <a href="${buildGoogleMapsStop(stop)}" target="_blank"
                style="display:inline-block;margin-top:8px;padding:4px 10px;background:#2563eb;color:#fff;
                border-radius:6px;font-size:11px;font-weight:700;text-decoration:none;">
                📍 Open in Google Maps ↗
              </a>
            </div>`, { maxWidth: 280 });
      });
    });

    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40] });
    }

    mapInstanceRef.current = map;
  }, [centers, routePlans, selectedTechId, statusMap]);

  useEffect(() => {
    buildMap();
    return () => {
      mapInstanceRef.current?.remove();
      mapInstanceRef.current = null;
    };
  }, [buildMap]);

  // ── Live location marker (separate from map rebuild) ───────────────────────
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !myLocation) return;

    const latlng: L.LatLngTuple = [myLocation.lat, myLocation.lng];

    // accuracy circle
    if (myCircleRef.current) myCircleRef.current.remove();
    myCircleRef.current = L.circle(latlng, {
      radius: myLocation.accuracy,
      color: '#3b82f6',
      fillColor: '#3b82f6',
      fillOpacity: 0.08,
      weight: 1.5,
    }).addTo(map);

    // blue dot
    const myIcon = L.divIcon({
      className: '',
      html: `<div style="width:18px;height:18px;border-radius:50%;background:#3b82f6;
        border:3px solid #fff;box-shadow:0 0 0 3px rgba(59,130,246,0.35),0 2px 8px rgba(0,0,0,0.3)"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });

    if (myMarkerRef.current) myMarkerRef.current.remove();
    myMarkerRef.current = L.marker(latlng, { icon: myIcon, zIndexOffset: 1000 })
      .addTo(map)
      .bindPopup(`<div style="font-family:sans-serif;font-size:12px;min-width:160px">
        <b style="color:#2563eb">📍 You are here</b><br/>
        <span style="color:#64748b;font-size:10px">±${Math.round(myLocation.accuracy)}m accuracy</span>
        ${nearestDC ? `<br/><br/><b style="font-size:11px">Nearest DC:</b><br/>
        <span style="font-weight:600">${nearestDC.center.name.replace(/_D$/, '')}</span>
        <span style="color:#64748b;font-size:10px"> · ${nearestDC.distKm.toFixed(1)} km away</span>
        <br/><a href="https://www.google.com/maps/dir/?api=1&origin=${myLocation.lat},${myLocation.lng}&destination=${nearestDC.center.latitude},${nearestDC.center.longitude}&travelmode=driving"
          target="_blank" style="display:inline-block;margin-top:6px;padding:3px 8px;background:#2563eb;color:#fff;border-radius:5px;font-size:10px;font-weight:700;text-decoration:none;">
          Navigate to DC ↗</a>` : ''}
      </div>`, { maxWidth: 220 });
  }, [myLocation, nearestDC]);

  // ── Geolocation watch ──────────────────────────────────────────────────────
  const startLocating = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation not supported by this browser');
      return;
    }
    setLocating(true);
    setLocationError(null);

    watchIdRef.current = navigator.geolocation.watchPosition(
      pos => {
        setLocating(false);
        setLocationError(null);
        setMyLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
        // fly to my location on first fix
        if (!myLocation && mapInstanceRef.current) {
          mapInstanceRef.current.flyTo([pos.coords.latitude, pos.coords.longitude], 14, { duration: 1 });
        }
      },
      err => {
        setLocating(false);
        setLocationError(err.code === 1 ? 'Location permission denied' : 'Could not get location');
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
    );
  }, [myLocation]);

  const stopLocating = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (myMarkerRef.current) { myMarkerRef.current.remove(); myMarkerRef.current = null; }
    if (myCircleRef.current) { myCircleRef.current.remove(); myCircleRef.current = null; }
    setMyLocation(null);
    setLocationError(null);
  }, []);

  // cleanup on unmount
  useEffect(() => () => { stopLocating(); }, [stopLocating]);

  // Jump map to a stop when clicked in the list
  const flyToStop = (stop: RouteStop, plan: TechnicianRoutePlan) => {
    setSelectedStop({ stop, plan });
    mapInstanceRef.current?.flyTo([stop.latitude, stop.longitude], 15, { duration: 0.8 });
  };

  const flyToTech = (plan: TechnicianRoutePlan) => {
    if (!plan.startLat || !plan.startLng) return;
    const latlngs: L.LatLngTuple[] = [
      [plan.startLat, plan.startLng],
      ...plan.stops.map(s => [s.latitude, s.longitude] as L.LatLngTuple),
    ];
    const bounds = L.latLngBounds(latlngs);
    mapInstanceRef.current?.fitBounds(bounds, { padding: [60, 60] });
  };

  // ── render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center shrink-0 shadow-sm">
            <Layers className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900 tracking-tight leading-none">Live Route Map</h1>
            <p className="text-[11px] text-slate-500 mt-0.5">Interactive map · Click stops to navigate · Open in Google Maps</p>
          </div>
        </div>

        {/* Google Maps — full roster */}
        {routePlans.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {(selectedTechId !== 'all'
              ? routePlans.filter(p => p.technicianId === selectedTechId)
              : []
            ).map(plan => (
              <a
                key={plan.technicianId}
                href={buildGoogleMapsRoute(plan)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-sm transition-colors"
              >
                <Navigation className="w-3.5 h-3.5" />
                Navigate {plan.technicianName.split(' ')[0]}'s Route
                <ExternalLink className="w-3 h-3 opacity-75" />
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Controls bar */}
      <div className="flex flex-col sm:flex-row gap-2">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search ticket, center, vehicle, technician…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-8 py-2 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Live location button */}
        <button
          onClick={myLocation ? stopLocating : startLocating}
          disabled={locating}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors shrink-0 ${
            myLocation
              ? 'bg-blue-600 border-blue-600 text-white hover:bg-blue-700'
              : locationError
              ? 'bg-rose-50 border-rose-300 text-rose-600 hover:bg-rose-100'
              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
          }`}
          title={myLocation ? 'Stop tracking' : 'Show my location'}
        >
          {locating ? (
            <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : myLocation ? (
            <Wifi className="w-3.5 h-3.5" />
          ) : locationError ? (
            <WifiOff className="w-3.5 h-3.5" />
          ) : (
            <LocateFixed className="w-3.5 h-3.5" />
          )}
          {myLocation ? 'Live' : locating ? 'Locating…' : 'My Location'}
        </button>

        {/* Tech selector */}
        <div className="relative">
          <button
            onClick={() => setTechDropdownOpen(v => !v)}
            className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors min-w-[180px] justify-between"
          >
            <span className="truncate">{selectedTechLabel}</span>
            <ChevronDown className="w-3.5 h-3.5 shrink-0 text-slate-400" />
          </button>
          {techDropdownOpen && (
            <div className="absolute z-30 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg w-56 py-1 max-h-60 overflow-y-auto">
              <button
                onClick={() => { setSelectedTechId('all'); setTechDropdownOpen(false); }}
                className={`w-full text-left px-3 py-2 text-xs transition-colors ${selectedTechId === 'all' ? 'bg-emerald-50 text-emerald-700 font-bold' : 'text-slate-700 hover:bg-slate-50'}`}
              >
                All Technicians
              </button>
              {routePlans.map(plan => {
                const colorIdx = routePlans.findIndex(p => p.technicianId === plan.technicianId) % ROUTE_COLORS.length;
                const color = ROUTE_COLORS[colorIdx];
                return (
                  <button
                    key={plan.technicianId}
                    onClick={() => { setSelectedTechId(plan.technicianId); setTechDropdownOpen(false); flyToTech(plan); }}
                    className={`w-full text-left px-3 py-2 text-xs transition-colors flex items-center gap-2 ${selectedTechId === plan.technicianId ? 'bg-emerald-50 text-emerald-700 font-bold' : 'text-slate-700 hover:bg-slate-50'}`}
                  >
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ background: color }} />
                    <span className="flex-1 truncate">{plan.technicianName}</span>
                    <span className="text-[10px] text-slate-400 shrink-0">{plan.stops.length} stops</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Nearest DC banner */}
      {myLocation && nearestDC && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-xl text-xs">
          <div className="w-7 h-7 bg-slate-900 rounded-[5px] flex items-center justify-center text-white text-[8px] font-bold shrink-0">DC</div>
          <div className="flex-1 min-w-0">
            <span className="text-blue-500 font-bold uppercase tracking-wide text-[10px]">Nearest DC · </span>
            <span className="font-bold text-slate-800">{nearestDC.center.name.replace(/_D$/, '')}</span>
            <span className="text-slate-500 ml-1">· {nearestDC.center.city} · <b className="text-blue-700">{nearestDC.distKm.toFixed(1)} km away</b></span>
          </div>
          <a
            href={`https://www.google.com/maps/dir/?api=1&origin=${myLocation.lat},${myLocation.lng}&destination=${nearestDC.center.latitude},${nearestDC.center.longitude}&travelmode=driving`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-[11px] transition-colors shrink-0"
          >
            <Navigation className="w-3 h-3" />
            Drive there
          </a>
        </div>
      )}

      {/* Location error */}
      {locationError && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700">
          <WifiOff className="w-4 h-4 shrink-0" />
          <span>{locationError}. Please allow location access and try again.</span>
        </div>
      )}

      {/* Main layout: map + sidebar */}
      <div className="flex flex-col lg:flex-row gap-4" style={{ minHeight: '520px' }}>

        {/* Map */}
        <div className="flex-1 min-w-0 relative rounded-xl overflow-hidden border border-slate-200 shadow-sm bg-slate-100" style={{ minHeight: '480px' }}>
          <div ref={mapRef} className="w-full h-full absolute inset-0 z-10" />

          {/* Legend overlay */}
          <div className="absolute bottom-3 left-3 z-20 bg-white/95 backdrop-blur-xs px-3 py-2.5 rounded-xl border border-slate-200 shadow-sm text-xs space-y-1.5 max-w-[200px]">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Legend</div>
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 bg-slate-900 rounded-[4px] flex items-center justify-center text-white text-[7px] font-bold shrink-0">DC</div>
              <span className="text-slate-600 text-[11px]">Distribution Center</span>
            </div>
            {(selectedTechId === 'all' ? routePlans : routePlans.filter(p => p.technicianId === selectedTechId))
              .slice(0, 5)
              .map(plan => {
                const color = ROUTE_COLORS[routePlans.findIndex(p => p.technicianId === plan.technicianId) % ROUTE_COLORS.length];
                const initials = plan.technicianName.split(' ').map((w: string) => w[0]).slice(0, 2).join('');
                return (
                  <div key={plan.technicianId} className="flex items-center gap-2 cursor-pointer" onClick={() => flyToTech(plan)}>
                    <div style={{ background: color }} className="w-5 h-5 rounded-[4px] flex items-center justify-center text-white text-[8px] font-bold shrink-0">{initials}</div>
                    <span className="text-[11px] text-slate-700 truncate">{plan.technicianName.split(' ')[0]}</span>
                  </div>
                );
              })}
          </div>
        </div>

        {/* Sidebar: stop list */}
        <div className="lg:w-[340px] shrink-0 flex flex-col bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide">Stops</h3>
              <p className="text-[10px] text-slate-400 mt-0.5">
                {filteredStops.length} of {allStops.length} shown
              </p>
            </div>
            {selectedStop && (
              <button
                onClick={() => setSelectedStop(null)}
                className="text-[11px] text-blue-600 hover:underline"
              >
                Clear
              </button>
            )}
          </div>

          {/* DC list */}
          {centers.filter(c => c.latitude && c.longitude && !isNaN(c.latitude) && !isNaN(c.longitude)).length > 0 && (
            <div className="border-b border-slate-200">
              <div className="px-4 py-2 bg-slate-800 flex items-center gap-2">
                <div className="w-5 h-5 bg-white rounded-[4px] flex items-center justify-center text-slate-900 text-[7px] font-bold shrink-0">DC</div>
                <span className="text-[10px] font-bold text-slate-200 uppercase tracking-wider">Distribution Centers</span>
              </div>
              <div className="divide-y divide-slate-100">
                {centers
                  .filter(c => c.latitude && c.longitude && !isNaN(c.latitude) && !isNaN(c.longitude))
                  .map(center => (
                    <div
                      key={center.id ?? center.name}
                      className="px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50 transition-colors cursor-pointer"
                      onClick={() => mapInstanceRef.current?.flyTo([center.latitude, center.longitude], 14, { duration: 0.8 })}
                    >
                      <div className="w-6 h-6 bg-slate-900 rounded-[5px] flex items-center justify-center text-white text-[8px] font-bold shrink-0">DC</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-semibold text-slate-800 truncate">{center.name.replace(/_D$/, '')}</div>
                        <div className="text-[10px] text-slate-400">{center.city}</div>
                      </div>
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${center.latitude},${center.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        title="Navigate to DC"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors shrink-0"
                      >
                        <Navigation className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  ))}
              </div>
            </div>
          )}

          <div className="overflow-y-auto flex-1 divide-y divide-slate-100">
            {filteredStops.length === 0 ? (
              <div className="p-8 text-center">
                {routePlans.length === 0 ? (
                  <>
                    <Navigation className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    <p className="text-xs text-slate-400">No routes yet. Run AUTO-PLAN in Route Planner.</p>
                  </>
                ) : (
                  <p className="text-xs text-slate-400">No stops match search.</p>
                )}
              </div>
            ) : (
              filteredStops.map(({ stop, plan }) => {
                const liveStatus = statusMap.get(stop.ticketId) ?? 'Open';
                const isClosed = CLOSED_STATUSES.has(liveStatus);
                const colorIdx = routePlans.findIndex(p => p.technicianId === plan.technicianId) % ROUTE_COLORS.length;
                const color = ROUTE_COLORS[colorIdx];
                const isActive = selectedStop?.stop.ticketId === stop.ticketId;

                return (
                  <div
                    key={`${plan.technicianId}-${stop.ticketId}`}
                    onClick={() => flyToStop(stop, plan)}
                    className={`px-4 py-3 cursor-pointer transition-colors ${
                      isActive ? 'bg-blue-50 border-l-2 border-blue-500' : 'hover:bg-slate-50'
                    } ${isClosed ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-start gap-2.5">
                      {/* Stop number circle */}
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0 mt-0.5"
                        style={{ background: isClosed ? '#16a34a' : color }}
                      >
                        {isClosed ? '✓' : stop.stopOrder}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono text-[10px] font-bold text-teal-700 bg-teal-50 px-1 py-0.5 rounded">{stop.ticketId}</span>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded text-white`}
                            style={{ background: PRIORITY_COLOR[stop.priority] ?? '#64748b' }}>
                            {stop.priority}
                          </span>
                        </div>
                        <div className="text-[12px] font-semibold text-slate-800 truncate mt-0.5">
                          {stop.centerName.replace(/_D$/, '')}
                        </div>
                        <div className="text-[10px] text-slate-500 flex gap-2 flex-wrap mt-0.5">
                          <span>{stop.vehicleNumber}</span>
                          <span>·</span>
                          <span style={{ color }}>
                            {plan.technicianName.split(' ')[0]}
                          </span>
                          <span>·</span>
                          <span className="flex items-center gap-0.5 font-mono text-blue-600">
                            <Clock className="w-2.5 h-2.5" />
                            {stop.estimatedArrival}
                          </span>
                        </div>
                      </div>

                      {/* Google Maps link */}
                      <a
                        href={buildGoogleMapsStop(stop)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        title="Open in Google Maps"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors shrink-0 mt-0.5"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer — navigate full route */}
          {selectedTechId !== 'all' && routePlans.some(p => p.technicianId === selectedTechId) && (() => {
            const plan = routePlans.find(p => p.technicianId === selectedTechId)!;
            return (
              <div className="px-4 py-3 border-t border-slate-100 bg-slate-50">
                <a
                  href={buildGoogleMapsRoute(plan)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors"
                >
                  <Navigation className="w-3.5 h-3.5" />
                  Navigate Full Route in Google Maps
                  <ExternalLink className="w-3 h-3 opacity-75" />
                </a>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
};
