/**
 * "Select what to plan" — choose which tickets and technicians take part in
 * route planning. Ticking writes the shared flags (ticket.ignoreForRouting /
 * technician.excludeFromRouting), so every planner and Active Cases /
 * Technicians agree. Used by City Routes, Route Planner and Smart Route.
 */
import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, SlidersHorizontal } from 'lucide-react';
import {
  getTickets, getTechnicians, getCenters, getAttendance, saveTechnicians, setTicketsIgnored, subscribeToDataChanges,
} from '../../services/storage';
import { normaliseCityToPreset } from '../../services/routeOptimizer';
import { localDate } from '../../lib/date';

const PRIORITY_STYLE: Record<string, string> = {
  CRITICAL: 'bg-rose-100 text-rose-700', HIGH: 'bg-orange-100 text-orange-700',
  MEDIUM: 'bg-amber-100 text-amber-700', LOW: 'bg-slate-100 text-slate-600',
};

/** Signature of the current selection for a city ('ALL' = every city) — compare to detect changes after planning. */
export function selectionSignature(city: string): string {
  const { tickets, techs } = selectionFor(city);
  return tickets.filter(t => !t.ignoreForRouting).map(t => t.id).join(',') + '|' + techs.filter(t => !t.excludeFromRouting).map(t => t.id).join(',');
}

function selectionFor(city: string) {
  const inCity = (c?: string | null) => city === 'ALL' || normaliseCityToPreset(c || '') === city;
  const centerCity = new Map(getCenters().map(c => [c.name.trim().toLowerCase(), c.city]));
  const tickets = getTickets()
    .filter(t => t.status !== 'Resolved' && t.status !== 'Closed' && inCity(centerCity.get(t.centerName.trim().toLowerCase())))
    .sort((a, b) => a.ticketId.localeCompare(b.ticketId)); // fixed order: rows never jump when ticked
  const techs = getTechnicians()
    .filter(t => t.status === 'Active' && t.startingLatitude != null && t.startingLongitude != null && inCity(t.city))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { tickets, techs };
}

