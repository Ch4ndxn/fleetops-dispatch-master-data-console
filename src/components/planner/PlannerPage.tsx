/**
 * L3 Technician Planner — hex clusters, spare hubs, roster/tickets/tracker/attendance
 * Runs on live database data for ANY city region (Delhi NCR, Mumbai, Bangalore, …).
 *
 * This component:
 *   • lets the user pick a region from a dropdown in the top bar,
 *   • filters centers / tickets / technicians to that region,
 *   • pushes fresh data into the planner engine whenever the database changes,
 *   • persists edits made in the planner back to the database.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import 'leaflet/dist/leaflet.css';
import './ncrPlanner.css';
import { NCR_PLANNER_MARKUP } from './ncrPlannerMarkup';
import { mountNcrPlanner } from './ncrPlannerEngine.js';
import RAW_VEHICLES from '../../data/vehicles.json';
import {
  getCenters, getTickets, getTechnicians, getAttendance,
  upsertTicket, upsertTechnician, upsertAttendanceRecord, saveTickets,
  subscribeToDataChanges, getSyncState, refreshFromDb,
} from '../../services/storage';
import type { Ticket, AttendanceStatus, TicketStatus } from '../../types';
import { localDate } from '../../lib/date';

const today = () => localDate();
const LOCAL_KEY = (regionKey: string) => `fo_planner_${regionKey}_${today()}`;
const norm = (s: string) => (s || '').trim().toLowerCase();

// ── Region definitions ──────────────────────────────────────────────────────
// cities: vehicle.city values that belong to this region
// mapCenter: [lat, lng] for Leaflet initial view
interface PlannerRegion {
  key: string;
  label: string;
  cities: string[];          // from vehicles.json city field
  mapCenter: [number, number];
  mapZoom: number;
  vehicleCount: number;
  recommendedTechs: number;
}

const PLANNER_REGIONS: PlannerRegion[] = [
  {
    key: 'delhi_ncr', label: 'Delhi NCR',
    cities: ['Delhi', 'Gurgaon', 'Noida', 'Faridabad', 'Ghaziabad', 'Palwal', 'Sohna'],
    mapCenter: [28.58, 77.18], mapZoom: 11, vehicleCount: 156, recommendedTechs: 10,
  },
  {
    key: 'mumbai', label: 'Mumbai',
    cities: ['Mumbai', 'Thane', 'Jasai'],
    mapCenter: [19.10, 72.95], mapZoom: 11, vehicleCount: 136, recommendedTechs: 9,
  },
  {
    key: 'bangalore', label: 'Bangalore',
    cities: ['Bangalore', 'Bengaluru', 'Devanahalli', 'Doddaballapura'],
    mapCenter: [12.97, 77.59], mapZoom: 11, vehicleCount: 103, recommendedTechs: 7,
  },
  {
    key: 'pune', label: 'Pune',
    cities: ['Pune'],
    mapCenter: [18.52, 73.86], mapZoom: 12, vehicleCount: 50, recommendedTechs: 3,
  },
  {
    key: 'chennai', label: 'Chennai',
    cities: ['Chennai'],
    mapCenter: [13.08, 80.20], mapZoom: 12, vehicleCount: 44, recommendedTechs: 3,
  },
  {
    key: 'ahmedabad', label: 'Ahmedabad',
    cities: ['Ahmedabad', 'Gandhinagar', 'Kalol'],
    mapCenter: [23.02, 72.57], mapZoom: 12, vehicleCount: 30, recommendedTechs: 2,
  },
  {
    key: 'punjab', label: 'Punjab',
    cities: ['Chandigarh', 'Mohali', 'Zirakpur', 'Patiala', 'Ambala', 'DeraBassi',
             'Machhiwara', 'Morinda', 'Patran', 'Rajpura', 'SirhindFatehgarh'],
    mapCenter: [30.73, 76.78], mapZoom: 10, vehicleCount: 29, recommendedTechs: 2,
  },
  {
    key: 'surat', label: 'Surat',
    cities: ['Surat'],
    mapCenter: [21.17, 72.83], mapZoom: 12, vehicleCount: 22, recommendedTechs: 1,
  },
  {
    key: 'hyderabad', label: 'Hyderabad',
    cities: ['Hyderabad', 'Hyd', 'Medchal'],
    mapCenter: [17.44, 78.50], mapZoom: 12, vehicleCount: 21, recommendedTechs: 1,
  },
  {
    key: 'goa', label: 'Goa',
    cities: ['Goa', 'Canacona'],
    mapCenter: [15.49, 73.82], mapZoom: 12, vehicleCount: 10, recommendedTechs: 1,
  },
  {
    key: 'raipur', label: 'Raipur',
    cities: ['Raipur'],
    mapCenter: [21.25, 81.65], mapZoom: 13, vehicleCount: 10, recommendedTechs: 1,
  },
  {
    key: 'ap', label: 'Andhra Pradesh',
    cities: ['Vijayawada', 'Guntur', 'Vuyyuru'],
    mapCenter: [16.31, 80.44], mapZoom: 11, vehicleCount: 10, recommendedTechs: 1,
  },
  {
    key: 'jaipur', label: 'Jaipur',
    cities: ['Jaipur'],
    mapCenter: [26.91, 75.79], mapZoom: 12, vehicleCount: 8, recommendedTechs: 1,
  },
  {
    key: 'up', label: 'Uttar Pradesh',
    cities: ['Varanasi'],
    mapCenter: [25.32, 82.99], mapZoom: 13, vehicleCount: 2, recommendedTechs: 1,
  },
];

// ── Vehicles per center ──────────────────────────────────────────────────────
const VEHICLES_BY_CENTER = new Map<string, string[]>();
(RAW_VEHICLES as Array<{ center: string; chassisNo: string; contractNo: string }>).forEach(v => {
  const key = norm(v.center.replace(/\s*\([^)]*\)\s*$/, ''));
  if (!VEHICLES_BY_CENTER.has(key)) VEHICLES_BY_CENTER.set(key, []);
  VEHICLES_BY_CENTER.get(key)!.push(v.chassisNo || v.contractNo);
});

// ── Status mapping ────────────────────────────────────────────────────────────
type PlannerStatus = 'assigned' | 'visited' | 'closed';
const toPlannerStatus = (s: TicketStatus): PlannerStatus =>
  s === 'Resolved' || s === 'Closed' ? 'closed' : s === 'In Progress' || s === 'Pending Spares' ? 'visited' : 'assigned';
const fromPlannerStatus: Record<PlannerStatus, TicketStatus> = { assigned: 'Assigned', visited: 'In Progress', closed: 'Resolved' };
const ATT_IN: Record<AttendanceStatus, string> = { Present: 'present', 'Half-Day': 'halfday', Absent: 'absent', 'On Leave': 'absent' };
const ATT_OUT: Record<string, AttendanceStatus> = { present: 'Present', halfday: 'Half-Day', absent: 'Absent' };

// ── Build planner data filtered to a region ──────────────────────────────────
function buildPlannerData(region: PlannerRegion) {
  const T = today();
  const citySet = new Set(region.cities.map(c => c.toLowerCase()));

  // Centers in this region (by city field)
  const allCenters = getCenters().filter(c => c.active !== false && Number.isFinite(c.latitude) && Number.isFinite(c.longitude));
  const centers = allCenters.filter(c => !c.city || citySet.has((c.city || '').toLowerCase()));
  // If no centers match city filter (e.g. city not in Centers table), fall back to all
  const usedCenters = centers.length > 0 ? centers : allCenters;

  const dcs = usedCenters.map(c => ({
    c: c.name, city: c.city, lat: c.latitude, lon: c.longitude,
    v: VEHICLES_BY_CENTER.get(norm(c.name)) ?? [],
  }));
  const dcByName = new Map(dcs.map(d => [norm(d.c), d]));
  const centerNameSet = new Set(dcs.map(d => norm(d.c)));

  // Tickets whose center is in this region
  const allTickets = getTickets();
  const ignoredCount = allTickets.filter(t =>
    t.ignoreForRouting && t.status !== 'Resolved' && t.status !== 'Closed' &&
    centerNameSet.has(norm(t.centerName))
  ).length;
  const relevant = allTickets
    .filter(t => !t.ignoreForRouting)
    .filter(t => t.status !== 'Resolved' && t.status !== 'Closed')
    .filter(t => centerNameSet.has(norm(t.centerName)));

  let unroutable = 0;
  const ticketStatus: Record<string, PlannerStatus> = {};
  const assignments: Record<string, string> = {};
  const tickets = relevant.map((t: Ticket) => {
    const dc = dcByName.get(norm(t.centerName));
    if (!dc) unroutable++;
    const opened = (t.createdAt || '').slice(0, 10);
    const ageDays = opened ? Math.max(0, Math.floor((Date.now() - new Date(opened).getTime()) / 86400000)) : 0;
    ticketStatus[t.ticketId] = toPlannerStatus(t.status);
    if (t.assignedTechnicianId) assignments[t.ticketId] = t.assignedTechnicianId;
    return {
      ticket: t.ticketId, vehicle: t.vehicleNumber, month_rep: 1,
      center: dc ? dc.c : t.centerName, city: dc?.city ?? '',
      issue: t.issue, category: t.category ?? '', issue_type: t.issueType ?? '',
      breakdown_date: opened, downtime: ageDays, affected_spare: t.affectedSpare ?? '',
      tat_breach: '', penalty_cost: 0, quotation: 0, stm: '', sm: '', bucket: '',
      priority: t.priority,
    };
  });

  // Technicians in this region (by zone/city) — fall back to all if none match
  const allTechs = getTechnicians().filter(t => t.status === 'Active');
  const regionTechs = allTechs.filter(t => {
    const z = (t.zone || t.city || '').toLowerCase();
    return region.cities.some(c => z.includes(c.toLowerCase()));
  });
  const techPool = regionTechs.length > 0 ? regionTechs : allTechs;
  const located = techPool.filter(t => Number.isFinite(t.startingLatitude) && Number.isFinite(t.startingLongitude));
  const techs = located
    .sort((a, b) => a.employeeId.localeCompare(b.employeeId))
    .map(t => ({ _id: t.id, employeeId: t.employeeId, name: t.name, zone: t.zone || t.city, homeLat: t.startingLatitude!, homeLon: t.startingLongitude! }));

  const attendance: Record<string, { status: string; timeIn: string; note: string }> = {};
  getAttendance().filter(a => a.date === T).forEach(a => {
    const tech = located.find(t => t.employeeId.toUpperCase() === a.employeeId.toUpperCase());
    if (tech) attendance[tech.id] = { status: ATT_IN[a.status] ?? 'present', timeIn: a.checkInTime || '09:00', note: a.notes || '' };
  });

  return {
    data: { dcs, tickets, techs, attendance, ticketStatus, assignments, regionLabel: region.label, mapCenter: region.mapCenter, mapZoom: region.mapZoom },
    issues: { ignored: ignoredCount, unroutable, techsWithoutLocation: allTechs.length - located.length, ticketCount: tickets.length },
  };
}

export function PlannerPage() {
  const rootRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<{ update: (d: unknown) => void; destroy: () => void } | null>(null);
  const [, setTick] = useState(0);
  const [selectedRegion, setSelectedRegion] = useState<PlannerRegion>(PLANNER_REGIONS[0]);
  const [issues, setIssues] = useState(() => buildPlannerData(PLANNER_REGIONS[0]).issues);
  const sync = getSyncState();

  const mountPlanner = useCallback((region: PlannerRegion) => {
    const root = rootRef.current!;
    // Tear down previous instance
    if (engineRef.current) {
      engineRef.current.destroy();
      engineRef.current = null;
    }
    root.innerHTML = NCR_PLANNER_MARKUP;

    const initial = buildPlannerData(region);
    setIssues(initial.issues);
    let lastSig = JSON.stringify(initial.data);
    let saved: unknown = null;
    try { saved = JSON.parse(localStorage.getItem(LOCAL_KEY(region.key)) || 'null'); } catch { /* ignore */ }

    const clearAssignment = (t: Ticket) => upsertTicket({
      ticketId: t.ticketId, vehicleNumber: t.vehicleNumber, centerName: t.centerName,
      assignedTechnicianId: undefined, assignedTechnicianName: undefined,
      ...(t.status === 'Assigned' ? { status: 'Open' as TicketStatus } : {}),
    });
    const ticketById = (id: string) => getTickets().find(t => t.ticketId.toUpperCase() === id.toUpperCase());

    const hooks = {
      saveLocal: (state: unknown) => { try { localStorage.setItem(LOCAL_KEY(region.key), JSON.stringify(state)); } catch { /* ignore */ } },
      onTicketStatus: (ticketId: string, st: PlannerStatus) => {
        const t = ticketById(ticketId); if (!t) return;
        upsertTicket({ ticketId: t.ticketId, vehicleNumber: t.vehicleNumber, centerName: t.centerName, status: fromPlannerStatus[st] });
      },
      onReassign: (ticketId: string, tech: { _id: string; name: string } | null) => {
        const t = ticketById(ticketId); if (!t) return;
        if (tech) {
          upsertTicket({
            ticketId: t.ticketId, vehicleNumber: t.vehicleNumber, centerName: t.centerName,
            assignedTechnicianId: tech._id, assignedTechnicianName: tech.name,
            ...(t.status === 'Open' ? { status: 'Assigned' as TicketStatus } : {}),
          });
        } else {
          clearAssignment(t);
        }
      },
      onAssignMany: (list: Array<{ ticketId: string; tech: { _id: string; name: string } }>) => {
        const byTicket = new Map(list.map(x => [x.ticketId.toUpperCase(), x.tech]));
        const now = new Date().toISOString();
        saveTickets(getTickets().map(t => {
          const tech = byTicket.get(t.ticketId.toUpperCase());
          if (!tech || t.assignedTechnicianId === tech._id) return t;
          return { ...t, assignedTechnicianId: tech._id, assignedTechnicianName: tech.name,
            status: t.status === 'Open' ? 'Assigned' as TicketStatus : t.status, updatedAt: now };
        }));
      },
      onClearAssignments: (ticketIds: string[]) => {
        ticketIds.forEach(id => { const t = ticketById(id); if (t) clearAssignment(t); });
      },
      onApplyAttendance: (rows: Array<{ tech: { employeeId: string; name: string }; status: string; timeIn: string; note: string }>) => {
        rows.forEach(r => upsertAttendanceRecord({
          employeeId: r.tech.employeeId, technicianName: r.tech.name, date: today(),
          status: ATT_OUT[r.status] ?? 'Present',
          checkInTime: r.status === 'absent' ? '' : (r.timeIn || '09:00'),
          notes: r.note || '',
        }));
      },
      onAddTech: ({ name, zone, lat, lon }: { name: string; zone: string; lat: number; lon: number }) => {
        const maxNum = getTechnicians().reduce((m, t) => Math.max(m, parseInt(t.employeeId.replace(/\D/g, ''), 10) || 0), 1100);
        upsertTechnician({ employeeId: `${region.key.toUpperCase().slice(0,3)}-${maxNum + 1}`, name, zone, startingLatitude: lat, startingLongitude: lon, status: 'Active' });
      },
      onEditTech: (t: { employeeId: string; name: string; zone: string; homeLat: number; homeLon: number }) => {
        upsertTechnician({ employeeId: t.employeeId, name: t.name, zone: t.zone, startingLatitude: t.homeLat, startingLongitude: t.homeLon });
      },
      onRemoveTech: (t: { employeeId: string; name: string }) => {
        upsertTechnician({ employeeId: t.employeeId, name: t.name, status: 'Inactive' });
      },
    };

    engineRef.current = mountNcrPlanner(root, initial.data, hooks, saved);

    // Live data subscription for this mount
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeToDataChanges(() => {
      setTick(n => n + 1);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const next = buildPlannerData(region);
        setIssues(next.issues);
        const sig = JSON.stringify(next.data);
        if (sig === lastSig) return;
        lastSig = sig;
        engineRef.current?.update(next.data);
      }, 300);
    });

    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  // Remount whenever region changes
  useEffect(() => {
    if (!rootRef.current) return;
    const cleanup = mountPlanner(selectedRegion);
    return () => {
      cleanup();
      if (engineRef.current) {
        engineRef.current.destroy();
        engineRef.current = null;
      }
    };
  }, [selectedRegion, mountPlanner]);

  const dot = sync.saveError ? '#EF4444' : sync.status === 'synced' ? '#10B981' : sync.status === 'error' ? '#EF4444' : sync.status === 'loading' ? '#F59E0B' : '#94A3B8';

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Top bar */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-1 text-[11px] bg-white border-b border-slate-200 text-slate-600">
        <span className="w-2 h-2 rounded-full" style={{ background: dot }} />

        {/* Region picker */}
        <select
          value={selectedRegion.key}
          onChange={e => {
            const r = PLANNER_REGIONS.find(p => p.key === e.target.value);
            if (r) setSelectedRegion(r);
          }}
          className="text-[11px] border border-slate-200 rounded px-2 py-0.5 bg-white text-slate-700 font-semibold focus:outline-none focus:ring-1 focus:ring-teal-500 shrink-0"
        >
          {PLANNER_REGIONS.map(r => (
            <option key={r.key} value={r.key}>
              {r.label} ({r.vehicleCount}V · {r.recommendedTechs}T rec.)
            </option>
          ))}
        </select>

        <span className="text-slate-300">|</span>

        <span className="truncate" title={[sync.error, ...(sync.warnings ?? [])].filter(Boolean).join('\n')}>
          {sync.status === 'synced' && `Live · ${new Date(sync.lastSyncedAt!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
          {sync.status === 'loading' && 'Loading…'}
          {sync.status === 'error' && `Cached · ${sync.error}`}
          {sync.status === 'disabled' && 'Browser only'}
        </span>
        {sync.saveError && (
          <span className="text-rose-700 font-semibold truncate" title={sync.saveError}>· {sync.saveError}</span>
        )}
        {issues.ignored > 0 && (
          <span className="text-slate-500 whitespace-nowrap" title="Ignored from Active Cases — not planned">
            · {issues.ignored} ignored
          </span>
        )}
        {issues.unroutable > 0 && (
          <span className="text-amber-700 font-semibold whitespace-nowrap" title="Center missing coordinates">
            · {issues.unroutable} unroutable
          </span>
        )}
        {issues.techsWithoutLocation > 0 && (
          <span className="text-amber-700 font-semibold whitespace-nowrap">
            · {issues.techsWithoutLocation} techs no location
          </span>
        )}
        {issues.ticketCount === 0 && (
          <span className="text-emerald-700 font-semibold whitespace-nowrap">
            · ✓ No open tickets in {selectedRegion.label}
          </span>
        )}
        {sync.status !== 'disabled' && (
          <button onClick={() => refreshFromDb()} className="ml-auto font-semibold text-teal-700 hover:underline shrink-0">Refresh</button>
        )}
      </div>

      {/* Planner engine mount point */}
      <div ref={rootRef} className="ncrp flex-1 min-h-0" />
    </div>
  );
}
