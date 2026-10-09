import React, { useEffect, useState, useMemo } from 'react';
import { Technician, AttendanceRecord, AttendanceStatus } from '../../types';
import { getTechnicians, getAttendance, upsertAttendanceRecord, subscribeToDataChanges } from '../../services/storage';
import { generateCSV, downloadCSV } from '../../services/csvParser';
import {
  CalendarCheck, Clock, Upload, Download, Search,
  CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronUp,
  BarChart2, Calendar, TrendingUp, User
} from 'lucide-react';
import { localDate } from '../../lib/date';

interface Props {
  onOpenUploadModal: (type: 'ATTENDANCE_CSV') => void;
}

type PageTab = 'today' | 'history';

const STATUS_COLOR: Record<string, { bg: string; text: string; dot: string }> = {
  Present:  { bg: 'bg-emerald-100', text: 'text-emerald-800', dot: 'bg-emerald-500' },
  'Half-Day': { bg: 'bg-amber-100',   text: 'text-amber-800',   dot: 'bg-amber-500' },
  'On Leave': { bg: 'bg-blue-100',    text: 'text-blue-800',    dot: 'bg-blue-500' },
  Absent:   { bg: 'bg-rose-50',     text: 'text-rose-700',    dot: 'bg-rose-400' },
};

// ─── Attendance History for one technician ───────────────────────────────────
interface TechHistoryStats {
  tech: Technician;
  records: AttendanceRecord[];
  presentDays: number;
  halfDays: number;
  leaveDays: number;
  absentDays: number;
  totalMarked: number;
  attendancePct: number; // Present + 0.5*HalfDay / totalMarked
}

function buildTechStats(tech: Technician, all: AttendanceRecord[], from: string, to: string): TechHistoryStats {
  const records = all.filter(r =>
    r.employeeId.toUpperCase() === tech.employeeId.toUpperCase() &&
    r.date >= from && r.date <= to
  ).sort((a, b) => b.date.localeCompare(a.date));

  const presentDays  = records.filter(r => r.status === 'Present').length;
  const halfDays     = records.filter(r => r.status === 'Half-Day').length;
  const leaveDays    = records.filter(r => r.status === 'On Leave').length;
  const absentDays   = records.filter(r => r.status === 'Absent').length;
  const totalMarked  = records.length;
  const effectiveDays = presentDays + halfDays * 0.5;
  const attendancePct = totalMarked > 0 ? Math.round((effectiveDays / totalMarked) * 100) : 0;

  return { tech, records, presentDays, halfDays, leaveDays, absentDays, totalMarked, attendancePct };
}

// ─── Calendar strip (last N days) ────────────────────────────────────────────
function CalendarStrip({ records, days = 30 }: { records: AttendanceRecord[]; days?: number }) {
  const today = new Date();
  const cells: { date: string; label: string; status: string | null }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = localDate(d);
    const r = records.find(r => r.date === dateStr);
    cells.push({ date: dateStr, label: d.getDate().toString(), status: r?.status ?? null });
  }

  const colorMap: Record<string, string> = {
    Present: '#10b981',
    'Half-Day': '#f59e0b',
    'On Leave': '#3b82f6',
    Absent: '#f43f5e',
  };

  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {cells.map(cell => (
        <div
          key={cell.date}
          title={`${cell.date}: ${cell.status ?? 'No record'}`}
          className="w-5 h-5 rounded-sm flex items-center justify-center text-[8px] font-bold text-white"
          style={{
            background: cell.status ? colorMap[cell.status] ?? '#94a3b8' : '#e2e8f0',
            color: cell.status ? 'white' : '#94a3b8',
          }}
        >
          {cell.label}
        </div>
      ))}
    </div>
  );
}

