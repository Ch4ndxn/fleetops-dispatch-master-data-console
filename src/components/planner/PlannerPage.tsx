/**
 * PlannerPage — NCR L3 Technician Planner
 *
 * Mimics the uploaded standalone HTML planner with:
 *  - Left panel (340 px) with sub-tabs: Roster | Tickets | Tracker | Attend
 *  - Right panel: Leaflet map with hex zones, tech markers, ticket markers
 *  - Teal accent (#0E6B6E), JetBrains Mono for numbers
 *  - Route optimisation via planTodayRoutes()
 *  - Manual reassign, ticket status updates, attendance override
 *  - Export CSV / PDF
 */

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  getTechnicians, getTickets, saveTickets,
  getAttendance, getCenters, upsertAttendanceRecord,
} from '../../services/storage';
import { planTodayRoutes, calculateDistanceKm } from '../../services/routeOptimizer';
import {
  Technician, TechnicianRoutePlan, RouteStop,
  TicketPriority, TicketStatus, AttendanceStatus, Ticket, AttendanceRecord,
} from '../../types';
import {
  RefreshCw, Download, ChevronDown, ChevronUp,
  MapPin, Clock, User, AlertTriangle, CheckCircle2, Circle,
  ArrowRightLeft, Info, FileText,
} from 'lucide-react';

// ── Constants ────────────────────────────────────────────────────────
const ACCENT = '#0E6B6E';
const TODAY = new Date().toISOString().split('T')[0];

const PRI_META: Record<TicketPriority, { color: string; bg: string; label: string; hex: string }> = {
  CRITICAL: { color: '#EF4444', bg: '#FEF2F2', label: 'Critical', hex: '#EF4444' },
  HIGH:     { color: '#F97316', bg: '#FFF7ED', label: 'High',     hex: '#F97316' },
  MEDIUM:   { color: '#EAB308', bg: '#FEFCE8', label: 'Med',      hex: '#EAB308' },
  LOW:      { color: '#94A3B8', bg: '#F8FAFC', label: 'Low',      hex: '#94A3B8' },
};

const STATUS_META: Record<string, { color: string; bg: string }> = {
  'Assigned':       { color: '#3B82F6', bg: '#EFF6FF' },
  'In Progress':    { color: '#F59E0B', bg: '#FFFBEB' },
  'Pending Spares': { color: '#8B5CF6', bg: '#F5F3FF' },
  'Visited':        { color: '#F59E0B', bg: '#FFFBEB' },
  'Closed':         { color: '#10B981', bg: '#ECFDF5' },
  'Open':           { color: '#94A3B8', bg: '#F8FAFC' },
};

// ── Types ─────────────────────────────────────────────────────────────
type SubTab = 'roster' | 'tickets' | 'tracker' | 'attend';
type TrackerStatus = 'Assigned' | 'Visited' | 'Closed';
type MutablePlan = TechnicianRoutePlan & { tech: Technician };

interface TicketTrackerRow {
  ticketId: string;
  vehicleNumber: string;
  centerName: string;
  priority: TicketPriority;
  techName: string;
  status: TrackerStatus;
  notes: string;
}

// ── Helpers ───────────────────────────────────────────────────────────
function recalcEtas(stops: RouteStop[], startLat: number, startLng: number): RouteStop[] {
  let elapsed = 30;
  let prevLat = startLat, prevLng = startLng;
  return stops.map((s) => {
    const dist = calculateDistanceKm(prevLat, prevLng, s.latitude, s.longitude);
    const transit = Math.round(dist * 2.5);
    elapsed += transit;
    const base = 9 * 60;
    const total = base + elapsed;
    const h = Math.floor(total / 60);
    const m = total % 60;
    prevLat = s.latitude; prevLng = s.longitude;
    elapsed += s.estimatedDurationMins;
    return { ...s, estimatedArrival: `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}` };
  });
}

