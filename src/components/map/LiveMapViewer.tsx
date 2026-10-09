import React, { useEffect, useRef } from 'react';
import * as L from 'leaflet';
import { Center, Technician, TechnicianRoutePlan, Ticket } from '../../types';

interface Props {
  centers: Center[];
  technicians: Technician[];
  routePlans?: TechnicianRoutePlan[];
  selectedTechId?: string;
  allTickets?: Ticket[];
  height?: string;
}

// 6 distinct route colors — enough for any realistic number of techs
const ROUTE_COLORS = [
  '#2563eb', // blue
  '#16a34a', // green
  '#d97706', // amber
  '#9333ea', // purple
  '#dc2626', // red
  '#0891b2', // cyan
  '#c026d3', // fuchsia
  '#ea580c', // orange
];

const PRIORITY_COLOR: Record<string, string> = {
  CRITICAL: '#dc2626',
  HIGH:     '#ea580c',
  MEDIUM:   '#d97706',
  LOW:      '#16a34a',
};

/**
 * Build a numbered stop pin HTML.
 * closedStatuses → green check; else color = priority or route color
 */
function stopPinHtml(
  stopNumber: number,
  color: string,
  isClosed: boolean,
  priority: string
): string {
  const bg = isClosed ? '#16a34a' : PRIORITY_COLOR[priority] ?? color;
  const border = isClosed ? '#14532d' : '#fff';
  const icon = isClosed ? '✓' : String(stopNumber);
  return `
    <div style="
      background:${bg};
      width:28px; height:28px;
      border-radius:50%;
      display:flex; align-items:center; justify-content:center;
      border:2px solid ${border};
      box-shadow:0 2px 8px rgba(0,0,0,0.35);
      color:#fff;
      font-size:11px;
      font-weight:700;
      font-family:sans-serif;
    ">${icon}</div>
  `;
}

/** HOME base pin for a tech */
function homeBasePinHtml(color: string, initials: string): string {
  return `
    <div style="
      background:${color};
      width:30px; height:30px;
      border-radius:6px;
      display:flex; align-items:center; justify-content:center;
      border:2.5px solid #fff;
      box-shadow:0 2px 8px rgba(0,0,0,0.35);
      color:#fff;
      font-size:11px;
      font-weight:700;
      font-family:sans-serif;
    ">${initials}</div>
  `;
}

const CLOSED_STATUSES = new Set(['Resolved', 'Closed']);

