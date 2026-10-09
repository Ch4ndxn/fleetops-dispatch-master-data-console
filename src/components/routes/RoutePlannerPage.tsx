import React, { useState, useMemo } from 'react';
import {
  TechnicianRoutePlan,
  RouteStop,
  Ticket,
  Technician,
  Center,
  TicketPriority,
  VisitLog,
  VisitOutcome,
} from '../../types';
import {
  getRoutePlans,
  saveRoutePlans,
  getTechnicians,
  getCenters,
  getTickets,
  saveTickets,
  getVisitLogs,
  upsertVisitLog,
} from '../../services/storage';
import {
  planBalancedRoutes,
  BalancedPlanConstraints,
  calculateDistanceKm
} from '../../services/routeOptimizer';
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
  Search,
  MessageCircle,
  Settings2,
  Maximize2,
  GripVertical,
  ArrowRight,
  Edit2,
  ClipboardList,
  History,
} from 'lucide-react';

// ─── Recalc helper ────────────────────────────────────────────────────────────
function recalcPlan(plan: TechnicianRoutePlan, centers: Center[]): TechnicianRoutePlan {
  const centerMap = new Map<string, Center>();
  centers.forEach(c => {
    centerMap.set(c.normalizedName, c);
    centerMap.set(c.name.trim().toLowerCase(), c);
  });

  let cumDistKm = 0;
  let cumMins = 30;
  let prevLat = plan.startLat;
  let prevLng = plan.startLng;

  const rebuiltStops: RouteStop[] = plan.stops.map((stop, idx) => {
    const distKm = calculateDistanceKm(prevLat, prevLng, stop.latitude, stop.longitude);
    const travelMins = Math.round(distKm * 2.5);
    const jobMins = stop.priority === 'CRITICAL' ? 60 : 45;

    cumDistKm += distKm;
    cumMins += travelMins;

    const baseMinutes = 9 * 60 + cumMins;
    const arrivalHour = Math.floor(baseMinutes / 60);
    const arrivalMinute = baseMinutes % 60;
    const estimatedArrival = `${String(arrivalHour).padStart(2, '0')}:${String(arrivalMinute).padStart(2, '0')}`;

    cumMins += jobMins;
    prevLat = stop.latitude;
    prevLng = stop.longitude;

    return { ...stop, stopOrder: idx + 1, estimatedArrival };
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

// ─── WhatsApp export helpers ──────────────────────────────────────────────────
function buildWhatsAppText(plan: TechnicianRoutePlan, date: string): string {
  const header = `*${plan.technicianName} - ${plan.employeeId} - Route Plan ${date}*`;
  const summary = `Total: ${plan.stops.length} stops, ${plan.totalDistanceKm}km`;
  const stops = plan.stops
    .map(s => `${s.stopOrder}. ${s.centerName} · ${s.ticketId} · ${s.priority} · ETA ${s.estimatedArrival}`)
    .join('\n');
  return `${header}\n${summary}\n\n${stops}\n\n_FleetOps Dispatch_`;
}

function openWhatsApp(text: string) {
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
}

// ─── Default constraints ──────────────────────────────────────────────────────
const DEFAULT_CONSTRAINTS: BalancedPlanConstraints = {
  maxStopsPerTech: 8,
  maxKmPerTech: 80,
  priorityFilter: 'all',
  skillMatch: false,
  shiftStartHour: 9,
  shiftEndHour: 18
};

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

  // Per-card confirmed state (local, separate from plan.status to allow draft→confirmed per card)
  const [confirmedCards, setConfirmedCards] = useState<Set<string>>(new Set());

  // Add-stop dropdown open state
  const [addStopOpen, setAddStopOpen] = useState<Record<string, boolean>>({});

  // Assign-from-unassigned dropdown
  const [assignOpen, setAssignOpen] = useState<Record<string, boolean>>({});

  // Constraints panel
  const [showConstraints, setShowConstraints] = useState(false);
  const [constraints, setConstraints] = useState<BalancedPlanConstraints>(DEFAULT_CONSTRAINTS);

  // Map height toggle
  const [fullMap, setFullMap] = useState(false);

  // Download menu
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);

  // Unassigned panel search
  const [unassignedSearch, setUnassignedSearch] = useState('');

  // Unassigned priority filter
  const [unassignedPriorityFilter, setUnassignedPriorityFilter] = useState<'ALL' | 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'>('ALL');

  // Last plan result metadata
  const [planMeta, setPlanMeta] = useState<{ kmSaved: number; balanceScore: number; timeSavedMins: number } | null>(null);

  // ── Visit Log state ────────────────────────────────────────────────────────
  const [visitLogs, setVisitLogs] = useState<VisitLog[]>(() => getVisitLogs());
  // Modal: which stop is being logged
  const [visitModal, setVisitModal] = useState<{
    plan: TechnicianRoutePlan;
    stop: RouteStop;
  } | null>(null);
  const [visitForm, setVisitForm] = useState<{
    checkInTime: string;
    checkOutTime: string;
    outcome: VisitOutcome;
    notes: string;
  }>({ checkInTime: '', checkOutTime: '', outcome: 'Resolved', notes: '' });
  // History panel: which ticketId to show logs for
  const [visitHistoryTicketId, setVisitHistoryTicketId] = useState<string | null>(null);

  // ── Tab navigation ────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'routes' | 'tracker'>('routes');

  // ── Tracker tab state ─────────────────────────────────────────────────────
  // ticketTrackStatus: per-ticketId override for tracker view
  const [ticketTrackStatus, setTicketTrackStatus] = useState<Record<string, 'assigned' | 'visited' | 'closed'>>({});
  const [trackerTechFilter, setTrackerTechFilter] = useState<string>('all');
  const [trackerPipeFilter, setTrackerPipeFilter] = useState<'all' | 'assigned' | 'visited' | 'closed'>('all');
  const [trackerNotes, setTrackerNotes] = useState<Record<string, string>>({});

  // ── Feature 1: Drag-to-reorder ────────────────────────────────────────────
  const [dragState, setDragState] = useState<{ techId: string; fromIdx: number } | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<{ techId: string; idx: number } | null>(null);

  // ── Feature 2: Move stop to another tech ─────────────────────────────────
  const [moveStopOpen, setMoveStopOpen] = useState<{ techId: string; ticketId: string } | null>(null);

  // ── Feature 3: Inline stop editing ───────────────────────────────────────
  const [editingStop, setEditingStop] = useState<{ techId: string; ticketId: string; priority: string; issue: string } | null>(null);

  const today = new Date().toISOString().split('T')[0];

  // ── Visit log handlers ─────────────────────────────────────────────────────
  const openVisitModal = (plan: TechnicianRoutePlan, stop: RouteStop) => {
    const nowHHMM = new Date().toTimeString().slice(0, 5);
    setVisitForm({ checkInTime: nowHHMM, checkOutTime: '', outcome: 'Resolved', notes: '' });
    setVisitModal({ plan, stop });
  };

  const handleSaveVisit = () => {
    if (!visitModal) return;
    const { plan, stop } = visitModal;
    const saved = upsertVisitLog({
      ticketId: stop.ticketId,
      technicianId: plan.technicianId,
      technicianName: plan.technicianName,
      employeeId: plan.employeeId,
      centerName: stop.centerName,
      vehicleNumber: stop.vehicleNumber,
      visitDate: today,
      checkInTime: visitForm.checkInTime || undefined,
      checkOutTime: visitForm.checkOutTime || undefined,
      outcome: visitForm.outcome,
      notes: visitForm.notes || undefined,
    });
    // Refresh visit logs from storage
    setVisitLogs(getVisitLogs());

    // Auto-update ticket status based on outcome
    const newTicketStatus =
      visitForm.outcome === 'Resolved' ? 'Resolved' :
      visitForm.outcome === 'Partial Fix' ? 'In Progress' :
      visitForm.outcome === 'Pending Spares' ? 'Pending Spares' :
      visitForm.outcome === 'Escalated' ? 'In Progress' : 'In Progress';

    const updatedTickets = allTickets.map(tk =>
      tk.ticketId === stop.ticketId
        ? { ...tk, status: newTicketStatus as Ticket['status'], updatedAt: new Date().toISOString() }
        : tk
    );
    saveTickets(updatedTickets);
    setAllTickets(updatedTickets);

    setVisitModal(null);
    showToast(`Visit logged for ${stop.ticketId} — ${visitForm.outcome}`, 'success');
  };

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

  const assignedTicketIds = useMemo(() => {
    const s = new Set<string>();
    routePlans.forEach(p => p.stops.forEach(st => s.add(st.ticketId)));
    return s;
  }, [routePlans]);

  const routableTicketCount = useMemo(() => {
    return allTickets.filter(tk => {
      if (tk.status === 'Resolved' || tk.status === 'Closed') return false;
      const c = centerMap.get(tk.centerName.trim().toLowerCase());
      return Boolean(c?.latitude && c?.longitude);
    }).length;
  }, [allTickets, centerMap]);

  const unassignedTicketsRaw = useMemo(() => {
    return allTickets.filter(tk => {
      if (tk.status === 'Resolved' || tk.status === 'Closed') return false;
      if (assignedTicketIds.has(tk.ticketId)) return false;
      const c = centerMap.get(tk.centerName.trim().toLowerCase());
      return Boolean(c?.latitude && c?.longitude);
    });
  }, [allTickets, assignedTicketIds, centerMap]);

  const unassignedTickets = useMemo(() => {
    return unassignedTicketsRaw.filter(tk => {
      if (unassignedPriorityFilter !== 'ALL' && tk.priority !== unassignedPriorityFilter) return false;
      if (unassignedSearch.trim()) {
        const q = unassignedSearch.toLowerCase();
        return (
          tk.ticketId.toLowerCase().includes(q) ||
          tk.centerName.toLowerCase().includes(q) ||
          tk.vehicleNumber.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [unassignedTicketsRaw, unassignedPriorityFilter, unassignedSearch]);

  const cities = useMemo(() => {
    const s = new Set<string>();
    technicians.forEach(t => { if (t.city) s.add(t.city); });
    return ['ALL', ...Array.from(s).sort()];
  }, [technicians]);

  // Stats
  const totalStops = routePlans.reduce((a, p) => a + p.stops.length, 0);
  const totalKm = Math.round(routePlans.reduce((a, p) => a + p.totalDistanceKm, 0) * 10) / 10;
  const activeTechs = routePlans.length;
  const avgStopsPerTech = activeTechs > 0 ? (totalStops / activeTechs).toFixed(1) : '—';
  const coveragePct = routableTicketCount > 0
    ? Math.round((assignedTicketIds.size / routableTicketCount) * 100)
    : 0;
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
      const result = planBalancedRoutes(constraints);
      saveRoutePlans(result.plans);
      setRoutePlans(result.plans);
      setAllTickets(getTickets());
      setConfirmedCards(new Set());
      setPlanMeta({ kmSaved: result.kmSaved, balanceScore: result.balanceScore, timeSavedMins: result.timeSavedMins });
      setIsOptimizing(false);
      showToast(
        `Generated ${result.plans.length} routes · ${result.unrouted.length} unassigned · ${result.kmSaved}km saved vs naive · Balance: ${result.balanceScore}/100`
      );
    }, 400);
  };

  const handleConfirmAll = () => {
    if (routePlans.length === 0) return;
    const confirmed = routePlans.map(p => ({ ...p, status: 'Confirmed' as const }));
    saveRoutePlans(confirmed);
    setRoutePlans(confirmed);
    setConfirmedCards(new Set(confirmed.map(p => p.technicianId)));

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

  const handleToggleCardConfirm = (techId: string) => {
    const plan = routePlans.find(p => p.technicianId === techId);
    if (!plan) return;

    const isNowConfirmed = !confirmedCards.has(techId);
    const newStatus = isNowConfirmed ? 'Confirmed' : 'Draft';

    const updated = routePlans.map(p =>
      p.technicianId === techId ? { ...p, status: newStatus as TechnicianRoutePlan['status'] } : p
    );
    saveRoutePlans(updated);
    setRoutePlans(updated);

    setConfirmedCards(prev => {
      const next = new Set(prev);
      if (isNowConfirmed) {
        next.add(techId);
        // Update tickets status
        const updatedTickets = allTickets.map(tk => {
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
          return tk;
        });
        saveTickets(updatedTickets);
        setAllTickets(updatedTickets);
      } else {
        next.delete(techId);
      }
      return next;
    });

    showToast(`Route for ${plan.technicianName} ${isNowConfirmed ? 'confirmed' : 'set back to Draft'}.`);
  };

  const handleClearRoutes = () => {
    saveRoutePlans([]);
    setRoutePlans([]);
    setExpandedCards(new Set());
    setConfirmedCards(new Set());
    setPlanMeta(null);
    showToast('Routes cleared.');
  };

  const handleDownloadRoster = () => {
    const rows = ['Ticket ID,Vehicle,Center,Issue,Priority,Assigned Tech,Employee ID,Stop #,ETA,Status'];
    routePlans.forEach(plan => {
      plan.stops.sort((a, b) => a.stopOrder - b.stopOrder).forEach(stop => {
        rows.push([
          stop.ticketId,
          stop.vehicleNumber,
          `"${stop.centerName.replace(/_D$/, '')}"`,
          `"${stop.issue || ''}"`,
          stop.priority,
          `"${plan.technicianName}"`,
          plan.employeeId,
          stop.stopOrder,
          stop.estimatedArrival,
          'Assigned'
        ].join(','));
      });
    });
    // Also include unassigned tickets
    const assignedIds = new Set(routePlans.flatMap(p => p.stops.map(s => s.ticketId)));
    allTickets.forEach(tk => {
      if (tk.status === 'Resolved' || tk.status === 'Closed') return;
      if (assignedIds.has(tk.ticketId)) return;
      rows.push([
        tk.ticketId,
        tk.vehicleNumber,
        `"${tk.centerName.replace(/_D$/, '')}"`,
        `"${tk.issue || ''}"`,
        tk.priority,
        tk.assignedTechnicianName ? `"${tk.assignedTechnicianName}"` : 'UNASSIGNED',
        '',
        '',
        '',
        'Unassigned'
      ].join(','));
    });
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `roster-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
    a.download = `route-plan-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── PDF helpers ───────────────────────────────────────────────────────────────
  const PRIORITY_COLOR_HEX: Record<string, string> = {
    CRITICAL: '#dc2626', HIGH: '#ea580c', MEDIUM: '#ca8a04', LOW: '#16a34a',
  };

  function buildPlanPdfHtml(plan: TechnicianRoutePlan): string {
    const stops = plan.stops.slice().sort((a, b) => a.stopOrder - b.stopOrder);
    const rows = stops.map(s => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-weight:600">${s.stopOrder}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-family:monospace">${s.ticketId}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0">${s.vehicleNumber}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0">${s.centerName.replace(/_D$/, '')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;max-width:180px">${s.issue || ''}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0">
          <span style="background:${PRIORITY_COLOR_HEX[s.priority] || '#94a3b8'};color:#fff;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700">${s.priority}</span>
        </td>
        <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-weight:700;color:#2563eb">${s.estimatedArrival}</td>
      </tr>`).join('');

    return `
      <div style="margin-bottom:32px;page-break-inside:avoid">
        <div style="background:#0f172a;color:#fff;padding:12px 16px;border-radius:8px 8px 0 0;display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-size:14px;font-weight:700">${plan.technicianName}</div>
            <div style="font-size:11px;color:#94a3b8">${plan.employeeId} · ${stops.length} stops · ${plan.totalDistanceKm} km</div>
          </div>
          <div style="font-size:11px;color:#94a3b8;text-align:right">
            Est. ${Math.round(plan.totalEstimatedMins / 60 * 10) / 10}h<br/>
            <span style="color:${plan.status === 'Confirmed' ? '#34d399' : '#f59e0b'}">${plan.status}</span>
          </div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;font-family:Arial,sans-serif">
          <thead>
            <tr style="background:#f8fafc">
              ${['#','Ticket','Vehicle','Center','Issue','Priority','ETA'].map(h =>
                `<th style="padding:6px 8px;text-align:left;font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;border-bottom:2px solid #e2e8f0">${h}</th>`
              ).join('')}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function buildUnassignedSection(allTk: Ticket[], plans: TechnicianRoutePlan[]): string {
    const assignedIds = new Set(plans.flatMap(p => p.stops.map(s => s.ticketId)));
    const unassigned = allTk.filter(tk =>
      tk.status !== 'Resolved' && tk.status !== 'Closed' && !assignedIds.has(tk.ticketId)
    );
    if (unassigned.length === 0) return '';
    const rows = unassigned.map(tk => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #fecaca;font-family:monospace">${tk.ticketId}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #fecaca">${tk.vehicleNumber}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #fecaca">${tk.centerName.replace(/_D$/, '')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #fecaca;max-width:180px">${tk.issue || ''}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #fecaca">
          <span style="background:${PRIORITY_COLOR_HEX[tk.priority] || '#94a3b8'};color:#fff;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700">${tk.priority}</span>
        </td>
        <td style="padding:6px 8px;border-bottom:1px solid #fecaca;color:#ef4444;font-weight:600">${tk.assignedTechnicianName || '— Unassigned'}</td>
      </tr>`).join('');
    return `
      <div style="margin-top:24px;page-break-inside:avoid">
        <div style="background:#fef2f2;border:1px solid #fecaca;padding:10px 16px;border-radius:8px 8px 0 0">
          <span style="font-size:13px;font-weight:700;color:#dc2626">⚠ Unrouted Tickets (${unassigned.length})</span>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;font-family:Arial,sans-serif">
          <thead>
            <tr style="background:#fef2f2">
              ${['Ticket','Vehicle','Center','Issue','Priority','Assigned To'].map(h =>
                `<th style="padding:6px 8px;text-align:left;font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;border-bottom:2px solid #fecaca">${h}</th>`
              ).join('')}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function printHtml(html: string, filename: string) {
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!doctype html><html><head>
      <title>${filename}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 24px; color: #0f172a; }
        @media print { @page { margin: 16mm; } }
        table { page-break-inside: auto; }
        tr { page-break-inside: avoid; }
      </style>
    </head><body>${html}</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 400);
  }

  const handleDownloadPdfAll = () => {
    const header = `
      <div style="margin-bottom:24px;border-bottom:3px solid #0f172a;padding-bottom:16px">
        <div style="font-size:20px;font-weight:800;color:#0f172a">FleetOps · Dispatch Roster</div>
        <div style="font-size:12px;color:#64748b;margin-top:4px">${today} · ${routePlans.length} technicians · ${routePlans.reduce((s, p) => s + p.stops.length, 0)} stops planned</div>
      </div>`;
    const body = routePlans.map(p => buildPlanPdfHtml(p)).join('') + buildUnassignedSection(allTickets, routePlans);
    printHtml(header + body, `roster-all-${today}`);
  };

  const handleDownloadPdfTech = (plan: TechnicianRoutePlan) => {
    const header = `
      <div style="margin-bottom:24px;border-bottom:3px solid #0f172a;padding-bottom:16px">
        <div style="font-size:20px;font-weight:800;color:#0f172a">FleetOps · Route Sheet</div>
        <div style="font-size:12px;color:#64748b;margin-top:4px">${today} · For: ${plan.technicianName} (${plan.employeeId})</div>
      </div>`;
    printHtml(header + buildPlanPdfHtml(plan), `route-${plan.employeeId}-${today}`);
  };

  const handleDownloadCsvAll = () => handleDownloadRoster();

  const handleDownloadCsvTech = (plan: TechnicianRoutePlan) => {
    const rows = ['Stop #,Ticket ID,Vehicle,Center,Issue,Priority,ETA'];
    plan.stops.slice().sort((a, b) => a.stopOrder - b.stopOrder).forEach(s => {
      rows.push([s.stopOrder, s.ticketId, s.vehicleNumber, `"${s.centerName.replace(/_D$/, '')}"`, `"${s.issue || ''}"`, s.priority, s.estimatedArrival].join(','));
    });
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `route-${plan.employeeId}-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleWhatsAppAll = () => {
    if (routePlans.length === 0) return;
    const allText = routePlans
      .map(p => buildWhatsAppText(p, today))
      .join('\n\n---\n\n');
    openWhatsApp(`*FleetOps Dispatch — All Routes — ${today}*\n\n${allText}`);
  };

  const handleRemoveStop = (techId: string, ticketId: string) => {
    const updated = routePlans.map(plan => {
      if (plan.technicianId !== techId) return plan;
      const newStops = plan.stops.filter(s => s.ticketId !== ticketId);
      return recalcPlan({ ...plan, stops: newStops }, centers);
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
      return recalcPlan({ ...plan, stops: [...plan.stops, newStop] }, centers);
    });
    saveRoutePlans(updated);
    setRoutePlans(updated);
    setAddStopOpen(prev => ({ ...prev, [techId]: false }));
    showToast('Stop added to route and ETAs recalculated.');
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

  // ── Feature 1: Drag-to-reorder handlers ──────────────────────────────────
  const handleDragStart = (techId: string, fromIdx: number) => {
    setDragState({ techId, fromIdx });
  };

  const handleDragOver = (e: React.DragEvent, techId: string, idx: number) => {
    e.preventDefault();
    setDragOverIdx({ techId, idx });
  };

  const handleDrop = (e: React.DragEvent, techId: string, toIdx: number) => {
    e.preventDefault();
    if (!dragState || dragState.techId !== techId || dragState.fromIdx === toIdx) {
      setDragState(null);
      setDragOverIdx(null);
      return;
    }
    const updated = routePlans.map(plan => {
      if (plan.technicianId !== techId) return plan;
      const stops = [...plan.stops];
      const [moved] = stops.splice(dragState.fromIdx, 1);
      stops.splice(toIdx, 0, moved);
      return recalcPlan({ ...plan, stops }, centers);
    });
    saveRoutePlans(updated);
    setRoutePlans(updated);
    setDragState(null);
    setDragOverIdx(null);
    showToast('Stop reordered and ETAs recalculated.');
  };

  const handleDragEnd = () => {
    setDragState(null);
    setDragOverIdx(null);
  };

  // ── Feature 2: Move stop to another tech ─────────────────────────────────
  const handleMoveStop = (fromTechId: string, ticketId: string, toTechId: string) => {
    let movedStop: RouteStop | undefined;
    const updated = routePlans.map(plan => {
      if (plan.technicianId === fromTechId) {
        movedStop = plan.stops.find(s => s.ticketId === ticketId);
        const newStops = plan.stops.filter(s => s.ticketId !== ticketId);
        return recalcPlan({ ...plan, stops: newStops }, centers);
      }
      return plan;
    });
    if (!movedStop) return;
    const finalUpdate = updated.map(plan => {
      if (plan.technicianId === toTechId) {
        return recalcPlan({ ...plan, stops: [...plan.stops, movedStop!] }, centers);
      }
      return plan;
    });
    saveRoutePlans(finalUpdate);
    setRoutePlans(finalUpdate);
    setMoveStopOpen(null);
    showToast('Stop moved and ETAs recalculated.');
  };

  // ── Feature 3: Inline stop edit save ─────────────────────────────────────
  const handleSaveStopEdit = () => {
    if (!editingStop) return;
    const { techId, ticketId, priority, issue } = editingStop;

    // Update plan stops
    const updatedPlans = routePlans.map(plan => {
      if (plan.technicianId !== techId) return plan;
      const newStops = plan.stops.map(s =>
        s.ticketId === ticketId
          ? { ...s, priority: priority as TicketPriority, issue }
          : s
      );
      return recalcPlan({ ...plan, stops: newStops }, centers);
    });
    saveRoutePlans(updatedPlans);
    setRoutePlans(updatedPlans);

    // Update ticket in allTickets
    const updatedTickets = allTickets.map(tk =>
      tk.ticketId === ticketId
        ? { ...tk, priority: priority as TicketPriority, issue, updatedAt: new Date().toISOString() }
        : tk
    );
    saveTickets(updatedTickets);
    setAllTickets(updatedTickets);

    setEditingStop(null);
    showToast('Stop updated.');
  };

  // ── Tracker helpers ────────────────────────────────────────────────────────
  const getTrackerStatus = (ticketId: string): 'assigned' | 'visited' | 'closed' => {
    return ticketTrackStatus[ticketId] ?? 'assigned';
  };

  const cycleTrackerStatus = (ticketId: string) => {
    const cur = getTrackerStatus(ticketId);
    const next: 'assigned' | 'visited' | 'closed' =
      cur === 'assigned' ? 'visited' : cur === 'visited' ? 'closed' : 'assigned';
    setTicketTrackStatus(prev => ({ ...prev, [ticketId]: next }));
    // If closing, also update ticket status in storage
    if (next === 'closed') {
      const updatedTickets = allTickets.map(tk =>
        tk.ticketId === ticketId ? { ...tk, status: 'Resolved' as const, updatedAt: new Date().toISOString() } : tk
      );
      saveTickets(updatedTickets);
      setAllTickets(updatedTickets);
    }
  };

  const exportTrackerCSV = () => {
    const rows = ['Ticket ID,Vehicle,Center,Issue,Priority,Tech,ETA,Tracker Status,Notes'];
    routePlans.forEach(plan => {
      plan.stops.forEach(stop => {
        const st = getTrackerStatus(stop.ticketId);
        const note = trackerNotes[stop.ticketId] ?? '';
        rows.push([
          stop.ticketId, stop.vehicleNumber,
          `"${stop.centerName}"`, `"${stop.issue || ''}"`,
          stop.priority, `"${plan.technicianName}"`,
          stop.estimatedArrival, st, `"${note}"`
        ].join(','));
      });
    });
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `tracker-${today}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const mapHeight = fullMap ? '600px' : '450px';

  // Derived tracker stats
  const trackerAllStops = routePlans.flatMap(plan =>
    plan.stops.map(stop => ({ stop, plan }))
  );
  const trackerAssigned = trackerAllStops.filter(({ stop }) => getTrackerStatus(stop.ticketId) === 'assigned').length;
  const trackerVisited  = trackerAllStops.filter(({ stop }) => getTrackerStatus(stop.ticketId) === 'visited').length;
  const trackerClosed   = trackerAllStops.filter(({ stop }) => getTrackerStatus(stop.ticketId) === 'closed').length;
  const trackerTotal    = trackerAllStops.length;
  const trackerPct      = trackerTotal > 0 ? Math.round((trackerClosed / trackerTotal) * 100) : 0;

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <>
    {/* ── Tab Bar ───────────────────────────────────────────────────────── */}
    <div className="flex border-b border-slate-200 bg-white sticky top-0 z-30 -mx-4 px-4 sm:-mx-6 sm:px-6 shadow-2xs mb-4">
      {[
        { id: 'routes' as const, label: '🗺 Route Planner' },
        { id: 'tracker' as const, label: '📊 Tracker' },
      ].map(tab => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={`px-5 py-3 text-xs font-bold tracking-wide border-b-2 transition-all whitespace-nowrap ${
            activeTab === tab.id
              ? 'border-teal-700 text-teal-700'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          {tab.label}
          {tab.id === 'tracker' && trackerTotal > 0 && (
            <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
              trackerPct === 100 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
            }`}>{trackerPct}%</span>
          )}
        </button>
      ))}
    </div>

    {/* ══════════════════ TRACKER TAB ══════════════════ */}
    {activeTab === 'tracker' && (
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">TICKET TRACKER</h1>
            <p className="text-xs text-slate-500 mt-0.5">Update status as technicians work through the day</p>
          </div>
          <button
            onClick={exportTrackerCSV}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors shadow-2xs"
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${trackerPct}%`,
              background: 'linear-gradient(90deg, #0E6B6E, #10b981)'
            }}
          />
        </div>

        {/* Pipeline columns */}
        <div className="grid grid-cols-4 divide-x divide-slate-200 border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs">
          {[
            { id: 'all' as const,      label: 'All Tickets', num: trackerTotal,   color: 'text-slate-900' },
            { id: 'assigned' as const, label: '🔵 Assigned', num: trackerAssigned, color: 'text-blue-600' },
            { id: 'visited' as const,  label: '🟡 Visited',  num: trackerVisited,  color: 'text-amber-600' },
            { id: 'closed' as const,   label: '✅ Closed',   num: trackerClosed,   color: 'text-emerald-600' },
          ].map(col => (
            <button
              key={col.id}
              onClick={() => setTrackerPipeFilter(col.id)}
              className={`py-4 text-center transition-colors ${
                trackerPipeFilter === col.id
                  ? 'bg-teal-700 text-white'
                  : 'hover:bg-slate-50'
              }`}
            >
              <div className={`text-2xl font-bold font-mono leading-none ${trackerPipeFilter === col.id ? 'text-white' : col.color}`}>
                {col.num}
              </div>
              <div className={`text-[11px] font-semibold mt-1 ${trackerPipeFilter === col.id ? 'text-white/80' : 'text-slate-500'}`}>
                {col.label}
              </div>
            </button>
          ))}
        </div>

        {/* Tech filter */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setTrackerTechFilter('all')}
            className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors border ${
              trackerTechFilter === 'all'
                ? 'bg-teal-700 text-white border-teal-700'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
            }`}
          >All Techs</button>
          {routePlans.map(plan => (
            <button
              key={plan.technicianId}
              onClick={() => setTrackerTechFilter(plan.technicianId)}
              className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors border ${
                trackerTechFilter === plan.technicianId
                  ? 'bg-teal-700 text-white border-teal-700'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
              }`}
            >
              {plan.technicianName.split(' ')[0]}
            </button>
          ))}
        </div>

        {/* Ticket list */}
        {routePlans.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-400 text-sm">
            No routes generated yet. Go to <strong>Route Planner</strong> and run AUTO-PLAN ROUTES first.
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs divide-y divide-slate-100">
            {trackerAllStops
              .filter(({ stop, plan }) => {
                if (trackerTechFilter !== 'all' && plan.technicianId !== trackerTechFilter) return false;
                if (trackerPipeFilter !== 'all' && getTrackerStatus(stop.ticketId) !== trackerPipeFilter) return false;
                return true;
              })
              .sort((a, b) => {
                // Sort by status: assigned → visited → closed, then by stop order
                const order = { assigned: 0, visited: 1, closed: 2 };
                const diff = order[getTrackerStatus(a.stop.ticketId)] - order[getTrackerStatus(b.stop.ticketId)];
                if (diff !== 0) return diff;
                return a.stop.stopOrder - b.stop.stopOrder;
              })
              .map(({ stop, plan }) => {
                const st = getTrackerStatus(stop.ticketId);
                return (
                  <div key={stop.ticketId} className={`px-4 py-3 transition-colors ${
                    st === 'closed' ? 'bg-emerald-50/40' : st === 'visited' ? 'bg-amber-50/40' : ''
                  }`}>
                    <div className="flex items-start gap-3">
                      {/* Status pill */}
                      <div className="flex rounded-lg overflow-hidden border border-slate-200 shrink-0 mt-0.5">
                        {(['assigned', 'visited', 'closed'] as const).map(s => (
                          <button
                            key={s}
                            onClick={() => setTicketTrackStatus(prev => ({ ...prev, [stop.ticketId]: s }))}
                            className={`px-2 py-1 text-[9px] font-bold transition-all ${
                              st === s
                                ? s === 'assigned' ? 'bg-blue-500 text-white'
                                  : s === 'visited' ? 'bg-amber-500 text-white'
                                  : 'bg-emerald-500 text-white'
                                : 'bg-white text-slate-400 hover:bg-slate-50'
                            }`}
                          >
                            {s === 'assigned' ? 'Asgnd' : s === 'visited' ? 'Vstd' : 'Done'}
                          </button>
                        ))}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-[11px] font-bold text-teal-700">{stop.ticketId}</span>
                          <PriorityBadge priority={stop.priority} />
                          {st === 'closed' && (
                            <span className="text-[10px] font-bold text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded-full">✓ Closed</span>
                          )}
                        </div>
                        <div className="text-[12px] font-semibold text-slate-800 mt-0.5 truncate">
                          {stop.centerName.replace(/_D$/, '')}
                        </div>
                        <div className="text-[11px] text-slate-500 flex gap-2 mt-0.5 flex-wrap">
                          <span>{stop.vehicleNumber}</span>
                          <span>·</span>
                          <span className="text-teal-700 font-semibold">{plan.technicianName}</span>
                          <span>·</span>
                          <span className="font-mono text-blue-600">ETA {stop.estimatedArrival}</span>
                          <span>·</span>
                          <span>Stop #{stop.stopOrder}</span>
                        </div>
                        {stop.issue && (
                          <div className="text-[10px] text-slate-400 truncate mt-0.5">{stop.issue}</div>
                        )}
                        {/* Inline note */}
                        <input
                          type="text"
                          placeholder="Add note..."
                          value={trackerNotes[stop.ticketId] ?? ''}
                          onChange={e => setTrackerNotes(prev => ({ ...prev, [stop.ticketId]: e.target.value }))}
                          className="mt-1.5 w-full text-[11px] px-2.5 py-1 border border-slate-200 rounded-lg focus:outline-none focus:border-teal-500 bg-white/80"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            {trackerAllStops.filter(({ stop, plan }) => {
              if (trackerTechFilter !== 'all' && plan.technicianId !== trackerTechFilter) return false;
              if (trackerPipeFilter !== 'all' && getTrackerStatus(stop.ticketId) !== trackerPipeFilter) return false;
              return true;
            }).length === 0 && (
              <div className="py-10 text-center text-slate-400 text-sm">
                No tickets match the current filter.
              </div>
            )}
          </div>
        )}
      </div>
    )}

    {/* ══════════════════ ROUTES TAB ══════════════════ */}
    {activeTab === 'routes' && (
    <div className="space-y-5">
      {/* Toast */}
      {toastMessage && (
        <div className={`p-3.5 border rounded-xl text-xs font-medium flex items-center justify-between shadow-xs ${
          toastType === 'error'
            ? 'bg-rose-50 border-rose-200 text-rose-800'
            : 'bg-emerald-50 border-emerald-200 text-emerald-800'
        }`}>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{toastMessage}</span>
          </div>
          <button onClick={() => setToastMessage(null)} className="text-slate-400 hover:text-slate-600 font-bold ml-3 shrink-0">×</button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">ROUTE PLANNER & DISPATCH</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Balanced geospatial optimizer · Assign, reorder, confirm and dispatch routes.
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowConstraints(v => !v)}
            className={`px-3 py-2 rounded-lg text-xs font-bold tracking-wide shadow-xs transition-colors flex items-center gap-1.5 ${
              showConstraints
                ? 'bg-slate-800 text-white'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            <Settings2 className="w-3.5 h-3.5" />
            CONSTRAINTS
          </button>

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
            CLEAR
          </button>

          {/* Download dropdown */}
          <div className="relative">
            <button
              onClick={() => setDownloadMenuOpen(v => !v)}
              className="px-3.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold shadow-xs transition-colors flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              DOWNLOAD
              <ChevronDown className="w-3 h-3" />
            </button>
            {downloadMenuOpen && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 w-44 py-1" onClick={() => setDownloadMenuOpen(false)}>
                <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">All Technicians</div>
                <button
                  onClick={handleDownloadCsvAll}
                  className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                >
                  📄 CSV — All Routes
                </button>
                <button
                  onClick={handleDownloadPdfAll}
                  className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                >
                  🖨 PDF — All Routes
                </button>
              </div>
            )}
          </div>

          <button
            onClick={handleWhatsAppAll}
            disabled={routePlans.length === 0}
            className="px-3.5 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white rounded-lg text-xs font-bold shadow-xs transition-colors flex items-center gap-1.5"
          >
            <MessageCircle className="w-3.5 h-3.5" />
            WA ALL
          </button>
        </div>
      </div>

      {/* Constraints Panel */}
      {showConstraints && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4">
          <h2 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Optimization Constraints</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Max stops */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-600 flex justify-between">
                <span>Max Stops / Tech</span>
                <span className="font-mono text-blue-700">{constraints.maxStopsPerTech}</span>
              </label>
              <input
                type="range" min={1} max={20} step={1}
                value={constraints.maxStopsPerTech}
                onChange={e => setConstraints(c => ({ ...c, maxStopsPerTech: Number(e.target.value) }))}
                className="w-full accent-blue-600"
              />
              <div className="flex justify-between text-[10px] text-slate-400"><span>1</span><span>20</span></div>
            </div>

            {/* Max km */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-600 flex justify-between">
                <span>Max km / Tech</span>
                <span className="font-mono text-blue-700">{constraints.maxKmPerTech} km</span>
              </label>
              <input
                type="range" min={10} max={120} step={5}
                value={constraints.maxKmPerTech}
                onChange={e => setConstraints(c => ({ ...c, maxKmPerTech: Number(e.target.value) }))}
                className="w-full accent-blue-600"
              />
              <div className="flex justify-between text-[10px] text-slate-400"><span>10km</span><span>120km</span></div>
            </div>

            {/* Shift hours */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-600">Shift Hours</label>
              <div className="flex items-center gap-2">
                <select
                  value={constraints.shiftStartHour}
                  onChange={e => setConstraints(c => ({ ...c, shiftStartHour: Number(e.target.value) }))}
                  className="flex-1 text-xs rounded-lg border border-slate-200 bg-white px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  {Array.from({ length: 13 }, (_, i) => i + 6).map(h => (
                    <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                  ))}
                </select>
                <span className="text-[11px] text-slate-400">to</span>
                <select
                  value={constraints.shiftEndHour}
                  onChange={e => setConstraints(c => ({ ...c, shiftEndHour: Number(e.target.value) }))}
                  className="flex-1 text-xs rounded-lg border border-slate-200 bg-white px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  {Array.from({ length: 13 }, (_, i) => i + 10).map(h => (
                    <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Skill match */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setConstraints(c => ({ ...c, skillMatch: !c.skillMatch }))}
                className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors ${
                  constraints.skillMatch ? 'bg-blue-600' : 'bg-slate-300'
                }`}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                  constraints.skillMatch ? 'translate-x-5' : 'translate-x-1'
                }`} />
              </button>
              <label className="text-[11px] font-semibold text-slate-600">Skill Match</label>
            </div>

            {/* Priority filter */}
            <div className="space-y-1 sm:col-span-2">
              <label className="text-[11px] font-semibold text-slate-600">Priority Filter</label>
              <div className="flex gap-2">
                {(['all', 'critical_high'] as const).map(opt => (
                  <button
                    key={opt}
                    onClick={() => setConstraints(c => ({ ...c, priorityFilter: opt }))}
                    className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors ${
                      constraints.priorityFilter === opt
                        ? 'bg-blue-600 text-white'
                        : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {opt === 'all' ? 'All Priorities' : 'Critical & High Only'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Reset */}
          <div className="flex justify-end">
            <button
              onClick={() => setConstraints(DEFAULT_CONSTRAINTS)}
              className="text-[11px] text-blue-600 hover:underline"
            >
              Reset to defaults
            </button>
          </div>
        </div>
      )}

      {/* Plan metadata banner */}
      {planMeta && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 flex flex-wrap gap-4 text-[11px] text-blue-800">
          <span>⚡ <strong>{planMeta.kmSaved} km saved</strong> vs naive assignment</span>
          <span>⏱ <strong>{planMeta.timeSavedMins} min saved</strong> in travel</span>
          <span>⚖️ Balance score: <strong>{planMeta.balanceScore}/100</strong></span>
        </div>
      )}

      {/* Stats bar — horizontally scrollable on mobile */}
      <div className="overflow-x-auto pb-1">
        <div className="flex gap-3 min-w-max lg:min-w-0 lg:grid lg:grid-cols-7">
          {[
            { label: 'Active Techs', value: activeTechs, color: 'text-slate-900' },
            { label: 'Total Stops', value: totalStops, color: 'text-blue-600' },
            { label: 'Unassigned', value: unassignedTicketsRaw.length, color: 'text-amber-600' },
            { label: 'Total Distance', value: `${totalKm} km`, color: 'text-slate-900' },
            { label: 'Avg Stops/Tech', value: avgStopsPerTech, color: 'text-slate-700' },
            { label: 'Plan Status', value: planStatus, color: planStatus === 'All Confirmed' ? 'text-emerald-600' : 'text-amber-600' },
            { label: 'Coverage', value: `${coveragePct}%`, color: coveragePct >= 80 ? 'text-emerald-600' : coveragePct >= 50 ? 'text-amber-600' : 'text-rose-600' }
          ].map(stat => (
            <div key={stat.label} className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs min-w-[110px] lg:min-w-0">
              <span className="text-[10px] text-slate-500 font-medium block whitespace-nowrap">{stat.label}</span>
              <div className={`text-base font-bold mt-0.5 ${stat.color}`}>{stat.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Two-column layout — stacks on mobile */}
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
                const tech = technicians.find(t => t.id === plan.technicianId);
                const isSelected = selectedTechId === plan.technicianId;
                const isExpanded = expandedCards.has(plan.technicianId);
                const isAddOpen = addStopOpen[plan.technicianId] ?? false;
                const isCardConfirmed = confirmedCards.has(plan.technicianId);

                return (
                  <div
                    key={plan.technicianId}
                    className={`bg-white rounded-xl border shadow-2xs transition-all ${
                      isSelected ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-slate-200'
                    }`}
                  >
                    {/* Card header */}
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
                          {tech?.city && (
                            <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                              {tech.city}{tech.zone ? ` · ${tech.zone}` : ''}
                            </span>
                          )}
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

                      {/* WhatsApp per-tech */}
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          openWhatsApp(buildWhatsAppText(plan, today));
                        }}
                        title="Send route via WhatsApp"
                        className="ml-1 p-1.5 rounded-lg hover:bg-green-50 text-green-600 transition-colors"
                      >
                        <MessageCircle className="w-4 h-4" />
                      </button>

                      <button
                        onClick={e => { e.stopPropagation(); handleDownloadCsvTech(plan); }}
                        title="Download CSV for this tech"
                        className="ml-1 p-1.5 rounded-lg hover:bg-blue-50 text-blue-600 transition-colors text-[10px] font-bold"
                      >
                        CSV
                      </button>

                      <button
                        onClick={e => { e.stopPropagation(); handleDownloadPdfTech(plan); }}
                        title="Download PDF for this tech"
                        className="ml-1 p-1.5 rounded-lg hover:bg-orange-50 text-orange-600 transition-colors text-[10px] font-bold"
                      >
                        PDF
                      </button>

                      <button
                        onClick={e => { e.stopPropagation(); toggleCard(plan.technicianId); }}
                        className="ml-1 p-1 rounded hover:bg-slate-100 text-slate-400"
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
                          plan.stops.map((stop, idx) => {
                            const isDragging = dragState?.techId === plan.technicianId && dragState?.fromIdx === idx;
                            const isDropTarget = dragOverIdx?.techId === plan.technicianId && dragOverIdx?.idx === idx;
                            const isMoveOpen = moveStopOpen?.techId === plan.technicianId && moveStopOpen?.ticketId === stop.ticketId;
                            const isEditing = editingStop?.techId === plan.technicianId && editingStop?.ticketId === stop.ticketId;

                            {/* Derived visit info for this stop */}
                            const stopVisitLogs = visitLogs.filter(v => v.ticketId === stop.ticketId);
                            const lastVisit = stopVisitLogs[0];
                            const isVisited = stopVisitLogs.length > 0;
                            const liveStatus = allTickets.find(t => t.ticketId === stop.ticketId)?.status ?? 'Open';
                            const isClosed = liveStatus === 'Resolved' || liveStatus === 'Closed';

                            return (
                              <div key={stop.ticketId}>
                                {/* Stop row */}
                                <div
                                  draggable
                                  onDragStart={() => handleDragStart(plan.technicianId, idx)}
                                  onDragOver={e => handleDragOver(e, plan.technicianId, idx)}
                                  onDrop={e => handleDrop(e, plan.technicianId, idx)}
                                  onDragEnd={handleDragEnd}
                                  className={`flex items-center gap-2 p-2.5 rounded-lg border text-xs transition-all ${
                                    isClosed ? 'bg-emerald-50 border-emerald-200' :
                                    isVisited ? 'bg-blue-50 border-blue-200' :
                                    'bg-slate-50 border-slate-100'
                                  } ${isDragging ? 'opacity-50' : ''} ${isDropTarget ? 'border-t-2 border-t-blue-500' : ''}`}
                                >
                                  {/* Drag handle */}
                                  <span
                                    className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 shrink-0"
                                    title="Drag to reorder"
                                  >
                                    <GripVertical className="w-3.5 h-3.5" />
                                  </span>

                                  <span className={`w-5 h-5 rounded-full text-white font-mono text-[10px] flex items-center justify-center font-bold shrink-0 ${
                                    isClosed ? 'bg-emerald-600' : isVisited ? 'bg-blue-600' : 'bg-slate-800'
                                  }`}>
                                    {isClosed ? '✓' : stop.stopOrder}
                                  </span>
                                  <div className="flex-1 min-w-0">
                                    <div className="font-semibold text-slate-900 truncate">{stop.centerName}</div>
                                    <div className="text-[10px] text-slate-500 flex gap-2 flex-wrap">
                                      <span>{stop.vehicleNumber}</span>
                                      <span className="truncate max-w-[160px]">{stop.issue}</span>
                                    </div>
                                    {/* Visit badge */}
                                    {lastVisit && (
                                      <div className="mt-0.5 flex items-center gap-1 text-[10px]">
                                        <span className={`px-1.5 py-0.5 rounded font-semibold ${
                                          lastVisit.outcome === 'Resolved' ? 'bg-emerald-100 text-emerald-700' :
                                          lastVisit.outcome === 'Partial Fix' ? 'bg-blue-100 text-blue-700' :
                                          lastVisit.outcome === 'Pending Spares' ? 'bg-amber-100 text-amber-700' :
                                          lastVisit.outcome === 'Escalated' ? 'bg-red-100 text-red-700' :
                                          'bg-slate-100 text-slate-600'
                                        }`}>
                                          {lastVisit.outcome}
                                        </span>
                                        {lastVisit.checkInTime && (
                                          <span className="text-slate-400">In {lastVisit.checkInTime}{lastVisit.checkOutTime ? ` → Out ${lastVisit.checkOutTime}` : ''}</span>
                                        )}
                                        {stopVisitLogs.length > 1 && (
                                          <span className="text-slate-400">· {stopVisitLogs.length} visits</span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <PriorityBadge priority={stop.priority} />
                                    <span className="font-mono text-[11px] font-bold text-blue-600">{stop.estimatedArrival}</span>

                                    {/* Mark Visit button */}
                                    <button
                                      onClick={() => openVisitModal(plan, stop)}
                                      title="Log a visit for this stop"
                                      className={`w-5 h-5 flex items-center justify-center rounded transition-colors ${
                                        isClosed
                                          ? 'text-emerald-500 hover:bg-emerald-100'
                                          : 'text-slate-400 hover:bg-emerald-50 hover:text-emerald-600'
                                      }`}
                                    >
                                      <ClipboardList className="w-3 h-3" />
                                    </button>

                                    {/* Visit history button — only if logs exist */}
                                    {stopVisitLogs.length > 0 && (
                                      <button
                                        onClick={() => setVisitHistoryTicketId(
                                          visitHistoryTicketId === stop.ticketId ? null : stop.ticketId
                                        )}
                                        title="View visit history"
                                        className="w-5 h-5 flex items-center justify-center rounded text-blue-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                                      >
                                        <History className="w-3 h-3" />
                                      </button>
                                    )}

                                    {/* Inline edit button */}
                                    <button
                                      onClick={() => {
                                        if (isEditing) {
                                          setEditingStop(null);
                                        } else {
                                          setEditingStop({ techId: plan.technicianId, ticketId: stop.ticketId, priority: stop.priority, issue: stop.issue });
                                          setMoveStopOpen(null);
                                        }
                                      }}
                                      title="Edit stop"
                                      className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                                    >
                                      <Edit2 className="w-3 h-3" />
                                    </button>

                                    {/* Move stop button */}
                                    <div className="relative">
                                      <button
                                        onClick={() => {
                                          if (isMoveOpen) {
                                            setMoveStopOpen(null);
                                          } else {
                                            setMoveStopOpen({ techId: plan.technicianId, ticketId: stop.ticketId });
                                            setEditingStop(null);
                                          }
                                        }}
                                        title="Move to another tech"
                                        className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:bg-amber-50 hover:text-amber-600 transition-colors"
                                      >
                                        <ArrowRight className="w-3 h-3" />
                                      </button>

                                      {/* Move dropdown */}
                                      {isMoveOpen && (
                                        <div className="absolute z-30 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg w-48 max-h-48 overflow-y-auto">
                                          <div className="px-3 py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wide border-b border-slate-100">
                                            Move to tech
                                          </div>
                                          {routePlans
                                            .filter(p => p.technicianId !== plan.technicianId)
                                            .map(targetPlan => (
                                              <button
                                                key={targetPlan.technicianId}
                                                onClick={() => handleMoveStop(plan.technicianId, stop.ticketId, targetPlan.technicianId)}
                                                className="w-full text-left px-3 py-2 hover:bg-amber-50 border-b border-slate-100 last:border-0 transition-colors"
                                              >
                                                <div className="text-[11px] font-semibold text-slate-800 truncate">{targetPlan.technicianName}</div>
                                                <div className="text-[10px] text-slate-400">{targetPlan.stops.length} stops</div>
                                              </button>
                                            ))
                                          }
                                          {routePlans.filter(p => p.technicianId !== plan.technicianId).length === 0 && (
                                            <div className="px-3 py-2 text-[11px] text-slate-400">No other techs.</div>
                                          )}
                                        </div>
                                      )}
                                    </div>

                                    {/* Remove button */}
                                    <button
                                      onClick={() => handleRemoveStop(plan.technicianId, stop.ticketId)}
                                      title="Remove stop"
                                      className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>

                                {/* Visit History panel */}
                                {visitHistoryTicketId === stop.ticketId && stopVisitLogs.length > 0 && (
                                  <div className="mt-1 ml-5 p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
                                    <div className="text-[10px] font-bold text-blue-800 uppercase tracking-wider mb-1 flex items-center gap-1">
                                      <History className="w-3 h-3" /> Visit History — {stop.ticketId}
                                    </div>
                                    {stopVisitLogs.map(vl => (
                                      <div key={vl.id} className="bg-white border border-blue-100 rounded-lg px-3 py-2 text-[11px]">
                                        <div className="flex items-center justify-between gap-2 flex-wrap">
                                          <span className="font-semibold text-slate-800">{vl.visitDate}</span>
                                          <span className={`px-1.5 py-0.5 rounded font-bold text-[10px] ${
                                            vl.outcome === 'Resolved' ? 'bg-emerald-100 text-emerald-700' :
                                            vl.outcome === 'Partial Fix' ? 'bg-blue-100 text-blue-700' :
                                            vl.outcome === 'Pending Spares' ? 'bg-amber-100 text-amber-700' :
                                            vl.outcome === 'Escalated' ? 'bg-red-100 text-red-700' :
                                            'bg-slate-100 text-slate-600'
                                          }`}>{vl.outcome}</span>
                                        </div>
                                        <div className="text-slate-500 mt-0.5">
                                          {vl.technicianName} · {vl.checkInTime ?? '—'}{vl.checkOutTime ? ` → ${vl.checkOutTime}` : ''}
                                        </div>
                                        {vl.notes && <div className="text-slate-600 mt-0.5 italic">"{vl.notes}"</div>}
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* Inline edit form */}
                                {isEditing && editingStop && (
                                  <div className="mt-1 ml-5 p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
                                    <div className="flex gap-2 flex-wrap">
                                      <div className="flex-1 min-w-[120px] space-y-1">
                                        <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wide">Priority</label>
                                        <select
                                          value={editingStop.priority}
                                          onChange={e => setEditingStop(prev => prev ? { ...prev, priority: e.target.value } : null)}
                                          className="w-full text-xs rounded-lg border border-slate-200 bg-white px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
                                        >
                                          {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map(p => (
                                            <option key={p} value={p}>{p}</option>
                                          ))}
                                        </select>
                                      </div>
                                      <div className="flex-[2] min-w-[160px] space-y-1">
                                        <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wide">Issue / Notes</label>
                                        <input
                                          type="text"
                                          value={editingStop.issue}
                                          onChange={e => setEditingStop(prev => prev ? { ...prev, issue: e.target.value } : null)}
                                          className="w-full text-xs rounded-lg border border-slate-200 bg-white px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
                                        />
                                      </div>
                                    </div>
                                    <div className="flex gap-2 justify-end">
                                      <button
                                        onClick={() => setEditingStop(null)}
                                        className="px-3 py-1 rounded-lg text-[11px] font-bold bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        onClick={handleSaveStopEdit}
                                        className="px-3 py-1 rounded-lg text-[11px] font-bold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                                      >
                                        Save
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })
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
                              {unassignedTicketsRaw.length === 0 ? (
                                <div className="p-3 text-xs text-slate-400 text-center">No unassigned tickets available.</div>
                              ) : (
                                unassignedTicketsRaw.map(tk => (
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

                        {/* Card footer — Confirm button */}
                        <div className="flex justify-end pt-2 border-t border-slate-100 mt-2">
                          <button
                            onClick={() => handleToggleCardConfirm(plan.technicianId)}
                            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${
                              isCardConfirmed
                                ? 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                                : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                            }`}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {isCardConfirmed ? 'Unconfirm' : 'Confirm Route'}
                          </button>
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
              <div className="flex items-center gap-2">
                {selectedTechId && (
                  <button
                    onClick={() => setSelectedTechId(undefined)}
                    className="text-blue-600 hover:underline text-[11px]"
                  >
                    Show all
                  </button>
                )}
                <button
                  onClick={() => setFullMap(v => !v)}
                  title={fullMap ? 'Collapse map' : 'Full map'}
                  className="flex items-center gap-1 text-slate-500 hover:text-slate-800 transition-colors"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span className="text-[11px]">{fullMap ? 'Collapse' : 'Full Map'}</span>
                </button>
              </div>
            </div>
            <LiveMapViewer
              centers={centers}
              technicians={technicians}
              routePlans={routePlans}
              selectedTechId={selectedTechId}
              allTickets={allTickets}
              height={mapHeight}
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
                {unassignedTicketsRaw.length}
              </span>
            </div>

            {/* Unassigned search + priority filter */}
            <div className="px-4 py-2.5 space-y-2 border-b border-slate-100">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search by ID / center / vehicle…"
                  value={unassignedSearch}
                  onChange={e => setUnassignedSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {(['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map(p => (
                  <button
                    key={p}
                    onClick={() => setUnassignedPriorityFilter(p)}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-colors ${
                      unassignedPriorityFilter === p
                        ? 'bg-slate-800 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
              {unassignedTickets.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  <AlertCircle className="w-6 h-6 mx-auto mb-2 text-slate-300" />
                  {unassignedTicketsRaw.length === 0 ? 'All routable tickets are assigned.' : 'No tickets match the filter.'}
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

      {/* ── Assignment Table ─────────────────────────────────────────────────── */}
      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-slate-900 text-white">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-slate-300" />
            <span className="text-sm font-bold tracking-tight">ASSIGNMENT ROSTER</span>
            <span className="text-[11px] bg-slate-700 text-slate-300 rounded px-1.5 py-0.5 ml-1">
              {routePlans.reduce((s, p) => s + p.stops.length, 0)} assigned
              {allTickets.filter(t => t.status !== 'Resolved' && t.status !== 'Closed' && !routePlans.flatMap(p => p.stops).some(s => s.ticketId === t.ticketId)).length > 0 &&
                ` · ${allTickets.filter(t => t.status !== 'Resolved' && t.status !== 'Closed' && !routePlans.flatMap(p => p.stops).some(s => s.ticketId === t.ticketId)).length} unassigned`
              }
            </span>
          </div>
          <button
            onClick={handleDownloadRoster}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[11px] font-bold transition-colors"
          >
            <Download className="w-3 h-3" /> Download Roster
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {['Ticket ID', 'Vehicle', 'Center', 'Issue', 'Priority', 'Assigned Tech', 'Stop #', 'ETA', 'Status'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left font-semibold text-slate-500 whitespace-nowrap uppercase tracking-wide text-[10px]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {/* Assigned stops sorted by tech then stop order */}
              {routePlans.flatMap(plan =>
                plan.stops
                  .slice()
                  .sort((a, b) => a.stopOrder - b.stopOrder)
                  .map(stop => (
                    <tr key={`${plan.technicianId}-${stop.ticketId}`} className="hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-2 font-mono font-semibold text-slate-800 whitespace-nowrap">{stop.ticketId}</td>
                      <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{stop.vehicleNumber}</td>
                      <td className="px-3 py-2 text-slate-600 truncate max-w-[140px]">{stop.centerName.replace(/_D$/, '')}</td>
                      <td className="px-3 py-2 text-slate-500 truncate max-w-[160px]">{stop.issue}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold text-white ${
                          stop.priority === 'CRITICAL' ? 'bg-red-600' :
                          stop.priority === 'HIGH' ? 'bg-orange-500' :
                          stop.priority === 'MEDIUM' ? 'bg-yellow-500' : 'bg-green-600'
                        }`}>{stop.priority}</span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="font-semibold text-slate-800">{plan.technicianName}</div>
                        <div className="text-[10px] text-slate-400">{plan.employeeId}</div>
                      </td>
                      <td className="px-3 py-2 text-center font-bold text-slate-700">{stop.stopOrder}</td>
                      <td className="px-3 py-2 font-mono text-blue-700 font-semibold whitespace-nowrap">{stop.estimatedArrival}</td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[10px] font-semibold">
                          <CheckCircle2 className="w-3 h-3" /> Assigned
                        </span>
                      </td>
                    </tr>
                  ))
              )}
              {/* Unassigned open tickets */}
              {allTickets
                .filter(tk => {
                  if (tk.status === 'Resolved' || tk.status === 'Closed') return false;
                  return !routePlans.flatMap(p => p.stops).some(s => s.ticketId === tk.ticketId);
                })
                .map(tk => (
                  <tr key={tk.id} className="hover:bg-rose-50 transition-colors bg-rose-50/30">
                    <td className="px-3 py-2 font-mono font-semibold text-slate-800 whitespace-nowrap">{tk.ticketId}</td>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{tk.vehicleNumber}</td>
                    <td className="px-3 py-2 text-slate-600 truncate max-w-[140px]">{tk.centerName.replace(/_D$/, '')}</td>
                    <td className="px-3 py-2 text-slate-500 truncate max-w-[160px]">{tk.issue}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold text-white ${
                        tk.priority === 'CRITICAL' ? 'bg-red-600' :
                        tk.priority === 'HIGH' ? 'bg-orange-500' :
                        tk.priority === 'MEDIUM' ? 'bg-yellow-500' : 'bg-green-600'
                      }`}>{tk.priority}</span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {tk.assignedTechnicianName
                        ? <span className="text-slate-600">{tk.assignedTechnicianName}</span>
                        : <span className="text-rose-500 font-semibold">— Unassigned</span>
                      }
                    </td>
                    <td className="px-3 py-2 text-center text-slate-400">—</td>
                    <td className="px-3 py-2 text-slate-400">—</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-rose-100 text-rose-700 rounded text-[10px] font-semibold">
                        <AlertCircle className="w-3 h-3" /> Not Routed
                      </span>
                    </td>
                  </tr>
                ))
              }
              {routePlans.length === 0 && allTickets.filter(t => t.status !== 'Resolved' && t.status !== 'Closed').length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-400 text-xs">
                    No tickets to show. Run AUTO-PLAN ROUTES to generate assignments.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    )}


    {/* ── Visit Log Modal ─────────────────────────────────────────────────── */}
    {visitModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 bg-slate-900 text-white">
            <div>
              <div className="font-bold text-sm flex items-center gap-2">
                <ClipboardList className="w-4 h-4 text-emerald-400" />
                Log Visit
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                {visitModal.stop.ticketId} · {visitModal.stop.centerName.replace(/_D$/, '')} · {visitModal.stop.vehicleNumber}
              </div>
            </div>
            <button onClick={() => setVisitModal(null)} className="p-1 rounded-lg hover:bg-slate-700 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-5 space-y-4">
            {/* Tech + date (read-only info) */}
            <div className="flex gap-3 text-xs text-slate-600 bg-slate-50 rounded-xl px-3 py-2.5">
              <span className="font-semibold">{visitModal.plan.technicianName}</span>
              <span>·</span>
              <span>{visitModal.plan.employeeId}</span>
              <span>·</span>
              <span className="font-mono">{today}</span>
            </div>

            {/* Check-in / Check-out times */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Check-In Time</label>
                <input
                  type="time"
                  value={visitForm.checkInTime}
                  onChange={e => setVisitForm(f => ({ ...f, checkInTime: e.target.value }))}
                  className="w-full text-xs rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Check-Out Time</label>
                <input
                  type="time"
                  value={visitForm.checkOutTime}
                  onChange={e => setVisitForm(f => ({ ...f, checkOutTime: e.target.value }))}
                  className="w-full text-xs rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
            </div>

            {/* Outcome */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Outcome</label>
              <div className="grid grid-cols-3 gap-2">
                {(['Resolved', 'Partial Fix', 'Pending Spares', 'Escalated', 'No Access', 'Revisit Needed'] as VisitOutcome[]).map(o => (
                  <button
                    key={o}
                    onClick={() => setVisitForm(f => ({ ...f, outcome: o }))}
                    className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${
                      visitForm.outcome === o
                        ? o === 'Resolved' ? 'bg-emerald-600 text-white border-emerald-600'
                          : o === 'Partial Fix' ? 'bg-blue-600 text-white border-blue-600'
                          : o === 'Pending Spares' ? 'bg-amber-500 text-white border-amber-500'
                          : o === 'Escalated' ? 'bg-red-600 text-white border-red-600'
                          : 'bg-slate-700 text-white border-slate-700'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                    }`}
                  >
                    {o}
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Notes / Remarks</label>
              <textarea
                rows={3}
                placeholder="Parts replaced, issues found, next steps..."
                value={visitForm.notes}
                onChange={e => setVisitForm(f => ({ ...f, notes: e.target.value }))}
                className="w-full text-xs rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
              />
            </div>

            {/* Actions */}
            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={() => setVisitModal(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveVisit}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Save Visit
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  );
};
