/**
 * City Routes — route optimisation and roster, one city at a time.
 *
 * Each city is planned with only its own technicians and the tickets at its
 * own centers (city matching in lib/city.ts), so a Delhi technician is never
 * sent to Gurugram just to balance numbers. A plan is a draft until
 * "Save & assign", which writes the assignments onto the tickets — so every
 * other tab shows the same thing.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Building2, Download, MapPin, Play, Save, Users, X, AlertTriangle, ChevronDown, ChevronRight, SlidersHorizontal } from 'lucide-react';
import {
  getCenters, getTechnicians, getTickets, getAttendance, getRoutePlans, saveRoutePlans, saveTickets,
  saveTechnicians, setTicketsIgnored, subscribeToDataChanges,
} from '../../services/storage';
import { planBalancedRoutes, normaliseCityToPreset, CITY_PRESETS } from '../../services/routeOptimizer';
import type { Ticket, TechnicianRoutePlan, Technician } from '../../types';
import { localDate } from '../../lib/date';

const COLORS = ['#2563EB', '#DC2626', '#059669', '#D97706', '#7C3AED', '#DB2777', '#0891B2', '#65A30D', '#EA580C', '#4F46E5', '#0D9488', '#B91C1C'];
const PRIORITY_STYLE: Record<string, string> = {
  CRITICAL: 'bg-rose-100 text-rose-700', HIGH: 'bg-orange-100 text-orange-700',
  MEDIUM: 'bg-amber-100 text-amber-700', LOW: 'bg-slate-100 text-slate-600',
};
/** City = the app's operating region (Delhi NCR, Mumbai, Bangalore, …) — same rule the optimizer uses. */
const cityKey = (name?: string | null) => normaliseCityToPreset(name || '');
const isOpen = (t: Ticket) => t.status !== 'Resolved' && t.status !== 'Closed';
const isDone = (s?: string) => s === 'Resolved' || s === 'Closed';

interface Params { maxStops: number; maxKm: number; shiftStart: number; shiftEnd: number }
const DEFAULT_PARAMS: Params = { maxStops: 8, maxKm: 60, shiftStart: 9, shiftEnd: 18 };
/** Start each city from its tuned preset (CITY_PRESETS), if it has one */
const presetParams = (city: string): Params => {
  const p = CITY_PRESETS[city];
  return p ? { maxStops: p.maxStopsPerTech, maxKm: p.maxKmPerTech, shiftStart: p.shiftStartHour, shiftEnd: p.shiftEndHour } : DEFAULT_PARAMS;
};
interface Draft { plans: TechnicianRoutePlan[]; unrouted: Ticket[]; createdAt: string; selectionSig: string }

