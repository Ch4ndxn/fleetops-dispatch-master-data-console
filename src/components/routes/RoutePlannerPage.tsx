import React, { useState, useMemo } from 'react';
import {
  TechnicianRoutePlan,
  RouteStop,
  Ticket,
  Technician,
  Center,
  TicketPriority
} from '../../types';
import {
  getRoutePlans,
  saveRoutePlans,
  getTechnicians,
  getCenters,
  getTickets,
  saveTickets
} from '../../services/storage';
import { planTodayRoutes, calculateDistanceKm } from '../../services/routeOptimizer';
import { LiveMapViewer } from '../map/LiveMapViewer';
import {
  Compass,
  CheckCircle2,
  MapPin,
  Clock,
  AlertCircle,
  RotateCcw,
  Navigation,
  Layers,
  Download,
  Plus,
  X,
  ChevronDown,
  ChevronUp,
  Search
} from 'lucide-react';

// ─── Recalc helper ────────────────────────────────────────────────────────────
function recalcPlan(plan: TechnicianRoutePlan, centers: Center[]): TechnicianRoutePlan {
  const centerMap = new Map<string, Center>();
  centers.forEach(c => {
    centerMap.set(c.normalizedName, c);
    centerMap.set(c.name.trim().toLowerCase(), c);
  });

  let cumDistKm = 0;
  let cumMins = 30; // 30-min start buffer
  let prevLat = plan.startLat;
  let prevLng = plan.startLng;

  const rebuiltStops: RouteStop[] = plan.stops.map((stop, idx) => {
    const distKm = calculateDistanceKm(prevLat, prevLng, stop.latitude, stop.longitude);
    const travelMins = Math.round(distKm * 2.5); // ~24 km/h → 2.5 min/km
    const jobMins = stop.priority === 'CRITICAL' ? 60 : 45;

    cumDistKm += distKm;
    cumMins += travelMins;

    const baseMinutes = 9 * 60 + cumMins; // 09:00 + elapsed
    const arrivalHour = Math.floor(baseMinutes / 60);
    const arrivalMinute = baseMinutes % 60;
    const estimatedArrival = `${String(arrivalHour).padStart(2, '0')}:${String(arrivalMinute).padStart(2, '0')}`;

    cumMins += jobMins;
    prevLat = stop.latitude;
    prevLng = stop.longitude;

    return {
      ...stop,
      stopOrder: idx + 1,
      estimatedArrival
    };
  });

  return {
    ...plan,
    stops: rebuiltStops,
    totalDistanceKm: Math.round(cumDistKm * 10) / 10,
    totalEstimatedMins: cumMins - 30
  };
}