export const LiveMapViewer: React.FC<Props> = ({
  centers,
  technicians,
  routePlans = [],
  selectedTechId,
  allTickets = [],
  height = '500px'
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  // Build a quick lookup: ticketId → live status
  const ticketStatusMap = useRef<Map<string, string>>(new Map());
  ticketStatusMap.current = new Map(allTickets.map(t => [t.ticketId, t.status]));

  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const map = L.map(mapContainerRef.current, {
      center: [28.58, 77.22],
      zoom: 11,
      zoomControl: true
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(map);

    const bounds = L.latLngBounds([]);

    // ── 1. Centers (only when no route selected or always as context) ──────────
    centers.forEach(c => {
      if (!c.latitude || !c.longitude || isNaN(c.latitude) || isNaN(c.longitude)) return;
      bounds.extend([c.latitude, c.longitude]);

      const dcIcon = L.divIcon({
        className: '',
        html: `
          <div style="background:#0f172a;width:24px;height:24px;border-radius:5px;
            display:flex;align-items:center;justify-content:center;
            border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,0.3);
            color:#fff;font-size:9px;font-weight:700;font-family:sans-serif;">
            DC
          </div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });

      L.marker([c.latitude, c.longitude], { icon: dcIcon })
        .addTo(map)
        .bindPopup(`
          <div style="font-family:sans-serif;font-size:12px;min-width:160px">
            <div style="font-weight:700;font-size:13px;color:#0f172a;margin-bottom:4px">${c.name.replace(/_D$/, '')}</div>
            <div style="color:#475569">City: ${c.city}</div>
            <div style="color:#475569">Default DC: ${c.defaultDc || '—'}</div>
            <div style="color:#64748b;font-size:11px;margin-top:2px">${c.latitude.toFixed(4)}, ${c.longitude.toFixed(4)}</div>
          </div>`);
    });

    // ── 2. Routes ──────────────────────────────────────────────────────────────
    const plansToRender = selectedTechId
      ? routePlans.filter(p => p.technicianId === selectedTechId)
      : routePlans;

    plansToRender.forEach((plan, idx) => {
      if (plan.stops.length === 0) return;

      const color = ROUTE_COLORS[
        routePlans.findIndex(p => p.technicianId === plan.technicianId) % ROUTE_COLORS.length
      ];
      const isSelected = selectedTechId === plan.technicianId;

      // a. Start / home base marker
      if (plan.startLat && plan.startLng) {
        bounds.extend([plan.startLat, plan.startLng]);
        const initials = plan.technicianName.split(' ').map((w: string) => w[0]).slice(0, 2).join('');
        const homeIcon = L.divIcon({
          className: '',
          html: homeBasePinHtml(color, initials),
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        });
        L.marker([plan.startLat, plan.startLng], { icon: homeIcon })
          .addTo(map)
          .bindPopup(`
            <div style="font-family:sans-serif;font-size:12px;min-width:180px">
              <div style="font-weight:700;font-size:13px;color:${color};margin-bottom:4px">🔧 ${plan.technicianName}</div>
              <div style="color:#475569">ID: ${plan.employeeId}</div>
              <div style="color:#475569">Stops: ${plan.stops.length}</div>
              <div style="color:#475569">Distance: ${plan.totalDistanceKm} km</div>
              <div style="color:#475569">Est. Time: ${plan.totalEstimatedMins} min</div>
              <div style="margin-top:4px;padding:3px 7px;border-radius:4px;font-size:11px;font-weight:600;
                background:${plan.status === 'Confirmed' ? '#ecfdf5' : plan.status === 'In-Transit' ? '#eff6ff' : '#f8fafc'};
                color:${plan.status === 'Confirmed' ? '#047857' : plan.status === 'In-Transit' ? '#1d4ed8' : '#64748b'}">
                ${plan.status}
              </div>
            </div>`);
      }

      // b. Route polyline with arrows
      const latlngs: [number, number][] = [
        [plan.startLat, plan.startLng],
        ...plan.stops.map(s => [s.latitude, s.longitude] as [number, number])
      ];

      // Main line
      L.polyline(latlngs, {
        color,
        weight: isSelected ? 5 : 3,
        opacity: isSelected ? 0.95 : 0.7,
        dashArray: isSelected ? undefined : '6, 10'
      }).addTo(map)
        .bindPopup(`
          <strong style="color:${color}">${plan.technicianName}</strong><br/>
          ${plan.stops.length} stops · ${plan.totalDistanceKm} km · ~${plan.totalEstimatedMins} min`);

      // Direction decorator arrows — draw a small arrowhead at each segment midpoint
      for (let i = 0; i < latlngs.length - 1; i++) {
        const [lat1, lng1] = latlngs[i];
        const [lat2, lng2] = latlngs[i + 1];
        const midLat = (lat1 + lat2) / 2;
        const midLng = (lng1 + lng2) / 2;

        // Bearing in degrees
        const dLng = (lng2 - lng1) * (Math.PI / 180);
        const lat1R = lat1 * (Math.PI / 180);
        const lat2R = lat2 * (Math.PI / 180);
        const y = Math.sin(dLng) * Math.cos(lat2R);
        const x = Math.cos(lat1R) * Math.sin(lat2R) - Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLng);
        const bearingDeg = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;

        const arrowIcon = L.divIcon({
          className: '',
          html: `<div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:10px solid ${color};transform:rotate(${bearingDeg}deg);opacity:0.85"></div>`,
          iconSize: [10, 10],
          iconAnchor: [5, 5]
        });
        L.marker([midLat, midLng], { icon: arrowIcon, interactive: false }).addTo(map);
      }

      // c. Stop markers
      plan.stops
        .slice()
        .sort((a, b) => a.stopOrder - b.stopOrder)
        .forEach(stop => {
          if (!stop.latitude || !stop.longitude) return;
          bounds.extend([stop.latitude, stop.longitude]);

          const liveStatus = ticketStatusMap.current.get(stop.ticketId) ?? 'Open';
          const isClosed = CLOSED_STATUSES.has(liveStatus);

          const stopIcon = L.divIcon({
            className: '',
            html: stopPinHtml(stop.stopOrder, color, isClosed, stop.priority),
            iconSize: [28, 28],
            iconAnchor: [14, 14]
          });

          const priorityLabel = `<span style="padding:2px 6px;border-radius:3px;font-size:10px;font-weight:700;color:#fff;background:${PRIORITY_COLOR[stop.priority] ?? '#64748b'}">${stop.priority}</span>`;
          const statusColor = isClosed ? '#047857' : liveStatus === 'In Progress' ? '#1d4ed8' : '#64748b';
          const statusBg   = isClosed ? '#ecfdf5' : liveStatus === 'In Progress' ? '#eff6ff' : '#f1f5f9';

          L.marker([stop.latitude, stop.longitude], { icon: stopIcon })
            .addTo(map)
            .bindPopup(`
              <div style="font-family:sans-serif;font-size:12px;min-width:210px">
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
                  <span style="font-weight:700;font-size:13px;color:#0f172a">Stop ${stop.stopOrder}</span>
                  ${priorityLabel}
                </div>
                <div style="font-weight:600;color:${color};margin-bottom:4px">${plan.technicianName}</div>
                <table style="width:100%;border-collapse:collapse;font-size:11px">
                  <tr><td style="color:#64748b;padding:1px 0;width:90px">Ticket</td><td style="font-weight:600;color:#0f172a">${stop.ticketId}</td></tr>
                  <tr><td style="color:#64748b;padding:1px 0">Vehicle</td><td style="color:#334155">${stop.vehicleNumber}</td></tr>
                  <tr><td style="color:#64748b;padding:1px 0">Center</td><td style="color:#334155">${stop.centerName.replace(/_D$/, '')}</td></tr>
                  <tr><td style="color:#64748b;padding:1px 0">Issue</td><td style="color:#334155">${stop.issue}</td></tr>
                  <tr><td style="color:#64748b;padding:1px 0">ETA</td><td style="font-weight:600;color:#1d4ed8">${stop.estimatedArrival}</td></tr>
                  <tr><td style="color:#64748b;padding:1px 0">Status</td><td>
                    <span style="padding:2px 7px;border-radius:4px;font-size:10px;font-weight:600;background:${statusBg};color:${statusColor}">
                      ${isClosed ? '✓ ' : ''}${liveStatus}
                    </span>
                  </td></tr>
                </table>
              </div>`, { maxWidth: 260 });
        });
    });

    // ── 3. Unrouted technicians (those with no plan) ───────────────────────────
    if (!selectedTechId) {
      const routedTechIds = new Set(routePlans.map(p => p.technicianId));
      technicians.filter(t => !routedTechIds.has(t.id)).forEach(t => {
        if (!t.startingLatitude || !t.startingLongitude) return;
        const techIcon = L.divIcon({
          className: '',
          html: `<div style="background:#94a3b8;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,0.25);color:#fff;font-size:9px;font-weight:700;font-family:sans-serif;">🔧</div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11]
        });
        L.marker([t.startingLatitude, t.startingLongitude], { icon: techIcon })
          .addTo(map)
          .bindPopup(`
            <div style="font-family:sans-serif;font-size:12px">
              <strong style="color:#475569">${t.name}</strong> (${t.employeeId})<br/>
              <span style="color:#94a3b8">No route assigned</span>
            </div>`);
      });
    }

    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40] });
    }

    mapInstanceRef.current = map;
    return () => {
      mapInstanceRef.current?.remove();
      mapInstanceRef.current = null;
    };
  }, [centers, technicians, routePlans, selectedTechId, allTickets]);

  // Build legend entries for active route plans
  const legendPlans = selectedTechId
    ? routePlans.filter(p => p.technicianId === selectedTechId)
    : routePlans;

  return (
    <div className="relative w-full rounded-xl overflow-hidden border border-slate-200 shadow-xs bg-slate-100" style={{ height }}>
      <div ref={mapContainerRef} className="w-full h-full z-10" />

      {/* Legend */}
      <div className="absolute bottom-3 left-3 z-20 bg-white/96 backdrop-blur-xs px-3 py-2.5 rounded-xl border border-slate-200 shadow-sm text-xs space-y-1.5 max-w-[220px]">
        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Legend</div>

        {/* Static items */}
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 bg-slate-900 rounded-[4px] flex items-center justify-center text-white text-[8px] font-bold shrink-0">DC</div>
          <span className="text-slate-600">Distribution Center</span>
        </div>

        {/* Per-tech items */}
        {legendPlans.slice(0, 5).map((plan, idx) => {
          const color = ROUTE_COLORS[
            routePlans.findIndex(p => p.technicianId === plan.technicianId) % ROUTE_COLORS.length
          ];
          const initials = plan.technicianName.split(' ').map((w: string) => w[0]).slice(0, 2).join('');
          const openStops  = plan.stops.filter(s => !CLOSED_STATUSES.has(ticketStatusMap.current.get(s.ticketId) ?? 'Open')).length;
          const closedStops = plan.stops.length - openStops;
          return (
            <div key={plan.technicianId} className="flex items-center gap-2">
              <div style={{ background: color }} className="w-5 h-5 rounded-[4px] flex items-center justify-center text-white text-[8px] font-bold shrink-0">
                {initials}
              </div>
              <div className="min-w-0">
                <div className="truncate text-slate-700 font-semibold">{plan.technicianName.split(' ')[0]}</div>
                <div className="text-[10px] text-slate-400">
                  {closedStops > 0 && <span className="text-emerald-600 font-semibold">{closedStops}✓</span>}
                  {closedStops > 0 && openStops > 0 && ' · '}
                  {openStops > 0 && <span>{openStops} open</span>}
                </div>
              </div>
            </div>
          );
        })}
        {legendPlans.length > 5 && (
          <div className="text-[10px] text-slate-400">+{legendPlans.length - 5} more routes</div>
        )}

        {/* Status key */}
        <div className="border-t border-slate-100 pt-1.5 mt-0.5 space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-emerald-600 flex items-center justify-center text-white text-[9px] font-bold shrink-0">✓</div>
            <span className="text-slate-500">Ticket Closed</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-orange-500 flex items-center justify-center text-white text-[9px] font-bold shrink-0">1</div>
            <span className="text-slate-500">Stop # (Open)</span>
          </div>
        </div>
      </div>
    </div>
  );
};