export function CityRoutesPage() {
  const [, setTick] = useState(0);
  useEffect(() => subscribeToDataChanges(() => setTick(n => n + 1)), []);

  // ── live data, grouped by city ─────────────────────────────────
  const centers = getCenters();
  const tickets = getTickets();
  const techs = getTechnicians();
  const attendance = getAttendance();
  const today = localDate();
  const centerCity = useMemo(() => new Map(centers.map(c => [c.name.trim().toLowerCase(), cityKey(c.city)])), [centers]);
  const ticketCity = (t: Ticket) => centerCity.get(t.centerName.trim().toLowerCase()) ?? null;
  const absentToday = new Set(attendance
    .filter(a => a.date === today && a.status !== 'Present' && a.status !== 'Half-Day')
    .map(a => a.employeeId.toUpperCase()));
  const routableTech = (t: Technician) => t.status === 'Active' && !t.excludeFromRouting && t.startingLatitude != null && t.startingLongitude != null;

  const cities = useMemo(() => {
    const stats = new Map<string, { tickets: number; ignored: number; techs: number; present: number; assigned: number }>();
    const get = (c: string) => {
      if (!stats.has(c)) stats.set(c, { tickets: 0, ignored: 0, techs: 0, present: 0, assigned: 0 });
      return stats.get(c)!;
    };
    tickets.filter(isOpen).forEach(t => {
      const c = ticketCity(t); if (!c) return;
      const s = get(c);
      if (t.ignoreForRouting) { s.ignored++; return; }
      s.tickets++;
      if (t.assignedTechnicianId) s.assigned++;
    });
    techs.filter(routableTech).forEach(t => {
      const s = get(cityKey(t.city));
      s.techs++;
      if (!absentToday.has(t.employeeId.toUpperCase())) s.present++;
    });
    return [...stats.entries()]
      .filter(([, s]) => s.tickets > 0 || s.techs > 0)
      .sort((a, b) => b[1].tickets - a[1].tickets || a[0].localeCompare(b[0]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets, techs, attendance, centerCity]);

  const [city, setCity] = useState<string>('');
  useEffect(() => { if (!city && cities.length) setCity(cities[0][0]); }, [city, cities]);
  const [paramsByCity, setParamsByCity] = useState<Record<string, Params>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3000); };

  const params = paramsByCity[city] ?? presetParams(city);
  const setParam = (k: keyof Params, v: number) => setParamsByCity(p => ({ ...p, [city]: { ...params, [k]: v } }));
  const stats = cities.find(([c]) => c === city)?.[1];
  const cityTechIds = new Set(techs.filter(t => cityKey(t.city) === city).map(t => t.id));
  const draft = drafts[city];

  // ── Plan selection: which tickets and technicians take part (shared Ignore / Exclude flags) ──
  const selTickets = tickets.filter(t => isOpen(t) && ticketCity(t) === city)
    .sort((a, b) => a.ticketId.localeCompare(b.ticketId)); // fixed order: rows never jump when ticked
  const selTechs = techs.filter(t => t.status === 'Active' && t.startingLatitude != null && t.startingLongitude != null && cityKey(t.city) === city)
    .sort((a, b) => a.name.localeCompare(b.name));
  const includedTickets = selTickets.filter(t => !t.ignoreForRouting);
  const includedTechs = selTechs.filter(t => !t.excludeFromRouting && !absentToday.has(t.employeeId.toUpperCase()));
  const selectionSig = includedTickets.map(t => t.id).join(',') + '|' + includedTechs.map(t => t.id).join(',');
  const [selOpen, setSelOpen] = useState(true);

  const setTicketIncluded = (ids: string[], include: boolean) => setTicketsIgnored(ids, !include);
  const setTechIncluded = (ids: string[], include: boolean) => {
    const set = new Set(ids);
    const now = new Date().toISOString();
    saveTechnicians(getTechnicians().map(t => (set.has(t.id) && Boolean(t.excludeFromRouting) === include ? { ...t, excludeFromRouting: !include, updatedAt: now } : t)));
  };

  // Current state = saved/assigned routes of this city's technicians (live from tickets)
  const currentPlans = getRoutePlans().filter(p => cityTechIds.has(p.technicianId));
  const plans = draft ? draft.plans : currentPlans;
  const cityOpenTickets = tickets.filter(t => isOpen(t) && !t.ignoreForRouting && ticketCity(t) === city);
  const inPlans = new Set(plans.flatMap(p => p.stops.map(s => s.ticketId)));
  const notPlanned = draft
    ? draft.unrouted
    : cityOpenTickets.filter(t => !inPlans.has(t.ticketId));
  const assignedElsewhere = cityOpenTickets.filter(t => t.assignedTechnicianId && !cityTechIds.has(t.assignedTechnicianId));

  // ── actions ────────────────────────────────────────────────────
  const optimise = () => {
    const r = planBalancedRoutes({
      cityFilter: city, maxStopsPerTech: params.maxStops, maxKmPerTech: params.maxKm,
      priorityFilter: 'all', skillMatch: false, shiftStartHour: params.shiftStart, shiftEndHour: params.shiftEnd,
    });
    const used = r.plans.filter(p => p.stops.length > 0);
    setDrafts(d => ({ ...d, [city]: { plans: used, unrouted: r.unrouted, createdAt: new Date().toISOString(), selectionSig } }));
    showToast(`${city}: ${used.reduce((a, p) => a + p.stops.length, 0)} tickets planned across ${used.length} technicians — review, then Save & assign`);
  };

  const saveAndAssign = () => {
    if (!draft) return;
    const draftTicketIds = new Set(draft.plans.flatMap(p => p.stops.map(s => s.ticketId)));
    // keep every other city's routes untouched; replace this city's
    const others = getRoutePlans()
      .filter(p => !cityTechIds.has(p.technicianId))
      .map(p => ({ ...p, stops: p.stops.filter(s => !draftTicketIds.has(s.ticketId)) }));
    saveRoutePlans([...others, ...draft.plans]);
    // tickets of this city that the new plan couldn't fit come off this city's technicians
    const unroutedIds = new Set(draft.unrouted.map(t => t.ticketId));
    const now = new Date().toISOString();
    let changed = false;
    const next = getTickets().map(t => {
      if (unroutedIds.has(t.ticketId) && t.assignedTechnicianId && cityTechIds.has(t.assignedTechnicianId) && isOpen(t)) {
        changed = true;
        return { ...t, assignedTechnicianId: undefined, assignedTechnicianName: undefined, status: t.status === 'Assigned' ? 'Open' as const : t.status, updatedAt: now };
      }
      return t;
    });
    if (changed) saveTickets(next);
    setDrafts(d => { const n = { ...d }; delete n[city]; return n; });
    showToast(`${city}: plan saved — ${draftTicketIds.size} tickets assigned (visible on every tab)`);
  };

  const exportRoster = () => {
    const rows = [['City', 'Technician', 'Employee ID', 'Stop', 'Ticket', 'Vehicle', 'Center', 'Priority', 'Status', 'ETA', 'Route km']];
    plans.forEach(p => p.stops.forEach(s => rows.push([city, p.technicianName, p.employeeId, String(s.stopOrder), s.ticketId,
      s.vehicleNumber, s.centerName, s.priority, s.ticketStatus ?? (draft ? 'Draft' : ''), s.estimatedArrival, String(p.totalDistanceKm)])));
    const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `roster_${city.toLowerCase()}_${today}.csv`;
    a.click();
  };

  const totalKm = Math.round(plans.reduce((a, p) => a + p.totalDistanceKm, 0) * 10) / 10;
  const stopCount = plans.reduce((a, p) => a + p.stops.length, 0);
  const colorOf = (techId: string) => COLORS[Math.max(0, [...cityTechIds].sort().indexOf(techId)) % COLORS.length];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">CITY ROUTES</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Each city is optimised with its own technicians and its own tickets. Plans stay drafts until you save them.
          </p>
        </div>
      </div>

      {/* City tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {cities.map(([c, s]) => {
          const active = c === city;
          const noTech = s.tickets > 0 && s.present === 0;
          return (
            <button key={c} onClick={() => setCity(c)}
              className={`shrink-0 text-left px-4 py-2.5 rounded-xl border transition-colors ${active ? 'bg-blue-600 border-blue-600 text-white shadow-xs' : 'bg-white border-slate-200 text-slate-700 hover:border-blue-300'}`}>
              <div className="flex items-center gap-1.5 text-sm font-bold">
                {c}
                {drafts[c] && <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${active ? 'bg-white/25' : 'bg-amber-100 text-amber-700'}`}>DRAFT</span>}
                {noTech && <AlertTriangle className={`w-3.5 h-3.5 ${active ? 'text-amber-200' : 'text-amber-500'}`} />}
              </div>
              <div className={`text-[11px] mt-0.5 ${active ? 'text-blue-100' : 'text-slate-500'}`}>
                {s.tickets} ticket{s.tickets !== 1 ? 's' : ''} · {s.present}/{s.techs} tech{s.techs !== 1 ? 's' : ''}
              </div>
            </button>
          );
        })}
        {!cities.length && <div className="text-sm text-slate-500 py-3">No open tickets or technicians yet.</div>}
      </div>

      {city && stats && (
        <>
          {/* Controls */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-end gap-3">
            {([
              ['maxStops', 'Max stops / tech', 1, 20],
              ['maxKm', 'Max km / tech', 5, 300],
              ['shiftStart', 'Shift start (h)', 0, 23],
              ['shiftEnd', 'Shift end (h)', 1, 24],
            ] as const).map(([k, label, min, max]) => (
              <label key={k} className="text-[11px] font-semibold text-slate-500">
                {label}
                <input type="number" min={min} max={max} value={params[k]}
                  onChange={e => setParam(k, Math.max(min, Math.min(max, Number(e.target.value) || min)))}
                  className="mt-1 block w-24 px-2 py-1.5 border border-slate-300 rounded-lg text-sm text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
            ))}
            <div className="flex flex-wrap gap-2 ml-auto">
              <button onClick={optimise} disabled={stats.present === 0 || stats.tickets === 0}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-bold flex items-center gap-1.5">
                <Play className="w-3.5 h-3.5" /> Optimise {city}
              </button>
              {draft && (
                <>
                  <button onClick={saveAndAssign} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5">
                    <Save className="w-3.5 h-3.5" /> Save & assign
                  </button>
                  <button onClick={() => setDrafts(d => { const n = { ...d }; delete n[city]; return n; })}
                    className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-semibold flex items-center gap-1.5">
                    <X className="w-3.5 h-3.5" /> Discard draft
                  </button>
                </>
              )}
              <button onClick={exportRoster} disabled={!stopCount}
                className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40 text-xs font-semibold flex items-center gap-1.5">
                <Download className="w-3.5 h-3.5" /> Roster CSV
              </button>
            </div>
          </div>

          {/* Plan selection */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <button onClick={() => setSelOpen(o => !o)} className="w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-slate-50">
              {selOpen ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
              <SlidersHorizontal className="w-4 h-4 text-blue-600" />
              <span className="text-sm font-bold text-slate-900">Select what to plan</span>
              <span className="text-xs text-slate-500">
                {includedTickets.length}/{selTickets.length} tickets · {includedTechs.length}/{selTechs.length} technicians
              </span>
              {draft && draft.selectionSig !== selectionSig && (
                <span className="ml-auto text-[11px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-700">Selection changed — optimise again</span>
              )}
            </button>
            {selOpen && (
              <div className="grid grid-cols-1 lg:grid-cols-2 border-t border-slate-100">
                <SelectList
                  title="Tickets"
                  hint="Untick to ignore a ticket for routing (same as Ignore in Active Cases)"
                  items={selTickets.map(t => ({
                    id: t.id, checked: !t.ignoreForRouting,
                    primary: t.ticketId, badge: t.priority, badgeClass: PRIORITY_STYLE[t.priority] ?? PRIORITY_STYLE.LOW,
                    secondary: `${t.centerName}${t.assignedTechnicianName ? ` · → ${t.assignedTechnicianName}` : ''}`,
                    note: t.status !== 'Open' && t.status !== 'Assigned' ? t.status : undefined,
                  }))}
                  onToggle={(id, on) => setTicketIncluded([id], on)}
                  onAll={on => setTicketIncluded(selTickets.map(t => t.id), on)}
                />
                <SelectList
                  title="Technicians"
                  hint="Untick to leave a technician out of routing (same as the Technicians page toggle)"
                  items={selTechs.map(t => {
                    const absent = absentToday.has(t.employeeId.toUpperCase());
                    return {
                      id: t.id, checked: !t.excludeFromRouting,
                      primary: t.name, secondary: `${t.employeeId} · ${t.zone || t.city}`,
                      note: absent ? 'Absent today' : undefined, disabledReason: absent ? 'Marked absent today — change attendance to include' : undefined,
                    };
                  })}
                  onToggle={(id, on) => setTechIncluded([id], on)}
                  onAll={on => setTechIncluded(selTechs.map(t => t.id), on)}
                />
              </div>
            )}
          </div>

          {/* Notices */}
          {stats.tickets > 0 && stats.present === 0 && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
              No technicians {stats.techs ? 'available today' : 'based'} in <b>{city}</b>. Its {stats.tickets} ticket{stats.tickets > 1 ? 's' : ''} can't be optimised here —
              add a technician with city “{city}”, or assign them manually from Tickets or Active Cases.
            </div>
          )}
          {assignedElsewhere.length > 0 && (
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
              {assignedElsewhere.length} {city} ticket{assignedElsewhere.length > 1 ? 's are' : ' is'} assigned to technicians from other cities
              ({[...new Set(assignedElsewhere.map(t => t.assignedTechnicianName))].join(', ')}). Optimising {city} will reassign {assignedElsewhere.length > 1 ? 'them' : 'it'} to {city} technicians.
            </div>
          )}

          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              ['Showing', draft ? 'Draft (not saved)' : 'Current assignments', draft ? 'text-amber-600' : 'text-emerald-600'],
              ['Tickets planned', `${stopCount} / ${stats.tickets}`, 'text-slate-900'],
              ['Not planned', String(notPlanned.length), notPlanned.length ? 'text-rose-600' : 'text-slate-900'],
              ['Technicians used', `${plans.length} / ${stats.present}`, 'text-slate-900'],
              ['Total route km', String(totalKm), 'text-slate-900'],
            ].map(([label, value, cls]) => (
              <div key={label} className="bg-white rounded-xl border border-slate-200 px-4 py-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
                <div className={`text-base font-bold mt-0.5 ${cls}`}>{value}</div>
              </div>
            ))}
          </div>

          {/* Roster + map */}
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-4">
            <div className="space-y-3">
              {plans.length === 0 && (
                <div className="bg-white rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                  Nothing assigned in {city} yet. Click <b>Optimise {city}</b> to build routes.
                </div>
              )}
              {plans.map(p => {
                const color = colorOf(p.technicianId);
                const done = p.stops.filter(s => isDone(s.ticketStatus)).length;
                const overKm = p.totalDistanceKm > params.maxKm;
                return (
                  <div key={p.technicianId} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-3 flex items-center gap-3 border-b border-slate-100" style={{ borderLeft: `4px solid ${color}` }}>
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ background: color }}>
                        {p.technicianName.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-slate-900">{p.technicianName}</div>
                        <div className="text-[11px] text-slate-500">{p.employeeId}</div>
                      </div>
                      <div className="text-right text-[11px] font-mono text-slate-600">
                        <div className="font-bold text-slate-900">{p.stops.length} stop{p.stops.length !== 1 ? 's' : ''}{done ? ` · ${done} done` : ''}</div>
                        <div className={overKm ? 'text-rose-600 font-bold' : ''}>{p.totalDistanceKm} km · ~{Math.round(p.totalEstimatedMins / 6) / 10} h</div>
                      </div>
                    </div>
                    <ol className="divide-y divide-slate-50">
                      {p.stops.map(s => (
                        <li key={s.ticketId} className={`px-4 py-2 flex items-start gap-3 text-xs ${isDone(s.ticketStatus) ? 'opacity-60' : ''}`}>
                          <span className="mt-0.5 w-5 h-5 rounded-full text-[10px] font-bold text-white flex items-center justify-center shrink-0" style={{ background: color }}>{s.stopOrder}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-mono font-bold text-blue-600">{s.ticketId}</span>
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${PRIORITY_STYLE[s.priority] ?? PRIORITY_STYLE.LOW}`}>{s.priority}</span>
                              {s.ticketStatus && s.ticketStatus !== 'Open' && s.ticketStatus !== 'Assigned' && (
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${isDone(s.ticketStatus) ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                  {isDone(s.ticketStatus) ? '✓ ' : ''}{s.ticketStatus}
                                </span>
                              )}
                            </div>
                            <div className="text-slate-600 truncate"><MapPin className="inline w-3 h-3 -mt-0.5" /> {s.centerName} · {s.vehicleNumber}</div>
                            <div className="text-slate-400 truncate">{s.issue}</div>
                          </div>
                          <span className="font-mono text-slate-500 shrink-0">{s.estimatedArrival}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                );
              })}

              {notPlanned.length > 0 && (
                <div className="bg-white rounded-xl border border-rose-200 overflow-hidden">
                  <div className="px-4 py-2.5 bg-rose-50 text-xs font-bold text-rose-700">
                    Not planned ({notPlanned.length}) — {draft ? 'over the stop/km limits for the available technicians' : 'not on any technician\'s route yet'}
                  </div>
                  <ul className="divide-y divide-slate-50">
                    {notPlanned.map(t => (
                      <li key={t.ticketId} className="px-4 py-2 text-xs flex items-center gap-2">
                        <span className="font-mono font-bold text-slate-700">{t.ticketId}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${PRIORITY_STYLE[t.priority] ?? PRIORITY_STYLE.LOW}`}>{t.priority}</span>
                        <span className="text-slate-500 truncate">{t.centerName}</span>
                        {t.assignedTechnicianName && <span className="ml-auto text-slate-400 shrink-0">→ {t.assignedTechnicianName}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <CityMap city={city} plans={plans} colorOf={colorOf}
              techs={techs.filter(t => cityTechIds.has(t.id) && routableTech(t))}
              centers={centers.filter(c => cityKey(c.city) === city)} />
          </div>
        </>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-xs font-semibold px-4 py-2.5 rounded-lg shadow-lg">{toast}</div>
      )}
    </div>
  );
}

// ── Map of one city's routes ─────────────────────────────────────
function CityMap({ city, plans, techs, centers, colorOf }: {
  city: string;
  plans: TechnicianRoutePlan[];
  techs: Technician[];
  centers: Array<{ name: string; latitude: number; longitude: number }>;
  colorOf: (techId: string) => string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!el.current || mapRef.current) return;
    const map = L.map(el.current, { zoomControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 18 }).addTo(map);
    map.setView([28.61, 77.21], 10);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el.current);
    return () => { ro.disconnect(); map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current, layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const bounds: L.LatLngExpression[] = [];     // routes + bases (what matters)
    const allBounds: L.LatLngExpression[] = [];  // every center (fallback for an empty city)
    centers.forEach(c => {
      if (!Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) return;
      L.circleMarker([c.latitude, c.longitude], { radius: 3, color: '#94A3B8', weight: 1, fillOpacity: 0.6 })
        .bindTooltip(c.name).addTo(layer);
      allBounds.push([c.latitude, c.longitude]);
    });
    techs.forEach(t => {
      const color = colorOf(t.id);
      const ll: L.LatLngExpression = [t.startingLatitude!, t.startingLongitude!];
      L.marker(ll, { icon: L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13],
        html: `<div style="width:26px;height:26px;border-radius:50%;background:${color};color:#fff;font:700 10px sans-serif;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3)">${t.name.slice(0, 2).toUpperCase()}</div>` }) })
        .bindTooltip(`${t.name} — base`).addTo(layer);
      bounds.push(ll);
    });
    plans.forEach(p => {
      const color = colorOf(p.technicianId);
      const path: L.LatLngExpression[] = [[p.startLat, p.startLng], ...p.stops.map(s => [s.latitude, s.longitude] as L.LatLngExpression)];
      L.polyline(path, { color, weight: 3, opacity: 0.8 }).addTo(layer);
      p.stops.forEach(s => {
        const done = s.ticketStatus === 'Resolved' || s.ticketStatus === 'Closed';
        L.marker([s.latitude, s.longitude], { icon: L.divIcon({ className: '', iconSize: [20, 20], iconAnchor: [10, 10],
          html: `<div style="width:20px;height:20px;border-radius:50%;background:${done ? '#10B981' : '#fff'};color:${done ? '#fff' : color};border:2px solid ${color};font:700 10px sans-serif;display:flex;align-items:center;justify-content:center">${done ? '✓' : s.stopOrder}</div>` }) })
          .bindTooltip(`${p.technicianName} · stop ${s.stopOrder}<br>${s.ticketId} — ${s.centerName}`).addTo(layer);
        bounds.push([s.latitude, s.longitude]);
      });
    });
    const fit = plans.length ? bounds : [...bounds, ...allBounds];
    if (fit.length > 1) map.fitBounds(L.latLngBounds(fit), { padding: [30, 30], maxZoom: 13 });
    else if (fit.length === 1) map.setView(fit[0], 12);
  }, [city, plans, techs, centers, colorOf]);

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden xl:sticky xl:top-0 self-start">
      <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2 text-xs font-bold text-slate-700">
        <Building2 className="w-3.5 h-3.5 text-slate-400" /> {city} map
        <span className="ml-auto flex items-center gap-1 font-normal text-slate-400"><Users className="w-3 h-3" /> bases · numbered stops · ✓ resolved</span>
      </div>
      <div ref={el} style={{ height: 'min(70vh, 620px)' }} />
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
  const shown = items.filter(i => !q || `${i.primary} ${i.secondary}`.toLowerCase().includes(q.toLowerCase()));
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
        {!shown.length && <li className="px-3 py-4 text-center text-[11px] text-slate-400">{items.length ? 'No matches' : `No ${title.toLowerCase()} in this city`}</li>}
      </ul>
    </div>
  );
}