// ─── Priority badge ────────────────────────────────────────────────────────────
function PriorityBadge({ priority }: { priority: TicketPriority }) {
  const cls: Record<TicketPriority, string> = {
    CRITICAL: 'bg-rose-100 text-rose-700',
    HIGH: 'bg-orange-100 text-orange-700',
    MEDIUM: 'bg-amber-100 text-amber-700',
    LOW: 'bg-slate-100 text-slate-600'
  };
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${cls[priority] ?? cls.LOW}`}>
      {priority}
    </span>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: TechnicianRoutePlan['status'] }) {
  const cls: Record<string, string> = {
    Draft: 'bg-amber-100 text-amber-700',
    Confirmed: 'bg-emerald-100 text-emerald-700',
    'In-Transit': 'bg-blue-100 text-blue-700',
    Completed: 'bg-slate-100 text-slate-600'
  };
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${cls[status] ?? cls.Draft}`}>
      {status}
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export const RoutePlannerPage: React.FC = () => {
  const [routePlans, setRoutePlans] = useState<TechnicianRoutePlan[]>(() => getRoutePlans());
  const [technicians] = useState<Technician[]>(() => getTechnicians());
  const [centers] = useState<Center[]>(() => getCenters());
  const [allTickets, setAllTickets] = useState<Ticket[]>(() => getTickets());

  const [selectedTechId, setSelectedTechId] = useState<string | undefined>(undefined);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<'success' | 'error'>('success');

  // Filter/search state
  const [cityFilter, setCityFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Expand/collapse per-card state
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

  // Add-stop dropdown open state: techId → open bool
  const [addStopOpen, setAddStopOpen] = useState<Record<string, boolean>>({});

  // Assign-from-unassigned dropdown: ticketId → open bool
  const [assignOpen, setAssignOpen] = useState<Record<string, boolean>>({});

  // ── helpers ────────────────────────────────────────────────────────────────
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToastMessage(msg);
    setToastType(type);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const centerMap = useMemo(() => {
    const m = new Map<string, Center>();
    centers.forEach(c => {
      m.set(c.normalizedName, c);
      m.set(c.name.trim().toLowerCase(), c);
    });
    return m;
  }, [centers]);

  // Assigned ticket IDs across all plans
  const assignedTicketIds = useMemo(() => {
    const s = new Set<string>();
    routePlans.forEach(p => p.stops.forEach(st => s.add(st.ticketId)));
    return s;
  }, [routePlans]);

  // Unassigned tickets: not Resolved/Closed, has valid center coords, not in any plan
  const unassignedTickets = useMemo(() => {
    return allTickets.filter(tk => {
      if (tk.status === 'Resolved' || tk.status === 'Closed') return false;
      if (assignedTicketIds.has(tk.ticketId)) return false;
      const c = centerMap.get(tk.centerName.trim().toLowerCase());
      return Boolean(c && c.latitude && c.longitude);
    });
  }, [allTickets, assignedTicketIds, centerMap]);

  // Cities for filter pills
  const cities = useMemo(() => {
    const s = new Set<string>();
    technicians.forEach(t => { if (t.city) s.add(t.city); });
    return ['ALL', ...Array.from(s).sort()];
  }, [technicians]);

  // Stats
  const totalStops = routePlans.reduce((a, p) => a + p.stops.length, 0);
  const totalKm = Math.round(routePlans.reduce((a, p) => a + p.totalDistanceKm, 0) * 10) / 10;
  const planStatus = routePlans.length === 0
    ? 'No Plan'
    : routePlans.every(p => p.status === 'Confirmed') ? 'All Confirmed'
    : routePlans.every(p => p.status === 'Draft') ? 'Draft'
    : 'Mixed';

  // ── filter + search logic ─────────────────────────────────────────────────
  const filteredPlans = useMemo(() => {
    return routePlans.filter(plan => {
      const tech = technicians.find(t => t.id === plan.technicianId);
      if (cityFilter !== 'ALL' && tech?.city !== cityFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (!plan.technicianName.toLowerCase().includes(q) && !plan.employeeId.toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [routePlans, technicians, cityFilter, searchQuery]);

  // ── actions ───────────────────────────────────────────────────────────────
  const handlePlanRoutes = () => {
    setIsOptimizing(true);
    setTimeout(() => {
      const generated = planTodayRoutes();
      saveRoutePlans(generated);
      setRoutePlans(generated);
      setAllTickets(getTickets());
      setIsOptimizing(false);
      showToast(`Generated ${generated.length} routes. ${unassignedTickets.length} tickets unassigned.`);
    }, 400);
  };

  const handleConfirmAll = () => {
    if (routePlans.length === 0) return;
    const confirmed = routePlans.map(p => ({ ...p, status: 'Confirmed' as const }));
    saveRoutePlans(confirmed);
    setRoutePlans(confirmed);

    const updated = allTickets.map(tk => {
      for (const plan of confirmed) {
        const stop = plan.stops.find(s => s.ticketId === tk.ticketId);
        if (stop) {
          return {
            ...tk,
            assignedTechnicianId: plan.technicianId,
            assignedTechnicianName: plan.technicianName,
            status: 'Assigned' as const,
            scheduledSlot: stop.estimatedArrival,
            updatedAt: new Date().toISOString()
          };
        }
      }
      return tk;
    });
    saveTickets(updated);
    setAllTickets(updated);
    showToast('All routes confirmed and tickets updated.');
  };

  const handleClearRoutes = () => {
    saveRoutePlans([]);
    setRoutePlans([]);
    setExpandedCards(new Set());
    showToast('Routes cleared.');
  };

  const handleExportCSV = () => {
    const rows = ['Tech Name,Employee ID,Stop #,Center,Vehicle,Ticket ID,Priority,ETA'];
    routePlans.forEach(plan => {
      plan.stops.forEach(stop => {
        rows.push([
          `"${plan.technicianName}"`,
          plan.employeeId,
          stop.stopOrder,
          `"${stop.centerName}"`,
          stop.vehicleNumber,
          stop.ticketId,
          stop.priority,
          stop.estimatedArrival
        ].join(','));
      });
    });
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `route-plan-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRemoveStop = (techId: string, ticketId: string) => {
    const updated = routePlans.map(plan => {
      if (plan.technicianId !== techId) return plan;
      const newStops = plan.stops.filter(s => s.ticketId !== ticketId);
      const rebuilt = recalcPlan({ ...plan, stops: newStops }, centers);
      return rebuilt;
    });
    saveRoutePlans(updated);
    setRoutePlans(updated);
    showToast('Stop removed and ETAs recalculated.');
  };

  const handleAddStop = (techId: string, ticket: Ticket) => {
    const center = centerMap.get(ticket.centerName.trim().toLowerCase());
    if (!center) { showToast('Center coordinates not found.', 'error'); return; }

    const updated = routePlans.map(plan => {
      if (plan.technicianId !== techId) return plan;
      const newStop: RouteStop = {
        stopOrder: plan.stops.length + 1,
        ticketId: ticket.ticketId,
        centerName: ticket.centerName,
        vehicleNumber: ticket.vehicleNumber,
        issue: ticket.issue,
        priority: ticket.priority,
        latitude: center.latitude,
        longitude: center.longitude,
        estimatedArrival: '00:00',
        estimatedDurationMins: ticket.priority === 'CRITICAL' ? 60 : 45
      };
      const rebuilt = recalcPlan({ ...plan, stops: [...plan.stops, newStop] }, centers);
      return rebuilt;
    });
    saveRoutePlans(updated);
    setRoutePlans(updated);
    setAddStopOpen(prev => ({ ...prev, [techId]: false }));
    showToast(`Stop added to route and ETAs recalculated.`);
  };

  const handleAssignFromUnassigned = (ticket: Ticket, techId: string) => {
    handleAddStop(techId, ticket);
    setAssignOpen(prev => ({ ...prev, [ticket.ticketId]: false }));
  };

  const toggleCard = (techId: string) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      if (next.has(techId)) next.delete(techId);
      else next.add(techId);
      return next;
    });
  };

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Toast */}
      {toastMessage && (
        <div className={`p-3.5 border rounded-xl text-xs font-medium flex items-center justify-between shadow-xs ${
          toastType === 'error'
            ? 'bg-rose-50 border-rose-200 text-rose-800'
            : 'bg-emerald-50 border-emerald-200 text-emerald-800'
        }`}>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            <span>{toastMessage}</span>
          </div>
          <button onClick={() => setToastMessage(null)} className="text-slate-400 hover:text-slate-600 font-bold">
            ×
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">ROUTE PLANNER & DISPATCH</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Geospatial route optimizer. Assign, reorder, and confirm technician stops.
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handlePlanRoutes}
            disabled={isOptimizing}
            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg text-xs font-bold tracking-wide shadow-xs transition-colors flex items-center gap-1.5"
          >
            <Compass className="w-3.5 h-3.5" />
            {isOptimizing ? 'Planning…' : 'AUTO-PLAN ROUTES'}
          </button>

          <button
            onClick={handleConfirmAll}
            disabled={routePlans.length === 0}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-lg text-xs font-bold shadow-xs transition-colors flex items-center gap-1.5"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            CONFIRM ALL
          </button>

          <button
            onClick={handleClearRoutes}
            disabled={routePlans.length === 0}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 rounded-lg text-xs font-bold shadow-xs transition-colors flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            CLEAR ROUTES
          </button>

          <button
            onClick={handleExportCSV}
            disabled={routePlans.length === 0}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 rounded-lg text-xs font-bold shadow-xs transition-colors flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            EXPORT CSV
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Active Techs', value: routePlans.length, color: 'text-slate-900' },
          { label: 'Total Stops', value: totalStops, color: 'text-blue-600' },
          { label: 'Unassigned Tickets', value: unassignedTickets.length, color: 'text-amber-600' },
          { label: 'Total Distance', value: `${totalKm} km`, color: 'text-slate-900' },
          { label: 'Plan Status', value: planStatus, color: planStatus === 'All Confirmed' ? 'text-emerald-600' : 'text-amber-600' }
        ].map(stat => (
          <div key={stat.label} className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
            <span className="text-[10px] text-slate-500 font-medium block">{stat.label}</span>
            <div className={`text-base font-bold mt-0.5 ${stat.color}`}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Two-column layout */}
      <div className="flex flex-col lg:flex-row gap-5">

        {/* ── LEFT COLUMN: Tech cards ────────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* Filter pills + search */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex flex-wrap gap-1.5">
              {cities.map(city => (
                <button
                  key={city}
                  onClick={() => setCityFilter(city)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors ${
                    cityFilter === city
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {city}
                </button>
              ))}
            </div>
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search technician…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          </div>

          {/* Cards */}
          {routePlans.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-10 text-center space-y-3">
              <Navigation className="w-10 h-10 text-slate-300 mx-auto" />
              <h3 className="text-sm font-bold text-slate-800">No Routes Generated Yet</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Click <strong>AUTO-PLAN ROUTES</strong> to generate optimized routes for all present technicians.
              </p>
            </div>
          ) : filteredPlans.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-xs text-slate-500">
              No routes match the current filter.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredPlans.map(plan => {
                const isSelected = selectedTechId === plan.technicianId;
                const isExpanded = expandedCards.has(plan.technicianId);
                const isAddOpen = addStopOpen[plan.technicianId] ?? false;

                return (
                  <div
                    key={plan.technicianId}
                    className={`bg-white rounded-xl border shadow-2xs transition-all ${
                      isSelected ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-slate-200'
                    }`}
                  >
                    {/* Card header — clickable to focus map */}
                    <div
                      className="flex items-center justify-between p-4 cursor-pointer"
                      onClick={() => {
                        setSelectedTechId(isSelected ? undefined : plan.technicianId);
                        if (!isExpanded) toggleCard(plan.technicianId);
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-slate-900 text-sm">{plan.technicianName}</span>
                          <span className="text-[10px] font-mono text-slate-500">{plan.employeeId}</span>
                          <StatusBadge status={plan.status} />
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5 flex gap-3 flex-wrap">
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {plan.startLat.toFixed(4)}, {plan.startLng.toFixed(4)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            ~{plan.totalEstimatedMins} min
                          </span>
                          <span>{plan.totalDistanceKm} km</span>
                          <span className="font-semibold text-blue-600">{plan.stops.length} stops</span>
                        </div>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); toggleCard(plan.technicianId); }}
                        className="ml-2 p-1 rounded hover:bg-slate-100 text-slate-400"
                      >
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                    </div>

                    {/* Expanded stops list */}
                    {isExpanded && (
                      <div className="px-4 pb-4 space-y-2 border-t border-slate-100 pt-3">
                        {plan.stops.length === 0 ? (
                          <p className="text-xs text-slate-400 py-2">No stops assigned.</p>
                        ) : (
                          plan.stops.map(stop => (
                            <div
                              key={stop.ticketId}
                              className="flex items-center gap-2 p-2.5 bg-slate-50 rounded-lg border border-slate-100 text-xs"
                            >
                              <span className="w-5 h-5 rounded-full bg-slate-800 text-white font-mono text-[10px] flex items-center justify-center font-bold shrink-0">
                                {stop.stopOrder}
                              </span>
                              <div className="flex-1 min-w-0">
                                <div className="font-semibold text-slate-900 truncate">
                                  {stop.centerName}
                                </div>
                                <div className="text-[10px] text-slate-500 flex gap-2 flex-wrap">
                                  <span>{stop.vehicleNumber}</span>
                                  <span className="truncate max-w-[160px]">{stop.issue}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <PriorityBadge priority={stop.priority} />
                                <span className="font-mono text-[11px] font-bold text-blue-600">{stop.estimatedArrival}</span>
                                <button
                                  onClick={() => handleRemoveStop(plan.technicianId, stop.ticketId)}
                                  title="Remove stop"
                                  className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ))
                        )}

                        {/* Add Stop dropdown */}
                        <div className="relative mt-2">
                          <button
                            onClick={() => setAddStopOpen(prev => ({ ...prev, [plan.technicianId]: !isAddOpen }))}
                            className="w-full flex items-center justify-center gap-1.5 py-2 border border-dashed border-slate-300 rounded-lg text-xs text-slate-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Add Stop
                          </button>

                          {isAddOpen && (
                            <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-56 overflow-y-auto">
                              {unassignedTickets.length === 0 ? (
                                <div className="p-3 text-xs text-slate-400 text-center">No unassigned tickets available.</div>
                              ) : (
                                unassignedTickets.map(tk => (
                                  <button
                                    key={tk.ticketId}
                                    onClick={() => handleAddStop(plan.technicianId, tk)}
                                    className="w-full text-left px-3 py-2.5 hover:bg-blue-50 border-b border-slate-100 last:border-0 transition-colors"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="min-w-0">
                                        <span className="text-[11px] font-semibold text-slate-800 block truncate">
                                          {tk.ticketId} · {tk.centerName}
                                        </span>
                                        <span className="text-[10px] text-slate-500 truncate block">{tk.vehicleNumber} — {tk.issue}</span>
                                      </div>
                                      <PriorityBadge priority={tk.priority} />
                                    </div>
                                  </button>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── RIGHT COLUMN: Map + Unassigned panel ──────────────────────── */}
        <div className="lg:w-[420px] shrink-0 space-y-4">

          {/* Map */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
              <span className="flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-blue-600" />
                Delhi NCR Routing Map
              </span>
              {selectedTechId && (
                <button
                  onClick={() => setSelectedTechId(undefined)}
                  className="text-blue-600 hover:underline text-[11px]"
                >
                  Show all
                </button>
              )}
            </div>
            <LiveMapViewer
              centers={centers}
              technicians={technicians}
              routePlans={routePlans}
              selectedTechId={selectedTechId}
              height="380px"
            />
          </div>

          {/* Unassigned Tickets panel */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <div>
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                  Unassigned Tickets
                </h3>
                <p className="text-[10px] text-slate-400 mt-0.5">Tickets with valid center coords not in any route</p>
              </div>
              <span className="text-xs font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                {unassignedTickets.length}
              </span>
            </div>

            <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
              {unassignedTickets.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  <AlertCircle className="w-6 h-6 mx-auto mb-2 text-slate-300" />
                  All routable tickets are assigned.
                </div>
              ) : (
                unassignedTickets.map(tk => {
                  const isOpen = assignOpen[tk.ticketId] ?? false;
                  return (
                    <div key={tk.ticketId} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[11px] font-bold text-slate-800">{tk.ticketId}</span>
                            <PriorityBadge priority={tk.priority} />
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5 truncate">
                            {tk.vehicleNumber} · {tk.centerName}
                          </div>
                          <div className="text-[10px] text-slate-400 truncate">{tk.issue}</div>
                        </div>

                        {/* Assign dropdown */}
                        <div className="relative shrink-0">
                          <button
                            onClick={() => setAssignOpen(prev => ({ ...prev, [tk.ticketId]: !isOpen }))}
                            disabled={routePlans.length === 0}
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 disabled:opacity-40 text-blue-700 rounded-lg text-[11px] font-bold transition-colors"
                          >
                            <Plus className="w-3 h-3" />
                            Assign
                          </button>

                          {isOpen && (
                            <div className="absolute z-20 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg w-52 max-h-48 overflow-y-auto">
                              {routePlans.map(plan => (
                                <button
                                  key={plan.technicianId}
                                  onClick={() => handleAssignFromUnassigned(tk, plan.technicianId)}
                                  className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-slate-100 last:border-0 transition-colors"
                                >
                                  <div className="text-[11px] font-semibold text-slate-800 truncate">{plan.technicianName}</div>
                                  <div className="text-[10px] text-slate-400">{plan.stops.length} stops · {plan.totalDistanceKm} km</div>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
