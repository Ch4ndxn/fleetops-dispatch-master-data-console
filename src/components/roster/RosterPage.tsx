/**
 * RosterPage — weekly shift scheduler with PDF download
 *
 * Features:
 *  - Week picker (Mon–Sun)
 *  - Per-technician row with 7 day cells
 *  - Each cell: Morning / Evening / Off / Leave (click to cycle)
 *  - Persisted to localStorage per week key
 *  - "Download PDF" prints a clean roster sheet via browser print
 *  - "Download CSV" exports the week as a spreadsheet
 */

import React, { useState, useCallback } from 'react';
import { getTechnicians } from '../../services/storage';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  CalendarDays,
  Sun,
  Moon,
  X,
  Plane,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────
type ShiftType = 'Morning' | 'Evening' | 'Off' | 'Leave';
type DayRoster = Record<string, ShiftType>; // techId → shift
type WeekRoster = Record<string, DayRoster>; // ISO date → DayRoster

const SHIFT_CYCLE: ShiftType[] = ['Morning', 'Evening', 'Off', 'Leave'];

const SHIFT_META: Record<ShiftType, { label: string; short: string; bg: string; text: string; icon: React.ElementType }> = {
  Morning: { label: 'Morning',  short: 'M', bg: 'bg-amber-100',   text: 'text-amber-800',  icon: Sun },
  Evening: { label: 'Evening',  short: 'E', bg: 'bg-indigo-100',  text: 'text-indigo-800', icon: Moon },
  Off:     { label: 'Off',      short: '-', bg: 'bg-slate-100',   text: 'text-slate-500',  icon: X },
  Leave:   { label: 'Leave',    short: 'L', bg: 'bg-rose-100',    text: 'text-rose-700',   icon: Plane },
};

// ── Helpers ────────────────────────────────────────────────────────
function getMondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function toIso(date: Date): string {
  return date.toISOString().split('T')[0];
}

function weekKey(monday: Date): string {
  return `roster_week_${toIso(monday)}`;
}

