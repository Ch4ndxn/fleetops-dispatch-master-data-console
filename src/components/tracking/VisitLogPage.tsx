/**
 * VisitLogPage — dispatcher view of all geo-verified technician visits
 *
 * Features:
 *  - Date-range filter (from / to) with Today / Yesterday / Last 7d / Last 30d shortcuts
 *  - Clear Log button (wipes all rows from visit_logs with confirmation)
 *  - Realtime subscription for live inserts
 *  - Grouped by technician with drill-down per ticket
 */
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import {
  CheckCircle, MapPin, Clock, RefreshCw, AlertCircle,
  ChevronDown, ChevronUp, Loader2, Filter, Trash2, Calendar,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────
interface VisitLog {
  id: string;
  employee_id: string;
  tech_name: string;
  ticket_id: string;
  center_name: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  action: string;
  visited_at: string;
}

interface TechGroup {
  employee_id: string;
  tech_name: string;
  logs: VisitLog[];
  autoArrived: number;
  arrived: number;
  completed: number;
  lastSeen: string;
}

// ── Helpers ──────────────────────────────────────────────────────
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  return new Date(iso).toLocaleDateString();
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { day: '2-digit', month: 'short' });
}

/** Returns YYYY-MM-DD string in local time (en-CA locale gives this format) */
function localDateStr(d: Date = new Date()): string {
  return d.toLocaleDateString('en-CA');
}

const ACTION_STYLE: Record<string, string> = {
  auto_arrived: 'bg-violet-900/60 text-violet-300 border-violet-800',
  arrived:      'bg-blue-900/60 text-blue-300 border-blue-800',
  completed:    'bg-emerald-900/60 text-emerald-300 border-emerald-800',
};
const ACTION_LABEL: Record<string, string> = {
  auto_arrived: '⚡ Auto', arrived: 'Arrived', completed: 'Completed',
};

