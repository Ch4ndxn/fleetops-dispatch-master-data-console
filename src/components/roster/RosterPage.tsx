/**
 * RosterPage — Daily Planned Visit Sheet
 *
 * 1. Runs route optimisation for the selected date
 * 2. Shows each technician's ordered stop list (ticket → center → ETA → priority)
 * 3. Manual reassign: move any ticket to a different technician
 * 4. Download PDF: print-ready job cards per technician
 * 5. Download CSV: full day roster as spreadsheet
 */

import React, { useState, useMemo, useCallback } from 'react';
import { getTechnicians, getTickets, saveTickets, getRoutePlans } from '../../services/storage';
import { planBalancedRoutes, calculateDistanceKm } from '../../services/routeOptimizer';
import { Technician, TechnicianRoutePlan, RouteStop, TicketPriority } from '../../types';
import {
  CalendarDays,
  Download,
  FileText,
  RefreshCw,
  MapPin,
  Clock,
  ArrowRight,
  User,
  Truck,
  Route,
  Info,
} from 'lucide-react';
import { localDate } from '../../lib/date';

// ── Priority meta ─────────────────────────────────────────────────
const PRI: Record<TicketPriority, { dot: string; badge: string; label: string }> = {
  CRITICAL: { dot: 'bg-red-500',    badge: 'bg-red-100 text-red-700',       label: 'CRITICAL' },
  HIGH:     { dot: 'bg-orange-500', badge: 'bg-orange-100 text-orange-700', label: 'HIGH'     },
  MEDIUM:   { dot: 'bg-yellow-400', badge: 'bg-yellow-50 text-yellow-700',  label: 'MED'      },
  LOW:      { dot: 'bg-slate-300',  badge: 'bg-slate-100 text-slate-500',   label: 'LOW'      },
};

// ── Helpers ───────────────────────────────────────────────────────
function toIso(d: Date) { return localDate(d); }

function recalcEtas(stops: RouteStop[], startLat: number, startLng: number): RouteStop[] {
  let elapsed = 30;
  let prevLat = startLat, prevLng = startLng;
  return stops.map((s, i) => {
    const transit = Math.round(calculateDistanceKm(prevLat, prevLng, s.latitude, s.longitude) * 2.5);
    elapsed += transit;
    const h = Math.floor(9 + elapsed / 60);
    const m = elapsed % 60;
    prevLat = s.latitude; prevLng = s.longitude;
    elapsed += s.estimatedDurationMins;
    return { ...s, stopOrder: i + 1, estimatedArrival: `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}` };
  });
}

// ── Extended plan ─────────────────────────────────────────────────
type MutablePlan = TechnicianRoutePlan & { tech: Technician };

function buildPlans(date?: string): MutablePlan[] {
  const techs = getTechnicians();
  const techMap = new Map(techs.map(t => [t.id, t]));
  const today = date ?? localDate();

  // 1. Check for a saved Smart Route plan for this date (from SmartRoutePlannerPage.handleSave)
  let base: TechnicianRoutePlan[] = [];
  try {
    const saved = localStorage.getItem(`fo_route_plan_${today}`);
    if (saved) {
      const parsed: TechnicianRoutePlan[] = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) base = parsed;
    }
  } catch {}

  // 2. Also check storage-layer saved plans (saveRoutePlans writes here too)
  if (base.length === 0) {
    const storedPlans = getRoutePlans();
    if (storedPlans && storedPlans.length > 0) base = storedPlans;
  }

  // 3. Fall back to fresh balanced calculation
  if (base.length === 0) {
    const result = planBalancedRoutes({
      maxStopsPerTech: 8,
      maxKmPerTech: 80,
      priorityFilter: 'all',
      skillMatch: false,
      shiftStartHour: 9,
      shiftEndHour: 18,
    });
    base = result.plans;
  }

  const extended: MutablePlan[] = base
    .filter(p => techMap.has(p.technicianId))
    .map(p => ({ ...p, tech: techMap.get(p.technicianId)! }));

  // Add active techs with no tickets as empty rows
  techs
    .filter(t => t.status === 'Active' && !extended.find(p => p.technicianId === t.id) && t.startingLatitude && t.startingLongitude)
    .forEach(t => extended.push({
      technicianId: t.id, technicianName: t.name, employeeId: t.employeeId,
      startLat: t.startingLatitude!, startLng: t.startingLongitude!, defaultDc: t.defaultDc ?? '',
      stops: [], totalDistanceKm: 0, totalEstimatedMins: 0, status: 'Draft', tech: t,
    }));
  return extended;
}

