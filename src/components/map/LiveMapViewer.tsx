import React, { useEffect, useRef } from 'react';
import * as L from 'leaflet';
import { Center, Technician, TechnicianRoutePlan } from '../../types';

interface Props {
  centers: Center[];
  technicians: Technician[];
  routePlans?: TechnicianRoutePlan[];
  selectedTechId?: string;
  height?: string;
}

const ROUTE_COLORS = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2'];

export const LiveMapViewer: React.FC<Props> = ({
  centers,
  technicians,
  routePlans = [],
  selectedTechId,
  height = '500px'
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    // Default center on Delhi NCR
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

    // 1. Add Centers
    centers.forEach(c => {
      if (c.latitude && c.longitude && !isNaN(c.latitude) && !isNaN(c.longitude)) {
        bounds.extend([c.latitude, c.longitude]);

        const dcIcon = L.divIcon({
          className: 'dc-map-marker',
          html: `
            <div style="background-color: #0f172a; width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center; justify-content: center; border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3); color: white; font-size: 11px; font-weight: bold;">
              DC
            </div>
          `,
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        });

        const marker = L.marker([c.latitude, c.longitude], { icon: dcIcon }).addTo(map);
        marker.bindPopup(`
          <div style="font-family: sans-serif; font-size: 12px;">
            <strong style="color: #0f172a; font-size: 13px;">${c.name}</strong><br/>
            <span>City: ${c.city}</span><br/>
            <span>Default DC: ${c.defaultDc || 'None'}</span><br/>
            <span>Coords: ${c.latitude.toFixed(4)}, ${c.longitude.toFixed(4)}</span><br/>
            <span style="display: inline-block; margin-top: 4px; padding: 2px 6px; background: ${c.active ? '#ecfdf5; color: #047857;' : '#fef2f2; color: #b91c1c;'} border-radius: 4px; font-weight: 500;">
              ${c.active ? 'Active Center' : 'Inactive'}
            </span>
          </div>
        `);
      }
    });

    // 2. Add Technicians Start Locations
    technicians.forEach(t => {
      if (t.startingLatitude && t.startingLongitude) {
        bounds.extend([t.startingLatitude, t.startingLongitude]);

        const isHighlight = selectedTechId === t.id;
        const techIcon = L.divIcon({
          className: 'tech-map-marker',
          html: `
            <div style="background-color: ${isHighlight ? '#dc2626' : '#2563eb'}; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3); color: white; font-size: 10px; font-weight: bold;">
              🔧
            </div>
          `,
          iconSize: [26, 26],
          iconAnchor: [13, 13]
        });

        const marker = L.marker([t.startingLatitude, t.startingLongitude], { icon: techIcon }).addTo(map);
        marker.bindPopup(`
          <div style="font-family: sans-serif; font-size: 12px;">
            <strong style="color: #1e3a8a; font-size: 13px;">${t.name}</strong> (${t.employeeId})<br/>
            <span>Role: ${t.role}</span><br/>
            <span>Phone: ${t.phone}</span><br/>
            <span>Starting DC: ${t.defaultDc || 'Not set'}</span><br/>
            <span>Coords: ${t.startingLatitude.toFixed(4)}, ${t.startingLongitude.toFixed(4)}</span>
          </div>
        `);
      }
    });

    // 3. Render Routes if present
    routePlans.forEach((plan, idx) => {
      if (selectedTechId && plan.technicianId !== selectedTechId) return;
      if (plan.stops.length === 0) return;

      const color = ROUTE_COLORS[idx % ROUTE_COLORS.length];
      const latlngs: [number, number][] = [[plan.startLat, plan.startLng]];

      plan.stops.forEach(stop => {
        latlngs.push([stop.latitude, stop.longitude]);
      });

      // Draw polyline
      const polyline = L.polyline(latlngs, {
        color: color,
        weight: selectedTechId ? 5 : 3,
        opacity: 0.85,
        dashArray: '4, 8'
      }).addTo(map);

      polyline.bindPopup(`
        <strong>${plan.technicianName} Route</strong><br/>
        Total Distance: ${plan.totalDistanceKm} km<br/>
        Est. Workload: ${plan.totalEstimatedMins} mins (${plan.stops.length} stops)
      `);
    });

    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [30, 30] });
    }

    mapInstanceRef.current = map;

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [centers, technicians, routePlans, selectedTechId]);

  return (
    <div className="relative w-full rounded-xl overflow-hidden border border-slate-200 shadow-xs bg-slate-100" style={{ height }}>
      <div ref={mapContainerRef} className="w-full h-full z-10" />
      <div className="absolute bottom-3 left-3 z-20 bg-white/95 backdrop-blur-xs px-3 py-2 rounded-lg border border-slate-200 shadow-sm text-xs space-y-1">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 bg-slate-900 rounded-xs inline-block"></span>
          <span className="text-slate-700">Center / DC Hub</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 bg-blue-600 rounded-full inline-block"></span>
          <span className="text-slate-700">Technician Starting Base</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-5 h-0.5 bg-blue-500 border border-dashed inline-block"></span>
          <span className="text-slate-700">Optimized Transit Route</span>
        </div>
      </div>
    </div>
  );
};