// ── Component ────────────────────────────────────────────────────
export const VisitLogPage: React.FC = () => {
  const today = localDateStr();

  const [logs, setLogs]             = useState<VisitLog[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [expanded, setExpanded]     = useState<Set<string>>(new Set());
  const [filterEid, setFilterEid]   = useState('');
  const [realtimeOk, setRealtimeOk] = useState(false);

  // Date-range filter — defaults to today
  const [fromDate, setFromDate] = useState(today);
  const [toDate,   setToDate]   = useState(today);

  // Clear-log busy state
  const [clearing, setClearing] = useState(false);

  // ── Fetch logs for the selected date range ───────────────────
  const fetchLogs = useCallback(async (from: string, to: string) => {
    if (!supabase) { setError('Supabase not configured.'); setLoading(false); return; }
    setLoading(true);
    setError('');

    const fromISO = new Date(from + 'T00:00:00').toISOString();
    const toISO   = new Date(to   + 'T23:59:59').toISOString();

    const { data, error: err } = await supabase
      .from('visit_logs')
      .select('*')
      .gte('visited_at', fromISO)
      .lte('visited_at', toISO)
      .order('visited_at', { ascending: false })
      .limit(1000);

    setLoading(false);
    if (err) { setError(err.message); return; }
    setLogs((data ?? []) as VisitLog[]);
  }, []);

  // Re-fetch whenever the date range changes
  useEffect(() => { void fetchLogs(fromDate, toDate); }, [fetchLogs, fromDate, toDate]);

  // ── Realtime subscription ────────────────────────────────────
  useEffect(() => {
    if (!supabase) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ch = (supabase as any)
      .channel('visit_logs_live')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'visit_logs' }, (payload: any) => {
        if (payload?.new) {
          const row = payload.new as VisitLog;
          // Only prepend if the row falls within the currently viewed range
          const rowDate = localDateStr(new Date(row.visited_at));
          setLogs(prev => {
            if (rowDate >= prev[prev.length - 1]?.visited_at?.slice(0, 10) || rowDate <= localDateStr()) {
              return [row, ...prev];
            }
            return prev;
          });
        }
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .subscribe((status: any) => {
        setRealtimeOk(status === 'SUBSCRIBED');
      });
    return () => { supabase && supabase.removeChannel(ch); };
  }, []); // intentionally empty — channel stays alive for session

  // ── Clear all logs ───────────────────────────────────────────
  const handleClearLog = useCallback(async () => {
    if (!supabase) return;
    const confirmed = window.confirm(
      '⚠️ Clear ALL visit logs?\n\nThis permanently deletes every row in visit_logs and cannot be undone.'
    );
    if (!confirmed) return;

    setClearing(true);
    // Supabase requires a filter on delete() — this UUID never matches a real row's gen_random_uuid()
    const { error: err } = await supabase
      .from('visit_logs')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    setClearing(false);
    if (err) { alert('Failed to clear logs: ' + err.message); return; }
    setLogs([]);
  }, []);

  // ── Quick date-range shortcuts ───────────────────────────────
  const setRange = (daysBack: number) => {
    const t = new Date();
    const f = new Date(t);
    f.setDate(f.getDate() - daysBack);
    setFromDate(localDateStr(f));
    setToDate(localDateStr(t));
  };

  const isToday     = fromDate === today && toDate === today;
  const isYesterday = (() => {
    const y = new Date(); y.setDate(y.getDate() - 1);
    const ys = localDateStr(y);
    return fromDate === ys && toDate === ys;
  })();

  // ── Group by technician ──────────────────────────────────────
  const filtered = filterEid.trim()
    ? logs.filter(l =>
        l.employee_id.toLowerCase().includes(filterEid.toLowerCase()) ||
        l.tech_name.toLowerCase().includes(filterEid.toLowerCase()))
    : logs;

  const groupMap = new Map<string, TechGroup>();
  filtered.forEach(log => {
    const key = log.employee_id;
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        employee_id: log.employee_id,
        tech_name: log.tech_name || log.employee_id,
        logs: [],
        autoArrived: 0, arrived: 0, completed: 0,
        lastSeen: log.visited_at,
      });
    }
    const g = groupMap.get(key)!;
    g.logs.push(log);
    if (log.action === 'auto_arrived') g.autoArrived++;
    if (log.action === 'arrived')      g.arrived++;
    if (log.action === 'completed')    g.completed++;
    if (log.visited_at > g.lastSeen)   g.lastSeen = log.visited_at;
  });

  const groups = Array.from(groupMap.values()).sort(
    (a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime()
  );

  const toggleExpand = (eid: string) => setExpanded(prev => {
    const n = new Set(prev);
    n.has(eid) ? n.delete(eid) : n.add(eid);
    return n;
  });

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col bg-slate-950 text-white">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-emerald-400" />
          <h1 className="text-lg font-bold">Visit Log</h1>
          <span className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold
            ${realtimeOk
              ? 'bg-emerald-900/50 text-emerald-300 border-emerald-700'
              : 'bg-slate-800 text-slate-500 border-slate-700'}`}>
            {realtimeOk ? 'Realtime ON' : 'Realtime OFF'}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Tech filter */}
          <div className="relative">
            <Filter className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={filterEid}
              onChange={e => setFilterEid(e.target.value)}
              placeholder="Filter by tech…"
              className="bg-slate-800 border border-slate-700 rounded-lg pl-7 pr-3 py-1.5 text-sm text-white
                         placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-500 w-36"
            />
          </div>

          {/* Refresh */}
          <button onClick={() => void fetchLogs(fromDate, toDate)}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors"
            title="Refresh">
            <RefreshCw className="w-4 h-4 text-slate-400" />
          </button>

          {/* Clear all logs */}
          <button
            onClick={() => void handleClearLog()}
            disabled={clearing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-950 hover:bg-red-900
                       border border-red-800 text-red-300 text-sm font-semibold transition-colors
                       disabled:opacity-40 disabled:cursor-not-allowed"
            title="Permanently delete all visit logs">
            {clearing
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Trash2 className="w-4 h-4" />}
            Clear Log
          </button>
        </div>
      </div>

      {/* ── Date filter bar ── */}
      <div className="flex items-center gap-3 px-6 py-2.5 border-b border-slate-800/60 bg-slate-900/40 shrink-0 flex-wrap">
        <Calendar className="w-4 h-4 text-slate-500 shrink-0" />

        {/* Quick shortcuts */}
        {[
          { label: 'Today',     active: isToday,     fn: () => { setFromDate(today); setToDate(today); } },
          { label: 'Yesterday', active: isYesterday,  fn: () => {
              const y = new Date(); y.setDate(y.getDate() - 1); const ys = localDateStr(y);
              setFromDate(ys); setToDate(ys);
            }},
          { label: 'Last 7d',   active: false, fn: () => setRange(7) },
          { label: 'Last 30d',  active: false, fn: () => setRange(30) },
        ].map(({ label, active, fn }) => (
          <button key={label} onClick={fn}
            className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors font-medium
              ${active
                ? 'bg-emerald-900/60 text-emerald-300 border-emerald-700'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200 hover:border-slate-500'}`}>
            {label}
          </button>
        ))}

        <span className="text-slate-700 text-xs">|</span>

        {/* From date */}
        <label className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500">From</span>
          <input
            type="date"
            value={fromDate}
            max={toDate}
            onChange={e => setFromDate(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-xs text-white
                       focus:outline-none focus:ring-1 focus:ring-emerald-500 [color-scheme:dark]"
          />
        </label>

        {/* To date */}
        <label className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500">To</span>
          <input
            type="date"
            value={toDate}
            min={fromDate}
            max={today}
            onChange={e => setToDate(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-xs text-white
                       focus:outline-none focus:ring-1 focus:ring-emerald-500 [color-scheme:dark]"
          />
        </label>

        {/* Result count */}
        {!loading && (
          <span className="text-[11px] text-slate-600 ml-auto">
            {logs.length} visit{logs.length !== 1 ? 's' : ''} · {groups.length} tech{groups.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        {loading && (
          <div className="flex items-center justify-center py-20 text-slate-500 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading visit logs…
          </div>
        )}

        {!loading && error && (
          <div className="flex items-center gap-2 bg-red-950 border border-red-800 rounded-xl p-4 text-red-300 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />{error}
          </div>
        )}

        {!loading && !error && groups.length === 0 && (
          <div className="text-center py-20 text-slate-600">
            <CheckCircle className="w-8 h-8 mx-auto mb-3 text-slate-700" />
            <p className="text-sm">No visits found for this date range.</p>
            <p className="text-xs mt-1">
              Try a wider range or check that techs are logging from the{' '}
              <code className="bg-slate-800 px-1 rounded">#/track</code> page.
            </p>
          </div>
        )}

        <div className="space-y-3 max-w-3xl mx-auto">
          {groups.map(group => {
            const isExp = expanded.has(group.employee_id);
            return (
              <div key={group.employee_id}
                className="bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden">

                {/* Tech summary row */}
                <button
                  onClick={() => toggleExpand(group.employee_id)}
                  className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-slate-800/50 transition-colors">

                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center
                                  text-sm font-bold text-slate-200 shrink-0">
                    {(group.tech_name || group.employee_id).charAt(0).toUpperCase()}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-100">{group.tech_name}</span>
                      <span className="text-[11px] font-mono text-slate-500">{group.employee_id}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-500 flex-wrap">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" /> Last: {timeAgo(group.lastSeen)}
                      </span>
                      {group.autoArrived > 0 && <span className="text-violet-400 font-semibold">{group.autoArrived} auto</span>}
                      {group.arrived > 0      && <span className="text-blue-400 font-semibold">{group.arrived} arrived</span>}
                      {group.completed > 0    && <span className="text-emerald-400 font-semibold">{group.completed} completed</span>}
                      <span>{group.logs.length} total</span>
                    </div>
                  </div>

                  {isExp
                    ? <ChevronUp className="w-4 h-4 text-slate-500 shrink-0" />
                    : <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />}
                </button>

                {/* Visit rows */}
                {isExp && (
                  <div className="border-t border-slate-800 divide-y divide-slate-800/70">
                    {group.logs.map(log => (
                      <div key={log.id} className="flex items-start gap-3 px-5 py-3">

                        {/* Action badge */}
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border shrink-0 mt-0.5
                          ${ACTION_STYLE[log.action] ?? 'bg-slate-800 text-slate-400 border-slate-700'}`}>
                          {ACTION_LABEL[log.action] ?? log.action}
                        </span>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-slate-200 truncate">
                              {log.center_name.replace(/_D$/, '')}
                            </span>
                            <span className="text-[11px] font-mono text-slate-500">{log.ticket_id}</span>
                          </div>
                          <div className="flex items-center gap-3 mt-0.5 text-[11px] text-slate-500 flex-wrap">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {fmtDate(log.visited_at)} {fmtTime(log.visited_at)}
                            </span>
                            <a
                              href={`https://www.google.com/maps?q=${log.lat},${log.lng}`}
                              target="_blank" rel="noreferrer"
                              className="flex items-center gap-1 text-slate-600 hover:text-blue-400 transition-colors"
                              onClick={e => e.stopPropagation()}>
                              <MapPin className="w-3 h-3" />
                              {log.lat.toFixed(4)}, {log.lng.toFixed(4)}
                              {log.accuracy != null && ` ±${Math.round(log.accuracy)}m`}
                            </a>
                          </div>
                        </div>

                        <span className="text-[11px] text-slate-600 shrink-0 whitespace-nowrap">
                          {timeAgo(log.visited_at)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
