import React, { useState, useCallback } from 'react';
import { TechnicianRoutePlan, RouteStop, Ticket, TicketPriority } from '../../types';
import { saveTickets } from '../../services/storage';
import { Download } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────
type TrackStatus = 'assigned' | 'visited' | 'closed';
type PipeFilter = 'all' | TrackStatus;

interface StopWithPlan {
  stop: RouteStop;
  plan: TechnicianRoutePlan;
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface TrackerTabProps {
  routePlans: TechnicianRoutePlan[];
  allTickets: Ticket[];
  setAllTickets: (tickets: Ticket[]) => void;
  today: string;
}

// ─── Priority badge (local copy so TrackerTab is fully self-contained) ────────
function PriorityBadge({ priority }: { priority: TicketPriority }) {
  const cls: Record<TicketPriority, string> = {
    CRITICAL: 'bg-rose-100 text-rose-700',
    HIGH:     'bg-orange-100 text-orange-700',
    MEDIUM:   'bg-amber-100 text-amber-700',
    LOW:      'bg-slate-100 text-slate-600',
  };
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${cls[priority] ?? cls.LOW}`}>
      {priority}
    </span>
  );
}

// ─── Status pill colours ──────────────────────────────────────────────────────
const STATUS_ACTIVE_CLS: Record<TrackStatus, string> = {
  assigned: 'bg-blue-500 text-white',
  visited:  'bg-amber-500 text-white',
  closed:   'bg-emerald-500 text-white',
};

const STATUS_LABEL: Record<TrackStatus, string> = {
  assigned: 'Asgnd',
  visited:  'Vstd',
  closed:   'Done',
};

// ─── Component ────────────────────────────────────────────────────────────────
export const TrackerTab: React.FC<TrackerTabProps> = ({
  routePlans,
  allTickets,
  setAllTickets,
  today,
}) => {
  // ── state ──────────────────────────────────────────────────────────────────
  const [ticketTrackStatus, setTicketTrackStatus] = useState<Record<string, TrackStatus>>({});
  const [techFilter, setTechFilter] = useState<string>('all');
  const [pipeFilter, setPipeFilter] = useState<PipeFilter>('all');
  const [notes, setNotes] = useState<Record<string, string>>({});

  // ── derived ────────────────────────────────────────────────────────────────
  const getStatus = useCallback(
    (ticketId: string): TrackStatus => ticketTrackStatus[ticketId] ?? 'assigned',
    [ticketTrackStatus],
  );

  const allStops: StopWithPlan[] = routePlans.flatMap(plan =>
    plan.stops.map(stop => ({ stop, plan })),
  );

  const counts = {
    total:    allStops.length,
    assigned: allStops.filter(({ stop }) => getStatus(stop.ticketId) === 'assigned').length,
    visited:  allStops.filter(({ stop }) => getStatus(stop.ticketId) === 'visited').length,
    closed:   allStops.filter(({ stop }) => getStatus(stop.ticketId) === 'closed').length,
  };

  const pct = counts.total > 0 ? Math.round((counts.closed / counts.total) * 100) : 0;

  // ── handlers ───────────────────────────────────────────────────────────────
  const setStatus = (ticketId: string, next: TrackStatus) => {
    setTicketTrackStatus(prev => ({ ...prev, [ticketId]: next }));
    // Closing a ticket → mark Resolved in storage
    if (next === 'closed') {
      const updated = allTickets.map(tk =>
        tk.ticketId === ticketId
          ? { ...tk, status: 'Resolved' as const, updatedAt: new Date().toISOString() }
          : tk,
      );
      saveTickets(updated);
      setAllTickets(updated);
    }
  };

  const exportCSV = () => {
    const rows = ['Ticket ID,Vehicle,Center,Issue,Priority,Tech,ETA,Tracker Status,Notes'];
    allStops.forEach(({ stop, plan }) => {
      rows.push(
        [
          stop.ticketId,
          stop.vehicleNumber,
          `"${stop.centerName}"`,
          `"${stop.issue ?? ''}"`,
          stop.priority,
          `"${plan.technicianName}"`,
          stop.estimatedArrival,
          getStatus(stop.ticketId),
          `"${notes[stop.ticketId] ?? ''}"`,
        ].join(','),
      );
    });
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tracker-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── filtered + sorted list ─────────────────────────────────────────────────
  const ORDER: Record<TrackStatus, number> = { assigned: 0, visited: 1, closed: 2 };

  const visible = allStops
    .filter(({ stop, plan }) => {
      if (techFilter !== 'all' && plan.technicianId !== techFilter) return false;
      if (pipeFilter !== 'all' && getStatus(stop.ticketId) !== pipeFilter) return false;
      return true;
    })
    .sort((a, b) => {
      const diff = ORDER[getStatus(a.stop.ticketId)] - ORDER[getStatus(b.stop.ticketId)];
      return diff !== 0 ? diff : a.stop.stopOrder - b.stop.stopOrder;
    });

  // ── pipeline column config ─────────────────────────────────────────────────
  const PIPELINE: { id: PipeFilter; label: string; num: number; color: string }[] = [
    { id: 'all',      label: 'All Tickets',  num: counts.total,    color: 'text-slate-900' },
    { id: 'assigned', label: '🔵 Assigned',  num: counts.assigned, color: 'text-blue-600' },
    { id: 'visited',  label: '🟡 Visited',   num: counts.visited,  color: 'text-amber-600' },
    { id: 'closed',   label: '✅ Closed',    num: counts.closed,   color: 'text-emerald-600' },
  ];

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">TICKET TRACKER</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Update status as technicians work through the day
          </p>
        </div>
        <button
          onClick={exportCSV}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors shadow-2xs"
        >
          <Download className="w-3.5 h-3.5" /> Export CSV
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #0E6B6E, #10b981)' }}
        />
      </div>

      {/* Pipeline columns */}
      <div className="grid grid-cols-4 divide-x divide-slate-200 border border-slate-200 rounded-xl overflow-hidden bg-white shadow-2xs">
        {PIPELINE.map(col => (
          <button
            key={col.id}
            onClick={() => setPipeFilter(col.id)}
            className={`py-4 text-center transition-colors ${
              pipeFilter === col.id ? 'bg-teal-700 text-white' : 'hover:bg-slate-50'
            }`}
          >
            <div
              className={`text-2xl font-bold font-mono leading-none ${
                pipeFilter === col.id ? 'text-white' : col.color
              }`}
            >
              {col.num}
            </div>
            <div
              className={`text-[11px] font-semibold mt-1 ${
                pipeFilter === col.id ? 'text-white/80' : 'text-slate-500'
              }`}
            >
              {col.label}
            </div>
          </button>
        ))}
      </div>

      {/* Tech filter chips */}
      <div className="flex gap-2 flex-wrap">
        {['all', ...routePlans.map(p => p.technicianId)].map(id => {
          const plan = routePlans.find(p => p.technicianId === id);
          const label = id === 'all' ? 'All Techs' : plan?.technicianName.split(' ')[0] ?? id;
          return (
            <button
              key={id}
              onClick={() => setTechFilter(id)}
              className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors border ${
                techFilter === id
                  ? 'bg-teal-700 text-white border-teal-700'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Ticket list */}
      {routePlans.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-400 text-sm">
          No routes generated yet. Go to{' '}
          <strong>Route Planner</strong> and run AUTO-PLAN ROUTES first.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs divide-y divide-slate-100">
          {visible.length === 0 ? (
            <div className="py-10 text-center text-slate-400 text-sm">
              No tickets match the current filter.
            </div>
          ) : (
            visible.map(({ stop, plan }) => {
              const st = getStatus(stop.ticketId);
              return (
                <div
                  key={stop.ticketId}
                  className={`px-4 py-3 transition-colors ${
                    st === 'closed'
                      ? 'bg-emerald-50/40'
                      : st === 'visited'
                      ? 'bg-amber-50/40'
                      : ''
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* Status pill */}
                    <div className="flex rounded-lg overflow-hidden border border-slate-200 shrink-0 mt-0.5">
                      {(['assigned', 'visited', 'closed'] as TrackStatus[]).map(s => (
                        <button
                          key={s}
                          onClick={() => setStatus(stop.ticketId, s)}
                          className={`px-2 py-1 text-[9px] font-bold transition-all ${
                            st === s
                              ? STATUS_ACTIVE_CLS[s]
                              : 'bg-white text-slate-400 hover:bg-slate-50'
                          }`}
                        >
                          {STATUS_LABEL[s]}
                        </button>
                      ))}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-[11px] font-bold text-teal-700">
                          {stop.ticketId}
                        </span>
                        <PriorityBadge priority={stop.priority} />
                        {st === 'closed' && (
                          <span className="text-[10px] font-bold text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded-full">
                            ✓ Closed
                          </span>
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
                        <div className="text-[10px] text-slate-400 truncate mt-0.5">
                          {stop.issue}
                        </div>
                      )}

                      <input
                        type="text"
                        placeholder="Add note..."
                        value={notes[stop.ticketId] ?? ''}
                        onChange={e =>
                          setNotes(prev => ({ ...prev, [stop.ticketId]: e.target.value }))
                        }
                        className="mt-1.5 w-full text-[11px] px-2.5 py-1 border border-slate-200 rounded-lg focus:outline-none focus:border-teal-500 bg-white/80"
                      />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