function loadWeek(monday: Date): WeekRoster {
  try {
    const raw = localStorage.getItem(weekKey(monday));
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveWeek(monday: Date, data: WeekRoster): void {
  try { localStorage.setItem(weekKey(monday), JSON.stringify(data)); } catch { /* ignore */ }
}

function nextShift(current: ShiftType | undefined): ShiftType {
  const idx = current ? SHIFT_CYCLE.indexOf(current) : -1;
  return SHIFT_CYCLE[(idx + 1) % SHIFT_CYCLE.length];
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_FULL   = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// ── Component ──────────────────────────────────────────────────────
export function RosterPage() {
  const [monday, setMonday] = useState<Date>(() => getMondayOf(new Date()));
  const [roster, setRoster] = useState<WeekRoster>(() => loadWeek(getMondayOf(new Date())));
  const [filterCity, setFilterCity] = useState('All');

  const technicians = getTechnicians().filter(t => t.status !== 'Inactive');
  const cities = ['All', ...Array.from(new Set(technicians.map(t => t.city || 'Unknown').filter(Boolean))).sort()];
  const visibleTechs = filterCity === 'All' ? technicians : technicians.filter(t => t.city === filterCity);

  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  const navigate = (dir: -1 | 1) => {
    const newMon = addDays(monday, dir * 7);
    setMonday(newMon);
    setRoster(loadWeek(newMon));
  };

  const toggleShift = useCallback((techId: string, dayIso: string) => {
    setRoster(prev => {
      const dayData = prev[dayIso] ?? {};
      const updated: WeekRoster = {
        ...prev,
        [dayIso]: { ...dayData, [techId]: nextShift(dayData[techId]) },
      };
      saveWeek(monday, updated);
      return updated;
    });
  }, [monday]);

  const getShift = (techId: string, dayIso: string): ShiftType =>
    roster[dayIso]?.[techId] ?? 'Off';

  // ── Summary counts per day ──
  const daySummary = days.map(d => {
    const iso = toIso(d);
    const shifts = visibleTechs.map(t => getShift(t.id, iso));
    return {
      morning: shifts.filter(s => s === 'Morning').length,
      evening: shifts.filter(s => s === 'Evening').length,
      off:     shifts.filter(s => s === 'Off').length,
      leave:   shifts.filter(s => s === 'Leave').length,
    };
  });

  // ── PDF download via print ──
  const downloadPDF = () => {
    const weekLabel = `${toIso(monday)} to ${toIso(addDays(monday, 6))}`;
    const printHtml = buildPrintHtml(visibleTechs, days, roster, weekLabel);
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(printHtml);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 400);
  };

  // ── CSV download ──
  const downloadCSV = () => {
    const header = ['Technician', 'Employee ID', 'City', ...DAY_FULL.map((d, i) => `${d} (${toIso(days[i])})`), 'Morning Count', 'Evening Count', 'Off Count', 'Leave Count'];
    const rows = visibleTechs.map(t => {
      const shifts = days.map(d => getShift(t.id, toIso(d)));
      const m = shifts.filter(s => s === 'Morning').length;
      const e = shifts.filter(s => s === 'Evening').length;
      const o = shifts.filter(s => s === 'Off').length;
      const l = shifts.filter(s => s === 'Leave').length;
      return [t.name, t.employeeId, t.city || '', ...shifts, m, e, o, l];
    });
    const csv = [header, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `roster_${toIso(monday)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isThisWeek = toIso(monday) === toIso(getMondayOf(new Date()));
  const weekLabel = `${monday.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${addDays(monday, 6).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  return (
    <div className="space-y-5">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-blue-600" />
            Weekly Roster
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">Click any cell to cycle shift type. Changes auto-save.</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* City filter */}
          <select
            value={filterCity}
            onChange={e => setFilterCity(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {cities.map(c => <option key={c}>{c}</option>)}
          </select>

          {/* Week nav */}
          <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-1 py-1">
            <button onClick={() => navigate(-1)} className="p-1 rounded hover:bg-slate-100 text-slate-600">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-semibold text-slate-700 px-2 min-w-[160px] text-center">{weekLabel}</span>
            <button onClick={() => navigate(1)} className="p-1 rounded hover:bg-slate-100 text-slate-600">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {!isThisWeek && (
            <button
              onClick={() => { const m = getMondayOf(new Date()); setMonday(m); setRoster(loadWeek(m)); }}
              className="text-xs px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg font-medium"
            >
              Today
            </button>
          )}

          <button
            onClick={downloadCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-semibold border border-emerald-200"
          >
            <FileText className="w-3.5 h-3.5" />
            CSV
          </button>

          <button
            onClick={downloadPDF}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-sm"
          >
            <Download className="w-3.5 h-3.5" />
            Download PDF
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 flex-wrap">
        {SHIFT_CYCLE.map(s => {
          const m = SHIFT_META[s];
          const Icon = m.icon;
          return (
            <span key={s} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${m.bg} ${m.text}`}>
              <Icon className="w-3 h-3" />
              {m.label}
            </span>
          );
        })}
        <span className="text-xs text-slate-400 ml-1">— click cell to cycle</span>
      </div>

      {/* Roster grid */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full min-w-[700px] text-xs border-collapse">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="text-left px-4 py-3 font-semibold text-slate-600 w-48 sticky left-0 bg-slate-50 z-10">Technician</th>
              {days.map((d, i) => {
                const isToday = toIso(d) === toIso(new Date());
                return (
                  <th key={i} className={`px-2 py-3 text-center font-semibold min-w-[90px] ${isToday ? 'text-blue-700 bg-blue-50' : 'text-slate-600'}`}>
                    <div>{DAY_LABELS[i]}</div>
                    <div className={`font-normal text-[11px] mt-0.5 ${isToday ? 'text-blue-500' : 'text-slate-400'}`}>
                      {d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </div>
                  </th>
                );
              })}
              <th className="px-3 py-3 text-center text-slate-500 font-semibold">M</th>
              <th className="px-3 py-3 text-center text-slate-500 font-semibold">E</th>
              <th className="px-3 py-3 text-center text-rose-400 font-semibold">L</th>
            </tr>
          </thead>

          <tbody>
            {visibleTechs.length === 0 && (
              <tr>
                <td colSpan={11} className="text-center py-12 text-slate-400 text-sm">
                  No technicians found. Add technicians first.
                </td>
              </tr>
            )}
            {visibleTechs.map((tech, idx) => {
              const shifts = days.map(d => getShift(tech.id, toIso(d)));
              const mCount = shifts.filter(s => s === 'Morning').length;
              const eCount = shifts.filter(s => s === 'Evening').length;
              const lCount = shifts.filter(s => s === 'Leave').length;
              return (
                <tr key={tech.id} className={`border-b border-slate-100 hover:bg-slate-50/60 transition-colors ${idx % 2 === 0 ? '' : 'bg-slate-50/30'}`}>
                  {/* Tech info */}
                  <td className="px-4 py-2.5 sticky left-0 bg-white z-10 border-r border-slate-100">
                    <div className="font-semibold text-slate-800 truncate max-w-[160px]">{tech.name}</div>
                    <div className="text-slate-400 text-[10px]">{tech.employeeId} · {tech.city}</div>
                  </td>

                  {/* Day cells */}
                  {days.map((d, di) => {
                    const iso = toIso(d);
                    const shift = getShift(tech.id, iso);
                    const meta = SHIFT_META[shift];
                    const Icon = meta.icon;
                    const isToday = iso === toIso(new Date());
                    return (
                      <td key={di} className={`px-1.5 py-2 text-center ${isToday ? 'bg-blue-50/40' : ''}`}>
                        <button
                          onClick={() => toggleShift(tech.id, iso)}
                          title={`${tech.name} — ${DAY_FULL[di]}: ${shift} (click to change)`}
                          className={`w-full px-1 py-1.5 rounded-lg font-semibold transition-all hover:scale-105 hover:shadow-sm cursor-pointer select-none flex items-center justify-center gap-1 ${meta.bg} ${meta.text}`}
                        >
                          <Icon className="w-3 h-3 shrink-0" />
                          <span>{meta.short}</span>
                        </button>
                      </td>
                    );
                  })}

                  {/* Weekly summary */}
                  <td className="px-3 py-2 text-center">
                    <span className={`font-bold ${mCount > 0 ? 'text-amber-700' : 'text-slate-300'}`}>{mCount}</span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className={`font-bold ${eCount > 0 ? 'text-indigo-700' : 'text-slate-300'}`}>{eCount}</span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className={`font-bold ${lCount > 0 ? 'text-rose-600' : 'text-slate-300'}`}>{lCount}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>

          {/* Day summary footer */}
          <tfoot>
            <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
              <td className="px-4 py-2.5 text-slate-600 text-xs sticky left-0 bg-slate-50">Daily totals</td>
              {daySummary.map((s, i) => (
                <td key={i} className="px-1 py-2 text-center">
                  <div className="flex flex-col gap-0.5 items-center">
                    {s.morning > 0 && <span className="text-amber-700 text-[10px] font-bold">{s.morning}M</span>}
                    {s.evening > 0 && <span className="text-indigo-700 text-[10px] font-bold">{s.evening}E</span>}
                    {s.leave   > 0 && <span className="text-rose-600 text-[10px] font-bold">{s.leave}L</span>}
                    {s.morning === 0 && s.evening === 0 && s.leave === 0 && <span className="text-slate-300 text-[10px]">—</span>}
                  </div>
                </td>
              ))}
              <td colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ── Print HTML builder ─────────────────────────────────────────────
function buildPrintHtml(
  techs: ReturnType<typeof getTechnicians>,
  days: Date[],
  roster: WeekRoster,
  weekLabel: string,
): string {
  const getShift = (techId: string, dayIso: string): ShiftType =>
    roster[dayIso]?.[techId] ?? 'Off';

  const shiftColor: Record<ShiftType, string> = {
    Morning: '#92400e',
    Evening: '#3730a3',
    Off:     '#94a3b8',
    Leave:   '#be123c',
  };
  const shiftBg: Record<ShiftType, string> = {
    Morning: '#fef3c7',
    Evening: '#e0e7ff',
    Off:     '#f1f5f9',
    Leave:   '#fff1f2',
  };

  const rows = techs.map(t => {
    const cells = days.map(d => {
      const shift = getShift(t.id, toIso(d));
      return `<td style="padding:6px 4px;text-align:center;border:1px solid #e2e8f0;">
        <span style="display:inline-block;padding:3px 8px;border-radius:6px;font-size:10px;font-weight:700;background:${shiftBg[shift]};color:${shiftColor[shift]};">${shift}</span>
      </td>`;
    }).join('');
    const shifts = days.map(d => getShift(t.id, toIso(d)));
    const m = shifts.filter(s => s === 'Morning').length;
    const e = shifts.filter(s => s === 'Evening').length;
    const l = shifts.filter(s => s === 'Leave').length;
    return `<tr>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;white-space:nowrap;">
        <div style="font-weight:700;font-size:11px;color:#1e293b;">${t.name}</div>
        <div style="font-size:10px;color:#94a3b8;">${t.employeeId} · ${t.city || ''}</div>
      </td>
      ${cells}
      <td style="padding:6px 6px;text-align:center;border:1px solid #e2e8f0;font-size:11px;font-weight:700;color:#92400e;">${m || '—'}</td>
      <td style="padding:6px 6px;text-align:center;border:1px solid #e2e8f0;font-size:11px;font-weight:700;color:#3730a3;">${e || '—'}</td>
      <td style="padding:6px 6px;text-align:center;border:1px solid #e2e8f0;font-size:11px;font-weight:700;color:#be123c;">${l || '—'}</td>
    </tr>`;
  }).join('');

  const dayHeaders = days.map((d, i) =>
    `<th style="padding:8px 4px;text-align:center;background:#f8fafc;border:1px solid #e2e8f0;font-size:11px;min-width:72px;">
      ${DAY_LABELS[i]}<br><span style="font-weight:400;font-size:10px;color:#94a3b8;">${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
    </th>`
  ).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Weekly Roster — ${weekLabel}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; color: #1e293b; }
    h1 { font-size: 18px; font-weight: 800; margin-bottom: 2px; }
    .subtitle { font-size: 12px; color: #64748b; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    @media print {
      body { padding: 12px; }
      @page { size: A4 landscape; margin: 12mm; }
    }
    .legend { display: flex; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
    .legend-item { display: flex; align-items: center; gap: 4px; font-size: 10px; font-weight: 600; }
  </style>
</head>
<body>
  <h1>FleetOps — Weekly Roster</h1>
  <div class="subtitle">Week: ${weekLabel} &nbsp;·&nbsp; Generated: ${new Date().toLocaleString('en-IN')}</div>
  <div class="legend">
    <div class="legend-item"><span style="width:12px;height:12px;border-radius:3px;background:#fef3c7;display:inline-block;"></span><span style="color:#92400e;">Morning</span></div>
    <div class="legend-item"><span style="width:12px;height:12px;border-radius:3px;background:#e0e7ff;display:inline-block;"></span><span style="color:#3730a3;">Evening</span></div>
    <div class="legend-item"><span style="width:12px;height:12px;border-radius:3px;background:#f1f5f9;display:inline-block;"></span><span style="color:#94a3b8;">Off</span></div>
    <div class="legend-item"><span style="width:12px;height:12px;border-radius:3px;background:#fff1f2;display:inline-block;"></span><span style="color:#be123c;">Leave</span></div>
    <span style="font-size:10px;color:#94a3b8;margin-left:8px;">M = Morning days, E = Evening days, L = Leave days</span>
  </div>
  <table>
    <thead>
      <tr>
        <th style="padding:8px 10px;text-align:left;background:#f8fafc;border:1px solid #e2e8f0;font-size:11px;min-width:140px;">Technician</th>
        ${dayHeaders}
        <th style="padding:8px 4px;text-align:center;background:#fef3c7;border:1px solid #e2e8f0;font-size:10px;color:#92400e;">M</th>
        <th style="padding:8px 4px;text-align:center;background:#e0e7ff;border:1px solid #e2e8f0;font-size:10px;color:#3730a3;">E</th>
        <th style="padding:8px 4px;text-align:center;background:#fff1f2;border:1px solid #e2e8f0;font-size:10px;color:#be123c;">L</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div style="margin-top:16px;font-size:10px;color:#94a3b8;">Printed from FleetOps Dispatch Console · ssn090643@delhivery.com</div>
</body>
</html>`;
}