// ── Component ─────────────────────────────────────────────────────
function getPlanSource(date: string): 'saved' | 'storage' | 'fresh' {
  try {
    const saved = localStorage.getItem(`fo_route_plan_${date}`);
    if (saved) { const p = JSON.parse(saved); if (Array.isArray(p) && p.length > 0) return 'saved'; }
  } catch {}
  const storedPlans = getRoutePlans();
  if (storedPlans && storedPlans.length > 0) return 'storage';
  return 'fresh';
}

export function RosterPage() {
  const today = toIso(new Date());
  const [selectedDate, setSelectedDate] = useState(today);
  const [plans, setPlans] = useState<MutablePlan[]>(() => buildPlans(today));
  const [planSource, setPlanSource] = useState<'saved' | 'storage' | 'fresh'>(() => getPlanSource(today));
  const [reassignFrom, setReassignFrom] = useState<{ planIdx: number; stopIdx: number } | null>(null);
  const [filterCity, setFilterCity] = useState('All');
  const [spinning, setSpinning] = useState(false);

  // Reload when date changes
  const loadForDate = useCallback((date: string) => {
    setSelectedDate(date);
    setSpinning(true);
    setTimeout(() => {
      setPlans(buildPlans(date));
      setPlanSource(getPlanSource(date));
      setReassignFrom(null);
      setSpinning(false);
    }, 200);
  }, []);

  const regenerate = useCallback(() => {
    setSpinning(true);
    // Clear saved plan so we get a fresh calculation
    try { localStorage.removeItem(`fo_route_plan_${selectedDate}`); } catch {}
    setTimeout(() => {
      setPlans(buildPlans(selectedDate));
      setPlanSource('fresh');
      setReassignFrom(null);
      setSpinning(false);
    }, 350);
  }, [selectedDate]);

  // Reassign stop from one plan to another
  const handleReassign = (fromIdx: number, stopIdx: number, toIdx: number) => {
    setPlans(prev => {
      const next = prev.map(p => ({ ...p, stops: [...p.stops] }));
      const [stop] = next[fromIdx].stops.splice(stopIdx, 1);
      next[toIdx].stops.push(stop);
      next[fromIdx].stops = recalcEtas(next[fromIdx].stops, next[fromIdx].startLat, next[fromIdx].startLng);
      next[toIdx].stops   = recalcEtas(next[toIdx].stops,   next[toIdx].startLat,   next[toIdx].startLng);
      // Recalc totals
      [fromIdx, toIdx].forEach(i => {
        let dist = 0, mins = 0, prevLat = next[i].startLat, prevLng = next[i].startLng;
        next[i].stops.forEach(s => {
          const d = calculateDistanceKm(prevLat, prevLng, s.latitude, s.longitude);
          dist += d; mins += Math.round(d * 2.5) + s.estimatedDurationMins;
          prevLat = s.latitude; prevLng = s.longitude;
        });
        next[i].totalDistanceKm = Math.round(dist * 10) / 10;
        next[i].totalEstimatedMins = mins;
      });
      // Persist assignment change
      const tickets = getTickets();
      const toTech = next[toIdx].tech;
      const tk = tickets.find(t => t.ticketId === stop.ticketId);
      if (tk) {
        tk.assignedTechnicianId = toTech.id;
        tk.assignedTechnicianName = toTech.name;
        tk.status = 'Assigned';
        tk.updatedAt = new Date().toISOString();
        saveTickets(tickets);
      }
      return next;
    });
    setReassignFrom(null);
  };

  const cities = useMemo(() => ['All', ...Array.from(new Set(plans.map(p => p.tech.city || ''))).filter(Boolean).sort()], [plans]);
  const visible = plans.filter(p => filterCity === 'All' || p.tech.city === filterCity);
  const totalTickets = plans.reduce((s, p) => s + p.stops.length, 0);
  const totalTechs   = plans.filter(p => p.stops.length > 0).length;
  const isToday      = selectedDate === toIso(new Date());

  // ── Downloads ──
  const downloadPDF = () => {
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(buildPrintHtml(visible, selectedDate));
    win.document.close();
    setTimeout(() => { win.focus(); win.print(); }, 400);
  };

  const downloadCSV = () => {
    const rows: string[][] = [['Technician','Employee ID','City','Stop #','Ticket ID','Vehicle','Center','Issue','Priority','ETA','Duration (mins)']];
    visible.forEach(p => {
      if (!p.stops.length) { rows.push([p.technicianName, p.employeeId, p.tech.city,'—','—','—','—','—','—','—','—']); return; }
      p.stops.forEach(s => rows.push([p.technicianName, p.employeeId, p.tech.city, String(s.stopOrder), s.ticketId, s.vehicleNumber, s.centerName, s.issue, s.priority, s.estimatedArrival, String(s.estimatedDurationMins)]));
    });
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `roster_${selectedDate}.csv`; a.click();
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Route className="w-5 h-5 text-blue-600" />
            Daily Roster
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Route-optimised visit plan · click Reassign to move a ticket between technicians
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5">
            <CalendarDays className="w-3.5 h-3.5 text-slate-400" />
            <input
              type="date" value={selectedDate}
              onChange={e => loadForDate(e.target.value)}
              className="text-xs font-semibold text-slate-700 bg-transparent focus:outline-none"
            />
          </div>
          {/* Plan source badge */}
          <span className={`text-[10px] font-semibold px-2 py-1 rounded-lg border ${
            planSource === 'saved'
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : planSource === 'storage'
              ? 'bg-blue-50 text-blue-700 border-blue-200'
              : 'bg-slate-100 text-slate-500 border-slate-200'
          }`}>
            {planSource === 'saved' ? '✓ From Smart Route Plan' : planSource === 'storage' ? '✓ From Saved Plan' : '↻ Auto-calculated'}
          </span>

          <select value={filterCity} onChange={e => setFilterCity(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none">
            {cities.map(c => <option key={c}>{c}</option>)}
          </select>

          <button onClick={regenerate} disabled={spinning}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold">
            <RefreshCw className={`w-3.5 h-3.5 ${spinning ? 'animate-spin' : ''}`} />
            Regenerate
          </button>

          <button onClick={downloadCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-semibold border border-emerald-200">
            <FileText className="w-3.5 h-3.5" /> CSV
          </button>

          <button onClick={downloadPDF}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-sm">
            <Download className="w-3.5 h-3.5" /> Download PDF
          </button>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Techs Deployed',   value: totalTechs,   Icon: User,        color: 'text-blue-600' },
          { label: 'Total Visits',     value: totalTickets, Icon: MapPin,       color: 'text-orange-500' },
          { label: 'Unassigned Techs', value: plans.filter(p => !p.stops.length).length, Icon: Info, color: 'text-slate-400' },
          { label: isToday ? 'Today' : 'Selected Date',
            value: new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
            Icon: CalendarDays, color: isToday ? 'text-emerald-600' : 'text-slate-600' },
        ].map(({ label, value, Icon, color }) => (
          <div key={label} className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center gap-3">
            <Icon className={`w-4 h-4 shrink-0 ${color}`} />
            <div>
              <div className="text-[11px] text-slate-500">{label}</div>
              <div className="text-sm font-bold text-slate-800">{value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Empty state */}
      {totalTickets === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 px-6 py-14 text-center">
          <Truck className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <div className="text-sm font-semibold text-slate-500">No tickets to plan for this date</div>
          <div className="text-xs text-slate-400 mt-1">Import open tickets via CSV, then click Regenerate to build the roster.</div>
        </div>
      )}

      {/* Technician cards */}
      <div className="space-y-4">
        {visible.map((plan, visIdx) => {
          const globalIdx = plans.indexOf(plan);
          const hasStops = plan.stops.length > 0;

          return (
            <div key={plan.technicianId} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              {/* Tech header */}
              <div className={`px-5 py-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 ${hasStops ? 'bg-slate-50' : ''}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${hasStops ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
                    {plan.technicianName.charAt(0)}
                  </div>
                  <div>
                    <div className="font-bold text-slate-800 text-sm">{plan.technicianName}</div>
                    <div className="text-[11px] text-slate-400">{plan.employeeId} · {plan.tech.city} · {plan.tech.zone || plan.tech.specialisation}</div>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-xs text-slate-500">
                  {hasStops ? (
                    <>
                      <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{plan.stops.length} stops</span>
                      <span className="flex items-center gap-1"><Route className="w-3 h-3" />{plan.totalDistanceKm} km</span>
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{Math.floor(plan.totalEstimatedMins/60)}h {plan.totalEstimatedMins%60}m</span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700">{plan.status}</span>
                    </>
                  ) : (
                    <span className="text-slate-300 italic text-[11px]">No visits assigned</span>
                  )}
                </div>
              </div>

              {/* Stops */}
              {hasStops && (
                <div className="divide-y divide-slate-50">
                  {plan.stops.map((stop, stopIdx) => {
                    const pri = PRI[stop.priority];
                    const isPicking = reassignFrom?.planIdx === globalIdx && reassignFrom?.stopIdx === stopIdx;

                    return (
                      <div key={`${stop.ticketId}-${stopIdx}`}
                        className={`px-5 py-3 flex flex-wrap items-start gap-4 transition-colors ${isPicking ? 'bg-blue-50 ring-inset ring-1 ring-blue-300' : 'hover:bg-slate-50/60'}`}>

                        {/* Stop number + connector */}
                        <div className="flex flex-col items-center gap-1 shrink-0 pt-0.5">
                          <div className="w-6 h-6 rounded-full bg-slate-800 text-white flex items-center justify-center text-[11px] font-bold">{stop.stopOrder}</div>
                          {stopIdx < plan.stops.length - 1 && <div className="w-px h-4 bg-slate-200" />}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-0.5">
                            <span className="font-bold text-slate-800 text-sm">{stop.ticketId}</span>
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${pri.badge}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${pri.dot}`} />{pri.label}
                            </span>
                            <span className="text-xs text-slate-400 flex items-center gap-1">
                              <Truck className="w-3 h-3" />{stop.vehicleNumber}
                            </span>
                          </div>
                          <div className="text-xs text-slate-600 truncate">{stop.issue}</div>
                          <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-400">
                            <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{stop.centerName}</span>
                            <span className="flex items-center gap-1"><Clock className="w-3 h-3" />ETA {stop.estimatedArrival}</span>
                            <span>~{stop.estimatedDurationMins} min</span>
                          </div>
                        </div>

                        {/* Reassign control */}
                        <div className="flex items-center gap-1.5 flex-wrap shrink-0 mt-0.5">
                          {isPicking ? (
                            <>
                              <span className="text-[11px] text-blue-600 font-semibold mr-1">Move to →</span>
                              {plans
                                .filter((_, i) => i !== globalIdx)
                                .map(target => {
                                  const tIdx = plans.indexOf(target);
                                  return (
                                    <button key={target.technicianId}
                                      onClick={() => handleReassign(globalIdx, stopIdx, tIdx)}
                                      className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-[10px] font-semibold">
                                      {target.technicianName.split(' ')[0]}
                                    </button>
                                  );
                                })}
                              <button onClick={() => setReassignFrom(null)}
                                className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded text-[10px] font-semibold">
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => setReassignFrom({ planIdx: globalIdx, stopIdx })}
                              className="flex items-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-[10px] font-semibold transition-colors">
                              <ArrowRight className="w-3 h-3" />Reassign
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Print HTML ────────────────────────────────────────────────────
function buildPrintHtml(plans: MutablePlan[], date: string): string {
  const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const PC: Record<string, string> = { CRITICAL:'#dc2626', HIGH:'#ea580c', MEDIUM:'#ca8a04', LOW:'#94a3b8' };
  const PB: Record<string, string> = { CRITICAL:'#fef2f2', HIGH:'#fff7ed', MEDIUM:'#fefce8', LOW:'#f8fafc' };

  const cards = plans.map(plan => {
    const rows = plan.stops.length === 0
      ? `<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:12px;font-size:11px;">No visits assigned</td></tr>`
      : plan.stops.map(s => `<tr>
          <td style="padding:6px 8px;border:1px solid #e2e8f0;text-align:center;font-weight:700;">${s.stopOrder}</td>
          <td style="padding:6px 8px;border:1px solid #e2e8f0;font-weight:700;">${s.ticketId}</td>
          <td style="padding:6px 8px;border:1px solid #e2e8f0;">${s.vehicleNumber}</td>
          <td style="padding:6px 8px;border:1px solid #e2e8f0;max-width:130px;">${s.centerName}</td>
          <td style="padding:6px 8px;border:1px solid #e2e8f0;max-width:180px;">${s.issue}</td>
          <td style="padding:6px 8px;border:1px solid #e2e8f0;text-align:center;">
            <span style="padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700;background:${PB[s.priority]};color:${PC[s.priority]};">${s.priority}</span>
          </td>
          <td style="padding:6px 8px;border:1px solid #e2e8f0;text-align:center;font-weight:600;">${s.estimatedArrival}</td>
          <td style="padding:6px 8px;border:1px solid #e2e8f0;text-align:center;">${s.estimatedDurationMins}m</td>
        </tr>`).join('');

    return `<div class="card">
      <div class="ch">
        <div class="av">${plan.technicianName.charAt(0)}</div>
        <div>
          <div style="font-weight:800;font-size:13px;">${plan.technicianName}</div>
          <div style="font-size:10px;color:#94a3b8;">${plan.employeeId} · ${plan.tech.city} · ${plan.tech.zone || plan.tech.specialisation}</div>
        </div>
        <div class="st">
          <span>${plan.stops.length} stops</span>
          <span>${plan.totalDistanceKm} km</span>
          <span>${Math.floor(plan.totalEstimatedMins/60)}h ${plan.totalEstimatedMins%60}m</span>
        </div>
      </div>
      <table><thead><tr>
        <th style="width:28px">#</th><th>Ticket</th><th>Vehicle</th><th>Center</th>
        <th>Issue</th><th>Priority</th><th>ETA</th><th>Dur.</th>
      </tr></thead><tbody>${rows}</tbody></table>
      <div class="sig">
        <span>Technician Signature: _____________________________</span>
        <span>Supervisor Sign-off: _____________________________</span>
      </div>
    </div>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Daily Roster — ${date}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:20px;color:#1e293b;font-size:12px}
.hdr{margin-bottom:18px;border-bottom:2px solid #1e293b;padding-bottom:10px;display:flex;justify-content:space-between;align-items:flex-end}
.hdr h1{font-size:20px;font-weight:800}
.meta{font-size:11px;color:#64748b}
.card{margin-bottom:20px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;page-break-inside:avoid}
.ch{background:#f8fafc;padding:10px 14px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #e2e8f0}
.av{width:30px;height:30px;border-radius:50%;background:#1e40af;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;flex-shrink:0}
.st{margin-left:auto;display:flex;gap:14px;font-size:11px;color:#475569;font-weight:600}
table{width:100%;border-collapse:collapse;font-size:11px}
th{background:#f1f5f9;padding:6px 8px;text-align:left;border:1px solid #e2e8f0;font-size:10px;color:#64748b}
.sig{display:flex;gap:24px;padding:10px 14px;border-top:1px solid #f1f5f9;font-size:10px;color:#94a3b8}
@media print{body{padding:8px}@page{size:A4 portrait;margin:10mm}.card{margin-bottom:14px}}
</style></head><body>
<div class="hdr">
  <div><h1>FleetOps — Daily Roster</h1><div class="meta">${dateLabel}</div></div>
  <div class="meta" style="text-align:right">Printed: ${new Date().toLocaleString('en-IN')}<br>ssn090643@delhivery.com</div>
</div>
${cards}
</body></html>`;
}