export function PlanSelectionPanel({ city, stale = false, defaultOpen = true }: {
  /** City preset key (e.g. 'Delhi NCR') or 'ALL' */
  city: string;
  /** Show "selection changed — optimise again" */
  stale?: boolean;
  defaultOpen?: boolean;
}) {
  const [, setTick] = useState(0);
  useEffect(() => subscribeToDataChanges(() => setTick(n => n + 1)), []);
  const [open, setOpen] = useState(defaultOpen);

  const { tickets, techs } = selectionFor(city);
  const today = localDate();
  const absent = new Set(getAttendance()
    .filter(a => a.date === today && a.status !== 'Present' && a.status !== 'Half-Day')
    .map(a => a.employeeId.toUpperCase()));
  const ticketsIn = tickets.filter(t => !t.ignoreForRouting).length;
  const techsIn = techs.filter(t => !t.excludeFromRouting && !absent.has(t.employeeId.toUpperCase())).length;

  const setTicketIncluded = (ids: string[], include: boolean) => setTicketsIgnored(ids, !include);
  const setTechIncluded = (ids: string[], include: boolean) => {
    const set = new Set(ids);
    const now = new Date().toISOString();
    saveTechnicians(getTechnicians().map(t => (set.has(t.id) && Boolean(t.excludeFromRouting) === include ? { ...t, excludeFromRouting: !include, updatedAt: now } : t)));
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-slate-50">
        {open ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
        <SlidersHorizontal className="w-4 h-4 text-blue-600" />
        <span className="text-sm font-bold text-slate-900">Select what to plan</span>
        <span className="text-xs text-slate-500">
          {ticketsIn}/{tickets.length} tickets · {techsIn}/{techs.length} technicians{city !== 'ALL' ? ` · ${city}` : ''}
        </span>
        {stale && <span className="ml-auto text-[11px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-700">Selection changed — optimise again</span>}
      </button>
      {open && (
        <div className="grid grid-cols-1 lg:grid-cols-2 border-t border-slate-100">
          <SelectList
            title="Tickets"
            hint="Untick to ignore a ticket for routing (same as Ignore in Active Cases)"
            items={tickets.map(t => ({
              id: t.id, checked: !t.ignoreForRouting,
              primary: t.ticketId, badge: t.priority, badgeClass: PRIORITY_STYLE[t.priority] ?? PRIORITY_STYLE.LOW,
              secondary: `${t.centerName}${t.assignedTechnicianName ? ` · → ${t.assignedTechnicianName}` : ''}`,
              note: t.status !== 'Open' && t.status !== 'Assigned' ? t.status : undefined,
            }))}
            onToggle={(id, on) => setTicketIncluded([id], on)}
            onAll={on => setTicketIncluded(tickets.map(t => t.id), on)}
          />
          <SelectList
            title="Technicians"
            hint="Untick to leave a technician out of routing (same as the Technicians page toggle)"
            items={techs.map(t => {
              const isAbsent = absent.has(t.employeeId.toUpperCase());
              return {
                id: t.id, checked: !t.excludeFromRouting,
                primary: t.name, secondary: `${t.employeeId} · ${t.zone || t.city}`,
                note: isAbsent ? 'Absent today' : undefined,
                disabledReason: isAbsent ? 'Marked absent today — change attendance to include' : undefined,
              };
            })}
            onToggle={(id, on) => setTechIncluded([id], on)}
            onAll={on => setTechIncluded(techs.map(t => t.id), on)}
          />
        </div>
      )}
    </div>
  );
}

// ── Checkbox list used by "Select what to plan" ──────────────────
interface SelectItem {
  id: string; checked: boolean; primary: string; secondary: string;
  badge?: string; badgeClass?: string; note?: string; disabledReason?: string;
}
function SelectList({ title, hint, items, onToggle, onAll }: {
  title: string; hint: string; items: SelectItem[];
  onToggle: (id: string, on: boolean) => void; onAll: (on: boolean) => void;
}) {
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(100);
  const matches = items.filter(i => !q || `${i.primary} ${i.secondary}`.toLowerCase().includes(q.toLowerCase()));
  const shown = matches.slice(0, limit); // drawing thousands of rows at once froze the page
  const on = items.filter(i => i.checked).length;
  return (
    <div className="p-4 lg:first:border-r border-slate-100 min-w-0">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-bold text-slate-800">{title}</span>
        <span className="text-[11px] text-slate-500">{on} of {items.length} included</span>
        <div className="ml-auto flex gap-1">
          <button onClick={() => onAll(true)} className="text-[11px] font-semibold text-blue-600 hover:underline px-1">All</button>
          <button onClick={() => onAll(false)} className="text-[11px] font-semibold text-slate-500 hover:underline px-1">None</button>
        </div>
      </div>
      <p className="text-[10px] text-slate-400 mb-2">{hint}</p>
      {items.length > 6 && (
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${title.toLowerCase()}…`}
          className="w-full mb-2 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
      )}
      <ul className="max-h-64 overflow-y-auto divide-y divide-slate-50 border border-slate-100 rounded-lg">
        {shown.map(i => (
          <li key={i.id}>
            <label className={`flex items-center gap-2.5 px-3 py-2 text-xs cursor-pointer hover:bg-slate-50 ${i.checked ? '' : 'opacity-55'}`} title={i.disabledReason}>
              <input type="checkbox" checked={i.checked} onChange={e => onToggle(i.id, e.target.checked)}
                className="w-3.5 h-3.5 accent-blue-600 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className={`font-semibold ${i.checked ? 'text-slate-900' : 'text-slate-500 line-through'}`}>{i.primary}</span>
                  {i.badge && <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${i.badgeClass}`}>{i.badge}</span>}
                  {i.note && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-700">{i.note}</span>}
                </span>
                <span className="block text-slate-500 truncate">{i.secondary}</span>
              </span>
            </label>
          </li>
        ))}
        {matches.length > shown.length && (
          <li className="px-3 py-2 text-center">
            <button onClick={() => setLimit(l => l + 200)} className="text-[11px] font-semibold text-blue-600 hover:underline">
              Showing {shown.length} of {matches.length} — show more (or search)
            </button>
          </li>
        )}
        {!shown.length && <li className="px-3 py-4 text-center text-[11px] text-slate-400">{items.length ? 'No matches' : `No ${title.toLowerCase()} in this city`}</li>}
      </ul>
    </div>
  );
}