// ─── Technician history row (expandable) ─────────────────────────────────────
function TechHistoryRow({ stats }: { stats: TechHistoryStats }) {
  const [expanded, setExpanded] = useState(false);
  const { tech, records, presentDays, halfDays, leaveDays, absentDays, totalMarked, attendancePct } = stats;

  const pctColor = attendancePct >= 90 ? 'text-emerald-700'
    : attendancePct >= 75 ? 'text-amber-700'
    : 'text-rose-700';
  const barColor = attendancePct >= 90 ? '#10b981' : attendancePct >= 75 ? '#f59e0b' : '#f43f5e';

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
      {/* Summary row */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-4 px-4 py-3 hover:bg-slate-50 transition-colors text-left"
      >
        {/* Avatar */}
        <div className="w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center text-xs font-bold shrink-0">
          {tech.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
        </div>

        {/* Name + meta */}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-slate-900 text-sm truncate">{tech.name}</div>
          <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
            <span className="font-mono">{tech.employeeId}</span>
            <span>·</span>
            <span>{tech.role}</span>
            <span>·</span>
            <span>{tech.zone || tech.city}</span>
          </div>
        </div>

        {/* Stats */}
        <div className="hidden sm:flex items-center gap-5 shrink-0">
          <div className="text-center">
            <div className="text-base font-bold text-emerald-700" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{presentDays}</div>
            <div className="text-[9px] text-slate-400 uppercase tracking-wide">Present</div>
          </div>
          <div className="text-center">
            <div className="text-base font-bold text-amber-600" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{halfDays}</div>
            <div className="text-[9px] text-slate-400 uppercase tracking-wide">Half Day</div>
          </div>
          <div className="text-center">
            <div className="text-base font-bold text-blue-600" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{leaveDays}</div>
            <div className="text-[9px] text-slate-400 uppercase tracking-wide">Leave</div>
          </div>
          <div className="text-center">
            <div className="text-base font-bold text-rose-600" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{absentDays}</div>
            <div className="text-[9px] text-slate-400 uppercase tracking-wide">Absent</div>
          </div>
          <div className="text-center min-w-[56px]">
            <div className={`text-base font-bold ${pctColor}`} style={{ fontFamily: 'JetBrains Mono, monospace' }}>{attendancePct}%</div>
            <div className="text-[9px] text-slate-400 uppercase tracking-wide">Rate</div>
          </div>
          {/* Bar */}
          <div className="w-20 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${attendancePct}%`, background: barColor }} />
          </div>
        </div>

        {/* Expand toggle */}
        <div className="text-slate-400 shrink-0">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-3">
          {/* Calendar strip */}
          <div>
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Last 30 days</div>
            <CalendarStrip records={records} days={30} />
            <div className="flex items-center gap-3 mt-2">
              {[
                { color: '#10b981', label: 'Present' },
                { color: '#f59e0b', label: 'Half-Day' },
                { color: '#3b82f6', label: 'Leave' },
                { color: '#f43f5e', label: 'Absent' },
                { color: '#e2e8f0', label: 'No record' },
              ].map(l => (
                <div key={l.label} className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-xs inline-block" style={{ background: l.color }} />
                  <span className="text-[9px] text-slate-500">{l.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Record list */}
          {records.length === 0 ? (
            <div className="text-xs text-slate-400 text-center py-3">No attendance records in this date range</div>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-100">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    {['Date', 'Status', 'Check-In', 'Check-Out', 'Notes', 'Verified By'].map(h => (
                      <th key={h} className="text-left px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {records.map(r => {
                    const sc = STATUS_COLOR[r.status] ?? STATUS_COLOR.Absent;
                    return (
                      <tr key={r.id} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-mono text-slate-700">{r.date}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${sc.bg} ${sc.text}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                            {r.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono text-slate-600">{r.checkInTime || '—'}</td>
                        <td className="px-3 py-2 font-mono text-slate-600">{r.checkOutTime || '—'}</td>
                        <td className="px-3 py-2 text-slate-500 max-w-xs truncate">{r.notes || '—'}</td>
                        <td className="px-3 py-2 text-slate-400 text-[10px]">{r.verifiedBy || 'System'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export const AttendancePage: React.FC<Props> = ({ onOpenUploadModal }) => {
  const [technicians, setTechnicians] = useState<Technician[]>(() => getTechnicians());

  // Live: re-read whenever data changes anywhere (other tabs, other devices)
  useEffect(() => subscribeToDataChanges(() => { setTechnicians(getTechnicians()); setAttendanceList(getAttendance()); }), []);
  const [attendanceList, setAttendanceList] = useState<AttendanceRecord[]>(() => getAttendance());
  const [selectedDate, setSelectedDate] = useState<string>(localDate());
  const [searchTerm, setSearchTerm] = useState('');
  const [pageTab, setPageTab] = useState<PageTab>('today');

  // History filters
  const today = localDate();
  const thirtyAgo = localDate(new Date(Date.now() - 30 * 24 * 3600 * 1000));
  const [histFrom, setHistFrom] = useState(thirtyAgo);
  const [histTo, setHistTo]   = useState(today);
  const [histSearch, setHistSearch] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'attendance' | 'absent' | 'leave'>('attendance');
  const [sortAsc, setSortAsc] = useState(false);

  const refreshAttendance = () => setAttendanceList(getAttendance());

  const handleUpdateStatus = (tech: Technician, newStatus: AttendanceStatus) => {
    const existing = attendanceList.find(
      a => a.employeeId.toUpperCase() === tech.employeeId.toUpperCase() && a.date === selectedDate
    );
    // Default to shift start; record a later time only for genuine late arrivals (edit the Check-In field).
    // The NCR Planner shortens a technician's shift by however late they checked in.
    const SHIFT_START = '09:00';
    upsertAttendanceRecord({
      employeeId: tech.employeeId,
      technicianName: tech.name,
      date: selectedDate,
      status: newStatus,
      checkInTime: newStatus === 'Present' || newStatus === 'Half-Day' ? (existing?.checkInTime || SHIFT_START) : '',
      notes: existing?.notes || `Status marked as ${newStatus}`,
    });
    refreshAttendance();
  };

  const handleCheckInChange = (tech: Technician, time: string) => {
    const existing = attendanceList.find(
      a => a.employeeId.toUpperCase() === tech.employeeId.toUpperCase() && a.date === selectedDate
    );
    if (!existing || (existing.status !== 'Present' && existing.status !== 'Half-Day')) return;
    upsertAttendanceRecord({ employeeId: tech.employeeId, technicianName: tech.name, date: selectedDate, status: existing.status, checkInTime: time });
    refreshAttendance();
  };

  const handleExportCSV = () => {
    const csv = generateCSV(attendanceList, [
      { key: 'employeeId', header: 'Emp ID' },
      { key: 'technicianName', header: 'Technician Name' },
      { key: 'date', header: 'Date' },
      { key: 'status', header: 'Status' },
      { key: 'checkInTime', header: 'Check-In' },
      { key: 'checkOutTime', header: 'Check-Out' },
      { key: 'notes', header: 'Note' },
    ]);
    downloadCSV(`attendance_export_${today}.csv`, csv);
  };

  const activeTechnicians = technicians.filter(t => t.status === 'Active');

  const filteredTechnicians = activeTechnicians.filter(t =>
    t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.employeeId.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.city.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // History stats per tech
  const historyStats = useMemo(() => {
    const allTechs = technicians.filter(t =>
      t.name.toLowerCase().includes(histSearch.toLowerCase()) ||
      t.employeeId.toLowerCase().includes(histSearch.toLowerCase()) ||
      (t.zone || t.city || '').toLowerCase().includes(histSearch.toLowerCase())
    );
    const stats = allTechs.map(t => buildTechStats(t, attendanceList, histFrom, histTo));
    // Sort
    return [...stats].sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') cmp = a.tech.name.localeCompare(b.tech.name);
      else if (sortBy === 'attendance') cmp = a.attendancePct - b.attendancePct;
      else if (sortBy === 'absent') cmp = a.absentDays - b.absentDays;
      else if (sortBy === 'leave') cmp = a.leaveDays - b.leaveDays;
      return sortAsc ? cmp : -cmp;
    });
  }, [technicians, attendanceList, histFrom, histTo, histSearch, sortBy, sortAsc]);

  // Today KPIs
  const todayRecords = attendanceList.filter(a => a.date === selectedDate);
  const presentCount  = todayRecords.filter(r => r.status === 'Present').length;
  const halfDayCount  = todayRecords.filter(r => r.status === 'Half-Day').length;
  const leaveCount    = todayRecords.filter(r => r.status === 'On Leave').length;
  const absentCount   = activeTechnicians.filter(t =>
    !todayRecords.find(r => r.employeeId.toUpperCase() === t.employeeId.toUpperCase() && (r.status === 'Present' || r.status === 'Half-Day' || r.status === 'On Leave'))
  ).length;

  // History summary KPIs
  const totalPresent = historyStats.reduce((s, x) => s + x.presentDays, 0);
  const totalLeave   = historyStats.reduce((s, x) => s + x.leaveDays, 0);
  const totalAbsent  = historyStats.reduce((s, x) => s + x.absentDays, 0);
  const avgRate      = historyStats.length > 0
    ? Math.round(historyStats.reduce((s, x) => s + x.attendancePct, 0) / historyStats.length)
    : 0;

  function toggleSort(field: typeof sortBy) {
    if (sortBy === field) setSortAsc(a => !a);
    else { setSortBy(field); setSortAsc(false); }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">ATTENDANCE ROSTER</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Mark daily attendance · view full history · all records synced to Supabase
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button onClick={handleExportCSV}
            className="px-3 py-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-2xs">
            <Download className="w-3.5 h-3.5" /> Export
          </button>
          <button onClick={() => onOpenUploadModal('ATTENDANCE_CSV')}
            className="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-2xs">
            <Upload className="w-3.5 h-3.5" /> Upload CSV
          </button>
        </div>
      </div>

      {/* Page tabs */}
      <div className="flex border-b border-slate-200">
        {([
          { id: 'today',   label: 'Today\'s Attendance', icon: CalendarCheck },
          { id: 'history', label: 'Technician History',  icon: BarChart2 },
        ] as const).map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setPageTab(t.id)}
              className={`flex items-center gap-2 px-5 py-2.5 text-xs font-semibold border-b-2 transition-colors ${pageTab === t.id ? 'border-purple-600 text-purple-700 bg-purple-50' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              <Icon className="w-3.5 h-3.5" />{t.label}
            </button>
          );
        })}
      </div>

      {/* ══ TODAY TAB ═══════════════════════════════════════════════════════════ */}
      {pageTab === 'today' && (
        <>
          {/* KPI bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Present',  val: presentCount,  color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
              { label: 'Half-Day', val: halfDayCount,  color: 'text-amber-700',   bg: 'bg-amber-50 border-amber-200' },
              { label: 'On Leave', val: leaveCount,    color: 'text-blue-700',    bg: 'bg-blue-50 border-blue-200' },
              { label: 'Absent / Unmarked', val: absentCount, color: 'text-rose-700', bg: 'bg-rose-50 border-rose-200' },
            ].map(k => (
              <div key={k.label} className={`border rounded-xl px-4 py-3 ${k.bg}`}>
                <div className={`text-2xl font-bold ${k.color}`} style={{ fontFamily: 'JetBrains Mono, monospace' }}>{k.val}</div>
                <div className={`text-[10px] font-semibold ${k.color} opacity-70 uppercase tracking-wide`}>{k.label}</div>
              </div>
            ))}
          </div>

          {/* Controls */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type="text" placeholder="Search technicians..."
                value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500 font-medium">Date:</label>
              <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
                className="px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg bg-white shadow-2xs" />
            </div>
          </div>

          {/* Attendance table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                    <th className="py-3 px-4">Emp ID</th>
                    <th className="py-3 px-4">Technician</th>
                    <th className="py-3 px-4">DC / Zone</th>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Check-In</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Mark</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredTechnicians.map(tech => {
                    const record = attendanceList.find(
                      a => a.employeeId.toUpperCase() === tech.employeeId.toUpperCase() && a.date === selectedDate
                    );
                    const status = record?.status || 'Absent';
                    const sc = STATUS_COLOR[status] ?? STATUS_COLOR.Absent;
                    return (
                      <tr key={tech.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-slate-900">{tech.employeeId}</td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">{tech.name}</div>
                          <div className="text-[11px] text-slate-500">{tech.role} · {tech.specialisation}</div>
                        </td>
                        <td className="py-3 px-4 text-slate-700">
                          <div>{tech.defaultDc || 'Central Hub'}</div>
                          <div className="text-[11px] text-slate-500">{tech.city} ({tech.zone || 'Base'})</div>
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-600">{selectedDate}</td>
                        <td className="py-3 px-4 font-mono text-slate-800">
                          {record && (record.status === 'Present' || record.status === 'Half-Day')
                            ? (
                              <input
                                type="time"
                                value={record.checkInTime || '09:00'}
                                onChange={e => e.target.value && handleCheckInChange(tech, e.target.value)}
                                title="Change only if the technician arrived late — the NCR Planner shortens their shift accordingly"
                                className={`px-1.5 py-0.5 border rounded text-xs font-mono ${record.checkInTime && record.checkInTime > '09:00' ? 'border-amber-300 text-amber-700 bg-amber-50' : 'border-slate-200 text-emerald-700'}`}
                              />
                            )
                            : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="py-3 px-4">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ${sc.bg} ${sc.text}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />{status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {(['Present', 'Half-Day', 'On Leave', 'Absent'] as AttendanceStatus[]).map(s => (
                              <button key={s} onClick={() => handleUpdateStatus(tech, s)}
                                className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors ${
                                  status === s
                                    ? s === 'Present' ? 'bg-emerald-600 text-white'
                                    : s === 'Half-Day' ? 'bg-amber-500 text-white'
                                    : s === 'On Leave' ? 'bg-blue-600 text-white'
                                    : 'bg-slate-700 text-white'
                                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                                }`}>
                                {s === 'On Leave' ? 'Leave' : s}
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="p-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-500">
              {filteredTechnicians.length} technicians · {selectedDate}
            </div>
          </div>
        </>
      )}

      {/* ══ HISTORY TAB ═════════════════════════════════════════════════════════ */}
      {pageTab === 'history' && (
        <>
          {/* KPI bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Avg Attendance Rate', val: `${avgRate}%`, color: avgRate >= 90 ? 'text-emerald-700' : avgRate >= 75 ? 'text-amber-700' : 'text-rose-700', bg: 'bg-slate-50 border-slate-200' },
              { label: 'Total Present Days',  val: totalPresent,  color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
              { label: 'Total Leave Days',    val: totalLeave,    color: 'text-blue-700',    bg: 'bg-blue-50 border-blue-200' },
              { label: 'Total Absent Days',   val: totalAbsent,   color: 'text-rose-700',    bg: 'bg-rose-50 border-rose-200' },
            ].map(k => (
              <div key={k.label} className={`border rounded-xl px-4 py-3 ${k.bg}`}>
                <div className={`text-2xl font-bold ${k.color}`} style={{ fontFamily: 'JetBrains Mono, monospace' }}>{k.val}</div>
                <div className={`text-[10px] font-semibold ${k.color} opacity-70 uppercase tracking-wide`}>{k.label}</div>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
            <div className="relative flex-1 max-w-xs">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type="text" placeholder="Search by name, ID, zone..."
                value={histSearch} onChange={e => setHistSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-xs text-slate-500 font-medium">From:</label>
              <input type="date" value={histFrom} onChange={e => setHistFrom(e.target.value)}
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white" />
              <label className="text-xs text-slate-500 font-medium">To:</label>
              <input type="date" value={histTo} onChange={e => setHistTo(e.target.value)}
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white" />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500">Sort:</span>
              {([
                { id: 'attendance', label: '% Rate' },
                { id: 'absent',     label: 'Absent' },
                { id: 'leave',      label: 'Leave' },
                { id: 'name',       label: 'Name' },
              ] as const).map(s => (
                <button key={s.id} onClick={() => toggleSort(s.id)}
                  className={`px-2.5 py-1.5 rounded text-[11px] font-semibold transition-colors flex items-center gap-0.5 ${sortBy === s.id ? 'bg-purple-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  {s.label}
                  {sortBy === s.id && (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                </button>
              ))}
            </div>
          </div>

          {/* Tech cards */}
          <div className="space-y-2">
            {historyStats.length === 0 ? (
              <div className="bg-white rounded-xl border border-slate-200 py-10 text-center text-slate-400 text-sm">
                No technicians match your search
              </div>
            ) : (
              historyStats.map(stats => <TechHistoryRow key={stats.tech.id} stats={stats} />)
            )}
          </div>

          <div className="text-xs text-slate-400 text-center">
            Showing {historyStats.length} technicians · {histFrom} to {histTo} · records pulled from Supabase on load
          </div>
        </>
      )}
    </div>
  );
};
