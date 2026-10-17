/**
 * VisitLogPage — dispatcher view of all geo-verified technician visits
 *
 * Reads from Supabase `visit_logs` table in real time.
 * Grouped by technician with a summary row, drill-down per ticket.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import {
  CheckCircle, MapPin, Clock, RefreshCw, AlertCircle,
  ChevronDown, ChevronUp, Loader2, Filter,
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
  arrived: number;
  completed: number;
  lastSeen: string;
}

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

const ACTION_STYLE: Record<string, string> = {
  arrived:   'bg-blue-900/60 text-blue-300 border-blue-800',
  completed: 'bg-emerald-900/60 text-emerald-300 border-emerald-800',
};
const ACTION_LABEL: Record<string, string> = {
  arrived: 'Arrived', completed: 'Completed',
};

export const VisitLogPage: React.FC = () => {
  const [logs, setLogs]           = useState<VisitLog[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [expanded, setExpanded]   = useState<Set<string>>(new Set());
  const [filterEid, setFilterEid] = useState('');
  const [realtimeOk, setRealtimeOk] = useState(false);

  // ── Fetch all logs ───────────────────────────────────────────
  const fetchLogs = useCallback(async () => {
    if (!supabase) { setError('Supabase not configured.'); setLoading(false); return; }
    setLoading(true);
    const { data, error: err } = await supabase
      .from('visit_logs')
      .select('*')
      .order('visited_at', { ascending: false })
      .limit(500);
    setLoading(false);
    if (err) { setError(err.message); return; }
    setLogs((data ?? []) as VisitLog[]);
  }, []);

  useEffect(() => { void fetchLogs(); }, [fetchLogs]);

  // ── Realtime subscription ────────────────────────────────────
  useEffect(() => {
    if (!supabase) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ch = (supabase as any)
      .channel('visit_logs_live')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'visit_logs' }, (payload: any) => {
        if (payload?.new) {
          setLogs(prev => [payload.new as VisitLog, ...prev]);
        }
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .subscribe((status: any) => {
        setRealtimeOk(status === 'SUBSCRIBED');
      });
    return () => { supabase && supabase.removeChannel(ch); };
  }, []);

  // ── Group by technician ──────────────────────────────────────
  const filtered = filterEid.trim()
    ? logs.filter(l => l.employee_id.toLowerCase().includes(filterEid.toLowerCase())
        || l.tech_name.toLowerCase().includes(filterEid.toLowerCase()))
    : logs;

  const groupMap = new Map<string, TechGroup>();
  filtered.forEach(log => {
    const key = log.employee_id;
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        employee_id: log.employee_id,
        tech_name: log.tech_name || log.employee_id,
        logs: [],
        arrived: 0,
        completed: 0,
        lastSeen: log.visited_at,
      });
    }
    const g = groupMap.get(key)!;
    g.logs.push(log);
    if (log.action === 'arrived')   g.arrived++;
    if (log.action === 'completed') g.completed++;
    if (log.visited_at > g.lastSeen) g.lastSeen = log.visited_at;
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

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-emerald-400" />
          <h1 className="text-lg font-bold">Visit Log</h1>
          <span className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold
            ${realtimeOk ? 'bg-emerald-900/50 text-emerald-300 border-emerald-700' : 'bg-slate-800 text-slate-500 border-slate-700'}`}>
            {realtimeOk ? 'Realtime ON' : 'Realtime OFF'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Filter className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={filterEid}
              onChange={e => setFilterEid(e.target.value)}
              placeholder="Filter by tech…"
              className="bg-slate-800 border border-slate-700 rounded-lg pl-7 pr-3 py-1.5 text-sm text-white placeholder-slate-600
                         focus:outline-none focus:ring-1 focus:ring-emerald-500 w-40"
            />
          </div>
          <button onClick={() => void fetchLogs()}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors"
            title="Refresh">
            <RefreshCw className="w-4 h-4 text-slate-400" />
          </button>
        </div>
      </div>

      {/* Body */}
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
            <p className="text-sm">No visits logged yet.</p>
            <p className="text-xs mt-1">Techs mark visits from the <code className="bg-slate-800 px-1 rounded">#/track</code> page.</p>
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
                  <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center text-sm font-bold text-slate-200 shrink-0">
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
                      <span className="text-blue-400 font-semibold">{group.arrived} arrived</span>
                      <span className="text-emerald-400 font-semibold">{group.completed} completed</span>
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
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border shrink-0 mt-0.5 ${ACTION_STYLE[log.action] ?? 'bg-slate-800 text-slate-400 border-slate-700'}`}>
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
                              <Clock className="w-3 h-3" />{fmtTime(log.visited_at)}
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