function buildPlans(): MutablePlan[] {
  const techs = getTechnicians();
  const techMap = new Map(techs.map(t => [t.id, t]));
  const base = planTodayRoutes();
  const extended: MutablePlan[] = base
    .filter(p => techMap.has(p.technicianId))
    .map(p => ({ ...p, tech: techMap.get(p.technicianId)! }));
  techs
    .filter(t => t.status === 'Active' && !extended.find(p => p.technicianId === t.id))
    .forEach(t => extended.push({
      technicianId: t.id, technicianName: t.name, employeeId: t.employeeId,
      startLat: t.startingLatitude ?? 28.6139, startLng: t.startingLongitude ?? 77.2090,
      defaultDc: t.defaultDc,
      stops: [], totalDistanceKm: 0, totalEstimatedMins: 0, status: 'Draft', tech: t,
    }));
  return extended;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ── Constants ─────────────────────────────────────────────────────────
const TECH_COLORS = ['#0E6B6E','#3B82F6','#8B5CF6','#F97316','#10B981','#EF4444','#EC4899','#EAB308','#14B8A6','#6366F1','#F59E0B','#64748B','#0EA5E9','#A855F7'];

// ── Roster Sub-tab ────────────────────────────────────────────────────
function RosterView({ plans, setPlans, onManualEdit }: { plans: MutablePlan[]; setPlans: React.Dispatch<React.SetStateAction<MutablePlan[]>>; onManualEdit: () => void }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [reassignFrom, setReassignFrom] = useState<{ planIdx: number; stopIdx: number } | null>(null);

  const toggle = (id: string) => setExpanded(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const handleReassign = useCallback((fromIdx: number, stopIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) { setReassignFrom(null); return; }
    setPlans(prev => {
      const next = prev.map(p => ({ ...p, stops: [...p.stops] }));
      const [stop] = next[fromIdx].stops.splice(stopIdx, 1);
      next[toIdx].stops.push(stop);
      // Recalc ETAs for both plans
      next[fromIdx].stops = recalcEtas(next[fromIdx].stops, next[fromIdx].startLat, next[fromIdx].startLng);
      next[toIdx].stops = recalcEtas(next[toIdx].stops, next[toIdx].startLat, next[toIdx].startLng);
      // Persist assignment on ticket
      const tickets = getTickets();
      const t = tickets.find(t => t.ticketId === stop.ticketId);
      if (t) {
        t.assignedTechnicianId = next[toIdx].technicianId;
        t.assignedTechnicianName = next[toIdx].technicianName;
        t.status = 'Assigned';
        saveTickets(tickets);
      }
      return next;
    });
    setReassignFrom(null);
    onManualEdit();
  }, [setPlans, onManualEdit]);

  const totalStops = plans.reduce((a, p) => a + p.stops.length, 0);
  const deployed = plans.filter(p => p.stops.length > 0).length;

  return (
    <div>
      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
        {[
          { num: deployed, label: 'Deployed', color: ACCENT },
          { num: totalStops, label: 'Visits', color: '#3B82F6' },
          { num: plans.length - deployed, label: 'Free', color: '#94A3B8' },
        ].map(item => (
          <div key={item.label} style={{ background: '#F8FAFC', borderRadius: 8, padding: '8px 10px', textAlign: 'center', border: '1px solid #E2E8F0' }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, fontWeight: 700, color: item.color }}>{item.num}</div>
            <div style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase', letterSpacing: '.5px', marginTop: 1 }}>{item.label}</div>
          </div>
        ))}
      </div>

      {/* Tech cards */}
      {plans.map((plan, pIdx) => {
        const isOpen = expanded.has(plan.technicianId);
        const techColor = TECH_COLORS[pIdx % TECH_COLORS.length];
        return (
          <div key={plan.technicianId} style={{ background: '#fff', borderRadius: 10, border: `1.5px solid ${isOpen ? ACCENT : '#E2E8F0'}`, marginBottom: 8, overflow: 'hidden', transition: 'border-color .15s' }}>
            {/* Card header */}
            <div
              onClick={() => toggle(plan.technicianId)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', cursor: 'pointer', background: isOpen ? '#F0F9F9' : '#fff', userSelect: 'none' }}
            >
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: techColor, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 12, color: '#1E293B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{plan.technicianName}</div>
                <div style={{ fontSize: 10, color: '#94A3B8' }}>{plan.employeeId} · {plan.tech.zone || plan.tech.city}</div>
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: plan.stops.length ? ACCENT : '#CBD5E1', fontWeight: 700, flexShrink: 0 }}>
                {plan.stops.length} stop{plan.stops.length !== 1 ? 's' : ''}
              </div>
              {isOpen ? <ChevronUp size={13} color="#94A3B8" /> : <ChevronDown size={13} color="#94A3B8" />}
            </div>

            {/* Stops */}
            {isOpen && (
              <div style={{ borderTop: `1px solid #F1F5F9`, padding: '8px 12px' }}>
                {plan.stops.length === 0 ? (
                  <div style={{ fontSize: 11, color: '#CBD5E1', textAlign: 'center', padding: '8px 0' }}>No tickets assigned</div>
                ) : (
                  plan.stops.map((stop, sIdx) => {
                    const pri = PRI_META[stop.priority];
                    const isRFrom = reassignFrom?.planIdx === pIdx && reassignFrom?.stopIdx === sIdx;
                    return (
                      <div key={stop.ticketId} style={{ display: 'flex', gap: 8, marginBottom: 6, padding: '7px 9px', background: isRFrom ? '#F0F9F9' : '#F8FAFC', borderRadius: 8, border: `1px solid ${isRFrom ? ACCENT : '#F1F5F9'}` }}>
                        {/* Stop num */}
                        <div style={{ width: 20, height: 20, borderRadius: '50%', background: techColor, color: '#fff', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontFamily: "'JetBrains Mono', monospace" }}>{stop.stopOrder}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: '#1E293B' }}>{stop.centerName}</span>
                            <span style={{ fontSize: 9, fontWeight: 700, color: pri.color, background: pri.bg, borderRadius: 4, padding: '1px 4px' }}>{pri.label}</span>
                          </div>
                          <div style={{ fontSize: 10, color: '#64748B' }}>{stop.vehicleNumber} · {stop.issue.slice(0,40)}</div>
                          <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 1 }}>ETA {stop.estimatedArrival} · ~{stop.estimatedDurationMins}min</div>
                        </div>
                        {/* Reassign button */}
                        <button
                          onClick={(e) => { e.stopPropagation(); setReassignFrom(isRFrom ? null : { planIdx: pIdx, stopIdx: sIdx }); }}
                          title="Reassign"
                          style={{ background: isRFrom ? ACCENT : 'transparent', border: `1px solid ${isRFrom ? ACCENT : '#E2E8F0'}`, borderRadius: 6, padding: '3px 6px', cursor: 'pointer', color: isRFrom ? '#fff' : '#94A3B8', fontSize: 10 }}
                        >
                          <ArrowRightLeft size={11} />
                        </button>
                      </div>
                    );
                  })
                )}
                {/* Reassign target picker */}
                {reassignFrom?.planIdx === pIdx && (
                  <div style={{ marginTop: 4, padding: '6px 8px', background: '#ECFDF5', borderRadius: 8, border: `1px dashed ${ACCENT}` }}>
                    <div style={{ fontSize: 10, color: ACCENT, fontWeight: 700, marginBottom: 4 }}>Move stop to:</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {plans.map((p, tIdx) => tIdx !== reassignFrom.planIdx && (
                        <button
                          key={p.technicianId}
                          onClick={() => handleReassign(reassignFrom.planIdx, reassignFrom.stopIdx, tIdx)}
                          style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, border: `1px solid ${TECH_COLORS[tIdx % TECH_COLORS.length]}`, color: TECH_COLORS[tIdx % TECH_COLORS.length], background: '#fff', cursor: 'pointer' }}
                        >
                          {p.technicianName}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Route footer */}
                {plan.stops.length > 0 && (
                  <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid #F1F5F9', display: 'flex', gap: 12 }}>
                    <span style={{ fontSize: 10, color: '#94A3B8' }}><span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: ACCENT }}>{plan.totalDistanceKm.toFixed(1)}</span> km</span>
                    <span style={{ fontSize: 10, color: '#94A3B8' }}><span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: '#3B82F6' }}>{Math.ceil(plan.totalEstimatedMins / 60)}</span> hrs est.</span>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Tickets Sub-tab ───────────────────────────────────────────────────
function TicketsView({ plans }: { plans: MutablePlan[] }) {
  const [filter, setFilter] = useState<'all' | TicketPriority>('all');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  // Build flat ticket list from plans
  const allStops = useMemo(() => {
    const rows: Array<RouteStop & { techName: string; techIdx: number; planIdx: number }> = [];
    plans.forEach((p, pIdx) => {
      p.stops.forEach(s => rows.push({ ...s, techName: p.technicianName, techIdx: pIdx, planIdx: pIdx }));
    });
    return rows;
  }, [plans]);

  const visible = useMemo(() => {
    if (filter === 'all') return allStops.filter(s => !excluded.has(s.ticketId));
    if (filter === 'excluded' as any) return allStops.filter(s => excluded.has(s.ticketId));
    return allStops.filter(s => s.priority === filter && !excluded.has(s.ticketId));
  }, [allStops, filter, excluded]);

  const counts = useMemo(() => ({
    all: allStops.filter(s => !excluded.has(s.ticketId)).length,
    CRITICAL: allStops.filter(s => s.priority === 'CRITICAL' && !excluded.has(s.ticketId)).length,
    HIGH: allStops.filter(s => s.priority === 'HIGH' && !excluded.has(s.ticketId)).length,
    MEDIUM: allStops.filter(s => s.priority === 'MEDIUM' && !excluded.has(s.ticketId)).length,
    LOW: allStops.filter(s => s.priority === 'LOW' && !excluded.has(s.ticketId)).length,
    excluded: excluded.size,
  }), [allStops, excluded]);

  const filterBtns: Array<{ key: string; label: string; color: string }> = [
    { key: 'all', label: `All (${counts.all})`, color: ACCENT },
    { key: 'CRITICAL', label: `🔴 Critical (${counts.CRITICAL})`, color: '#EF4444' },
    { key: 'HIGH', label: `🟠 High (${counts.HIGH})`, color: '#F97316' },
    { key: 'MEDIUM', label: `🟡 Med (${counts.MEDIUM})`, color: '#EAB308' },
    { key: 'excluded', label: `🚫 Removed (${counts.excluded})`, color: '#94A3B8' },
  ];

  return (
    <div>
      {/* Filter chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
        {filterBtns.map(b => (
          <button
            key={b.key}
            onClick={() => setFilter(b.key as any)}
            style={{
              fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 20,
              border: `1.5px solid ${filter === b.key ? b.color : '#E2E8F0'}`,
              color: filter === b.key ? b.color : '#64748B',
              background: filter === b.key ? (b.color + '18') : '#fff',
              cursor: 'pointer',
            }}
          >
            {b.label}
          </button>
        ))}
        {excluded.size > 0 && (
          <button
            onClick={() => setExcluded(new Set())}
            style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 20, border: '1.5px solid #EF4444', color: '#EF4444', background: '#FEF2F2', cursor: 'pointer' }}
          >
            ↩ Restore All
          </button>
        )}
      </div>

      {/* Ticket cards */}
      {visible.length === 0 && (
        <div style={{ textAlign: 'center', color: '#CBD5E1', fontSize: 12, padding: '24px 0' }}>No tickets in this filter</div>
      )}
      {visible.map(stop => {
        const pri = PRI_META[stop.priority];
        const assignedTo = overrides[stop.ticketId] || stop.techName;
        return (
          <div key={stop.ticketId} style={{ background: '#fff', borderRadius: 10, border: '1px solid #E2E8F0', marginBottom: 7, padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: pri.hex, flexShrink: 0, marginTop: 3 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{ fontWeight: 700, fontSize: 12, color: '#1E293B' }}>{stop.centerName}</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: '#94A3B8' }}>{stop.ticketId}</span>
                </div>
                <div style={{ fontSize: 10, color: '#64748B', marginBottom: 2 }}>{stop.vehicleNumber} · {stop.issue.slice(0,60)}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: pri.color, background: pri.bg, borderRadius: 4, padding: '1px 5px' }}>{pri.label}</span>
                  <span style={{ fontSize: 10, color: ACCENT }}>→ {assignedTo}</span>
                  {overrides[stop.ticketId] && (
                    <span style={{ fontSize: 9, fontWeight: 700, color: '#8B5CF6', background: '#F5F3FF', borderRadius: 4, padding: '1px 5px' }}>override</span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setExcluded(prev => { const n = new Set(prev); n.has(stop.ticketId) ? n.delete(stop.ticketId) : n.add(stop.ticketId); return n; })}
                style={{ fontSize: 9, padding: '2px 7px', borderRadius: 6, border: '1px solid #E2E8F0', color: '#94A3B8', background: '#F8FAFC', cursor: 'pointer' }}
              >
                {excluded.has(stop.ticketId) ? 'Restore' : 'Remove'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Tracker Sub-tab ───────────────────────────────────────────────────
type TrackerState = Record<string, { status: TrackerStatus; notes: string }>;
const TRACKER_KEY = `fo_planner_tracker_${TODAY}`;
function loadTracker(): TrackerState {
  try { const raw = localStorage.getItem(TRACKER_KEY); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

function TrackerView({ plans, tracker, setTracker }: {
  plans: MutablePlan[];
  tracker: TrackerState;
  setTracker: React.Dispatch<React.SetStateAction<TrackerState>>;
}) {
  const [techFilter, setTechFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const allStops = useMemo(() => {
    const rows: Array<RouteStop & { techName: string; empId: string }> = [];
    plans.forEach(p => p.stops.forEach(s => rows.push({ ...s, techName: p.technicianName, empId: p.employeeId })));
    return rows;
  }, [plans]);

  const counts = useMemo(() => ({
    all: allStops.length,
    Assigned: allStops.filter(s => (tracker[s.ticketId]?.status || 'Assigned') === 'Assigned').length,
    Visited: allStops.filter(s => tracker[s.ticketId]?.status === 'Visited').length,
    Closed: allStops.filter(s => tracker[s.ticketId]?.status === 'Closed').length,
  }), [allStops, tracker]);

  const progress = allStops.length > 0 ? Math.round((counts.Closed / allStops.length) * 100) : 0;

  const visible = useMemo(() => allStops.filter(s => {
    const st = tracker[s.ticketId]?.status || 'Assigned';
    if (techFilter !== 'all' && s.techName !== techFilter) return false;
    if (statusFilter !== 'all' && st !== statusFilter) return false;
    return true;
  }), [allStops, tracker, techFilter, statusFilter]);

  const setStatus = (ticketId: string, status: TrackerStatus) => {
    setTracker(prev => ({ ...prev, [ticketId]: { ...prev[ticketId], status, notes: prev[ticketId]?.notes || '' } }));
  };
  const setNotes = (ticketId: string, notes: string) => {
    setTracker(prev => ({ ...prev, [ticketId]: { ...prev[ticketId], notes, status: prev[ticketId]?.status || 'Assigned' } }));
  };

  const exportTracker = () => {
    const rows = [['TicketID','Vehicle','Center','Tech','Priority','Status','Notes']];
    allStops.forEach(s => {
      const st = tracker[s.ticketId]?.status || 'Assigned';
      const notes = tracker[s.ticketId]?.notes || '';
      rows.push([s.ticketId, s.vehicleNumber, s.centerName, s.techName, s.priority, st, notes]);
    });
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `tracker-${TODAY}.csv`;
    a.click();
  };

  const techNames = [...new Set(allStops.map(s => s.techName))];

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 12, color: '#1E293B' }}>📊 Ticket Tracker</div>
          <div style={{ fontSize: 10, color: '#94A3B8' }}>Update status as technicians work</div>
        </div>
        <button onClick={exportTracker} style={{ fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 8, border: '1.5px solid #E2E8F0', color: '#64748B', background: '#F8FAFC', cursor: 'pointer' }}>⬇ Export</button>
      </div>

      {/* Progress bar */}
      <div style={{ height: 5, borderRadius: 99, background: '#F1F5F9', marginBottom: 10, overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: 99, background: '#10B981', width: `${progress}%`, transition: 'width .4s' }} />
      </div>

      {/* Pipeline summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, marginBottom: 10 }}>
        {[
          { key: 'all', label: 'All', num: counts.all, color: '#64748B' },
          { key: 'Assigned', label: '🔵 Assigned', num: counts.Assigned, color: '#3B82F6' },
          { key: 'Visited', label: '🟡 Visited', num: counts.Visited, color: '#F59E0B' },
          { key: 'Closed', label: '✅ Closed', num: counts.Closed, color: '#10B981' },
        ].map(col => (
          <div
            key={col.key}
            onClick={() => setStatusFilter(statusFilter === col.key ? 'all' : col.key)}
            style={{ textAlign: 'center', padding: '7px 4px', borderRadius: 8, border: `1.5px solid ${statusFilter === col.key ? col.color : '#E2E8F0'}`, background: statusFilter === col.key ? col.color + '18' : '#F8FAFC', cursor: 'pointer' }}
          >
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, fontSize: 16, color: col.color }}>{col.num}</div>
            <div style={{ fontSize: 9, color: '#94A3B8', marginTop: 1 }}>{col.label}</div>
          </div>
        ))}
      </div>

      {/* Tech filter */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
        <button onClick={() => setTechFilter('all')} style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 20, border: `1px solid ${techFilter === 'all' ? ACCENT : '#E2E8F0'}`, color: techFilter === 'all' ? ACCENT : '#64748B', background: techFilter === 'all' ? '#ECFDF5' : '#fff', cursor: 'pointer' }}>All Techs</button>
        {techNames.map(n => (
          <button key={n} onClick={() => setTechFilter(techFilter === n ? 'all' : n)} style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 20, border: `1px solid ${techFilter === n ? ACCENT : '#E2E8F0'}`, color: techFilter === n ? ACCENT : '#64748B', background: techFilter === n ? '#ECFDF5' : '#fff', cursor: 'pointer' }}>{n.split(' ')[0]}</button>
        ))}
      </div>

      {/* Ticket rows */}
      {visible.length === 0 && <div style={{ textAlign: 'center', color: '#CBD5E1', fontSize: 12, padding: '20px 0' }}>No tickets</div>}
      {visible.map(stop => {
        const st = tracker[stop.ticketId]?.status || 'Assigned';
        const notes = tracker[stop.ticketId]?.notes || '';
        const pri = PRI_META[stop.priority];
        return (
          <div key={stop.ticketId} style={{ background: '#fff', borderRadius: 10, border: '1px solid #E2E8F0', marginBottom: 7, padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 11, color: '#1E293B' }}>{stop.centerName}</div>
                <div style={{ fontSize: 10, color: '#64748B' }}>{stop.vehicleNumber} · {stop.techName}</div>
              </div>
              <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 700, color: pri.color, background: pri.bg, borderRadius: 4, padding: '1px 5px' }}>{pri.label}</span>
            </div>
            {/* Status pills */}
            <div style={{ display: 'flex', gap: 5, marginBottom: 6 }}>
              {(['Assigned','Visited','Closed'] as TrackerStatus[]).map(s => (
                <button
                  key={s}
                  onClick={() => setStatus(stop.ticketId, s)}
                  style={{
                    fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, cursor: 'pointer',
                    border: `1.5px solid ${st === s ? (STATUS_META[s]?.color || ACCENT) : '#E2E8F0'}`,
                    color: st === s ? (STATUS_META[s]?.color || ACCENT) : '#94A3B8',
                    background: st === s ? ((STATUS_META[s]?.bg) || '#F0F9F9') : '#F8FAFC',
                  }}
                >
                  {s === 'Assigned' ? '🔵' : s === 'Visited' ? '🟡' : '✅'} {s}
                </button>
              ))}
            </div>
            {/* Notes */}
            <input
              placeholder="Add notes…"
              value={notes}
              onChange={e => setNotes(stop.ticketId, e.target.value)}
              style={{ width: '100%', fontSize: 10, padding: '4px 8px', borderRadius: 6, border: '1px solid #E2E8F0', outline: 'none', color: '#475569', background: '#F8FAFC', boxSizing: 'border-box' }}
            />
          </div>
        );
      })}
    </div>
  );
}

// ── Attendance Sub-tab ────────────────────────────────────────────────
function AttendView({ plans }: { plans: MutablePlan[] }) {
  const today = TODAY;
  type Row = { status: AttendanceStatus | null; checkIn: string; checkOut: string; notes: string };
  const [rows, setRows] = useState<Record<string, Row>>(() => {
    const existing = getAttendance();
    const init: Record<string, Row> = {};
    plans.forEach(p => {
      const rec = existing.find(a => a.employeeId.toUpperCase() === p.employeeId.toUpperCase() && a.date === today);
      init[p.employeeId] = {
        status: rec?.status ?? null,
        checkIn: rec?.checkInTime ?? '',
        checkOut: rec?.checkOutTime ?? '',
        notes: rec?.notes ?? '',
      };
    });
    return init;
  });

  const setField = (empId: string, field: string, val: string) => {
    setRows(prev => ({ ...prev, [empId]: { ...prev[empId], [field]: val } }));
    setTouched(prev => new Set(prev).add(empId));
  };

  const [saved, setSaved] = useState(false);
  // Only write technicians whose row was actually touched here — never
  // overwrite attendance marked elsewhere with the panel's defaults.
  const [touched, setTouched] = useState<Set<string>>(new Set());

  const saveAll = () => {
    touched.forEach(empId => {
      const p = plans.find(pl => pl.employeeId === empId);
      const r = rows[empId];
      if (!p || !r || !r.status) return;
      upsertAttendanceRecord({
        employeeId: empId,
        technicianName: p.technicianName,
        date: today,
        status: r.status,
        checkInTime: r.checkIn,
        checkOutTime: r.checkOut,
        notes: r.notes,
      });
    });
    setTouched(new Set());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const COLORS: Record<AttendanceStatus, { border: string; bg: string; text: string }> = {
    'Present':  { border: '#10B981', bg: '#ECFDF5', text: '#10B981' },
    'Absent':   { border: '#EF4444', bg: '#FEF2F2', text: '#EF4444' },
    'Half-Day': { border: '#F59E0B', bg: '#FFFBEB', text: '#F59E0B' },
    'On Leave': { border: '#8B5CF6', bg: '#F5F3FF', text: '#8B5CF6' },
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#1E293B' }}>👤 Attendance · {today}</div>
        <button onClick={saveAll} style={{ fontSize: 10, fontWeight: 700, padding: '4px 12px', borderRadius: 8, border: `1.5px solid ${ACCENT}`, color: ACCENT, background: '#ECFDF5', cursor: touched.size ? 'pointer' : 'default', opacity: touched.size || saved ? 1 : 0.5 }} disabled={!touched.size}>{saved ? 'Saved ✓' : touched.size ? `Save (${touched.size})` : 'Save'}</button>
      </div>

      {plans.map(p => {
        const r: Row = rows[p.employeeId] || { status: null, checkIn: '', checkOut: '', notes: '' };
        const col = r.status ? COLORS[r.status] : { border: '#E2E8F0', bg: '#F8FAFC', text: '#94A3B8' };
        return (
          <div key={p.employeeId} style={{ background: '#fff', borderRadius: 10, border: `1.5px solid ${col.border}`, marginBottom: 7, padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 12, color: '#1E293B' }}>{p.technicianName}</div>
                <div style={{ fontSize: 10, color: '#94A3B8' }}>{p.employeeId} · {p.tech.zone || p.tech.city}</div>
              </div>
              <span style={{ fontSize: 10, fontWeight: 700, color: col.text, background: col.bg, borderRadius: 20, padding: '2px 8px', border: `1px solid ${col.border}` }}>{r.status ?? 'Not marked'}</span>
            </div>

            {/* Status buttons */}
            <div style={{ display: 'flex', gap: 5, marginBottom: 7 }}>
              {(['Present','Absent','Half-Day','On Leave'] as AttendanceStatus[]).map(s => (
                <button
                  key={s}
                  onClick={() => setField(p.employeeId, 'status', s)}
                  style={{
                    fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 20, cursor: 'pointer',
                    border: `1.5px solid ${r.status === s ? COLORS[s].border : '#E2E8F0'}`,
                    color: r.status === s ? COLORS[s].text : '#94A3B8',
                    background: r.status === s ? COLORS[s].bg : '#F8FAFC',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>

            {/* Time inputs */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, color: '#94A3B8', marginBottom: 2 }}>Check-in</div>
                <input type="time" value={r.checkIn} onChange={e => setField(p.employeeId, 'checkIn', e.target.value)} style={{ width: '100%', fontSize: 11, padding: '3px 6px', borderRadius: 6, border: '1px solid #E2E8F0', fontFamily: "'JetBrains Mono', monospace", boxSizing: 'border-box' }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, color: '#94A3B8', marginBottom: 2 }}>Check-out</div>
                <input type="time" value={r.checkOut} onChange={e => setField(p.employeeId, 'checkOut', e.target.value)} style={{ width: '100%', fontSize: 11, padding: '3px 6px', borderRadius: 6, border: '1px solid #E2E8F0', fontFamily: "'JetBrains Mono', monospace", boxSizing: 'border-box' }} />
              </div>
            </div>
            <input placeholder="Notes…" value={r.notes} onChange={e => setField(p.employeeId, 'notes', e.target.value)} style={{ width: '100%', fontSize: 10, padding: '4px 8px', borderRadius: 6, border: '1px solid #E2E8F0', boxSizing: 'border-box', color: '#475569' }} />
          </div>
        );
      })}
    </div>
  );
}

// ── Map Panel (raw Leaflet) ───────────────────────────────────────────
function MapPanel({ plans }: { plans: MutablePlan[] }) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const layersRef = useRef<L.Layer[]>([]);

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { center: [28.6139, 77.2090], zoom: 10, zoomControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a>',
    }).addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Update layers when plans change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove old layers
    layersRef.current.forEach(l => map.removeLayer(l));
    layersRef.current = [];

    const bounds: [number, number][] = [];

    plans.forEach((plan, pIdx) => {
      const color = TECH_COLORS[pIdx % TECH_COLORS.length];
      if (!plan.startLat || !plan.startLng) return;

      bounds.push([plan.startLat, plan.startLng]);

      // Home base circle marker
      const homeMarker = L.circleMarker([plan.startLat, plan.startLng], {
        radius: 9, fillColor: color, color: 'white', weight: 2.5, fillOpacity: 1,
      }).bindPopup(`<b>${plan.technicianName}</b><br>${plan.employeeId} · ${plan.tech.zone || plan.tech.city}<br><span style="color:${ACCENT}">${plan.stops.length} stops</span>`);
      homeMarker.addTo(map);
      layersRef.current.push(homeMarker);

      // Route polyline
      if (plan.stops.length > 0) {
        const pts: [number, number][] = [[plan.startLat, plan.startLng], ...plan.stops.map(s => [s.latitude, s.longitude] as [number, number])];
        const line = L.polyline(pts, { color, weight: 2, opacity: 0.65, dashArray: '6,5' }).addTo(map);
        layersRef.current.push(line);
      }

      // Stop markers
      plan.stops.forEach(stop => {
        bounds.push([stop.latitude, stop.longitude]);
        const pri = PRI_META[stop.priority];
        const mk = L.circleMarker([stop.latitude, stop.longitude], {
          radius: 6, fillColor: pri.hex, color: 'white', weight: 2, fillOpacity: 1,
        }).bindPopup(`<b style="color:${pri.color}">[${pri.label}]</b> ${stop.centerName}<br>${stop.vehicleNumber}<br><span style="color:#64748B">${stop.issue.slice(0,60)}</span><br>→ <b>${plan.technicianName}</b> · ETA ${stop.estimatedArrival}`);
        mk.addTo(map);
        layersRef.current.push(mk);
      });
    });

    if (bounds.length >= 2) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [30, 30], maxZoom: 13 });
    } else if (bounds.length === 1) {
      map.setView(bounds[0], 12);
    }
  }, [plans]);

  return (
    <div style={{ flex: 1, position: 'relative', background: '#E5E7EB' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Map legend */}
      <div style={{ position: 'absolute', bottom: 12, left: 12, zIndex: 1000, background: 'rgba(255,255,255,.93)', borderRadius: 10, padding: '8px 12px', boxShadow: '0 2px 8px rgba(0,0,0,.12)', fontSize: 10, color: '#475569' }}>
        <div style={{ fontWeight: 700, marginBottom: 5, fontSize: 11 }}>Map Legend</div>
        {[{ label: 'Critical', color: '#EF4444' }, { label: 'High', color: '#F97316' }, { label: 'Medium', color: '#EAB308' }, { label: 'Low', color: '#94A3B8' }].map(l => (
          <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
            <div style={{ width: 9, height: 9, borderRadius: 2, background: l.color, border: '1.5px solid white' }} />
            {l.label}
          </div>
        ))}
        <div style={{ marginTop: 5, borderTop: '1px solid #F1F5F9', paddingTop: 5 }}>
          {plans.slice(0, 6).map((p, i) => (
            <div key={p.technicianId} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
              <div style={{ width: 9, height: 9, borderRadius: '50%', background: TECH_COLORS[i % TECH_COLORS.length], border: '1.5px solid white' }} />
              {p.technicianName.split(' ')[0]}
            </div>
          ))}
          {plans.length > 6 && <div style={{ color: '#94A3B8' }}>+{plans.length - 6} more</div>}
        </div>
      </div>
    </div>
  );
}

// ── Main PlannerPage ───────────────────────────────────────────────────
export function PlannerPage() {
  const [subTab, setSubTab] = useState<SubTab>('roster');
  const [plans, setPlans] = useState<MutablePlan[]>(buildPlans);
  const [hasManualEdits, setHasManualEdits] = useState(false);
  const [tracker, setTracker] = useState<TrackerState>(loadTracker);
  const markManualEdit = useCallback(() => setHasManualEdits(true), []);

  // Persist tracker so it survives sub-tab switches and leaving the page
  useEffect(() => {
    try { localStorage.setItem(TRACKER_KEY, JSON.stringify(tracker)); } catch {}
  }, [tracker]);
  const [showMap, setShowMap] = useState(true);

  const totalStops = plans.reduce((a, p) => a + p.stops.length, 0);
  const deployed = plans.filter(p => p.stops.length > 0).length;
  const openTickets = getTickets().filter(t => ['Open','Assigned','In Progress'].includes(t.status)).length;

  const regenerate = () => {
    if (hasManualEdits && !window.confirm('Recalculating will discard your manual reassignments on the map. Continue?')) return;
    setPlans(buildPlans());
    setHasManualEdits(false);
  };

  const downloadCSV = () => {
    const rows = [['Tech','EmpID','Zone','Stop#','TicketID','Vehicle','Center','Issue','Priority','ETA','Duration(min)']];
    plans.forEach(p => {
      if (p.stops.length === 0) return;
      p.stops.forEach(s => {
        rows.push([p.technicianName, p.employeeId, p.tech.zone || p.tech.city, String(s.stopOrder), s.ticketId, s.vehicleNumber, s.centerName, s.issue.replace(/,/g,' '), s.priority, s.estimatedArrival, String(s.estimatedDurationMins)]);
      });
    });
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `ncr-planner-${TODAY}.csv`;
    a.click();
  };

  const SUB_TABS: { key: SubTab; label: string }[] = [
    { key: 'roster', label: '📋 Roster' },
    { key: 'tickets', label: '🎫 Tickets' },
    { key: 'tracker', label: '📊 Tracker' },
    { key: 'attend', label: '👤 Attend' },
  ];

  return (
    <div style={{ display: 'flex', height: '100vh', maxHeight: '100%', fontFamily: 'Inter, system-ui, sans-serif', gap: 0, overflow: 'hidden', background: '#F1F5F9' }}>
      {/* Left Panel */}
      <div style={{ width: 340, minWidth: 300, maxWidth: 380, display: 'flex', flexDirection: 'column', background: '#fff', borderRight: '1px solid #E2E8F0', overflow: 'hidden' }}>

        {/* Top bar stats */}
        <div style={{ background: '#0F172A', padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 0 }}>
            {[
              { label: 'Techs', val: plans.length, color: '#10B981' },
              { label: 'Deployed', val: deployed, color: ACCENT },
              { label: 'Open Tix', val: openTickets, color: '#EF4444' },
              { label: 'Visits', val: totalStops, color: '#3B82F6' },
            ].map((s, i) => (
              <div key={s.label} style={{ paddingLeft: i > 0 ? 10 : 0, paddingRight: 10, borderLeft: i > 0 ? '1px solid #1E293B' : 'none' }}>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 15, fontWeight: 800, color: s.color }}>{s.val}</div>
                <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '.4px' }}>{s.label}</div>
              </div>
            ))}
          </div>
          <button
            onClick={regenerate}
            title="Recalculate routes from current tickets"
            style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid #1E293B', borderRadius: 6, cursor: 'pointer', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 4, color: '#94A3B8', fontSize: 10, fontWeight: 700 }}
          >
            <RefreshCw size={12} /> Recalculate
          </button>
        </div>

        {/* Sub-tab bar */}
        <div style={{ display: 'flex', borderBottom: '1px solid #F1F5F9', background: '#FAFAFA', padding: '0 8px' }}>
          {SUB_TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setSubTab(t.key)}
              style={{
                flex: 1, padding: '8px 4px', fontSize: 10, fontWeight: 700, cursor: 'pointer',
                border: 'none', borderBottom: `2px solid ${subTab === t.key ? ACCENT : 'transparent'}`,
                color: subTab === t.key ? ACCENT : '#94A3B8',
                background: 'transparent',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Panel content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px' }}>
          {openTickets === 0 && (subTab === 'roster' || subTab === 'tickets' || subTab === 'tracker') && (
            <div style={{ background: '#F0F9F9', border: `1px dashed ${ACCENT}`, borderRadius: 10, padding: '12px 14px', marginBottom: 12, fontSize: 11, color: '#334155', lineHeight: 1.5 }}>
              <div style={{ fontWeight: 700, color: ACCENT, marginBottom: 2 }}>No open tickets to plan</div>
              Import a ticket CSV from <b>Data → Import Data</b>, then click <b>Recalculate</b> to build today's routes.
            </div>
          )}
          {subTab === 'roster' && <RosterView plans={plans} setPlans={setPlans} onManualEdit={markManualEdit} />}
          {subTab === 'tickets' && <TicketsView plans={plans} />}
          {subTab === 'tracker' && <TrackerView plans={plans} tracker={tracker} setTracker={setTracker} />}
          {subTab === 'attend' && <AttendView plans={plans} />}
        </div>

        {/* Footer actions */}
        <div style={{ padding: '10px 12px', borderTop: '1px solid #F1F5F9', display: 'flex', gap: 6 }}>
          <button
            onClick={downloadCSV}
            style={{ flex: 1, fontSize: 10, fontWeight: 700, padding: '7px 0', borderRadius: 8, border: `1.5px solid ${ACCENT}`, color: ACCENT, background: '#ECFDF5', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
          >
            <Download size={11} /> CSV
          </button>
          <button
            onClick={() => setShowMap(p => !p)}
            style={{ flex: 1, fontSize: 10, fontWeight: 700, padding: '7px 0', borderRadius: 8, border: '1.5px solid #E2E8F0', color: '#64748B', background: '#F8FAFC', cursor: 'pointer' }}
          >
            {showMap ? '🗺 Hide Map' : '🗺 Show Map'}
          </button>
        </div>
      </div>

      {/* Map Panel */}
      {showMap && <MapPanel plans={plans} />}
      {!showMap && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC', color: '#CBD5E1', fontSize: 13 }}>
          Map hidden — click "Show Map" to display
        </div>
      )}
    </div>
  );
}
