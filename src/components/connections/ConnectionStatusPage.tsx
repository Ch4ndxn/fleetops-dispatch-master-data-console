import React, { useState, useEffect, useCallback } from 'react';
import {
  Database,
  Globe,
  HardDrive,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  Wifi,
  WifiOff,
  Activity,
  Server,
  LayoutGrid,
  Layers,
} from 'lucide-react';
import { supabase, isDbEnabled } from '../../lib/supabase';
import { getCenters, getTechnicians, getTickets, getAttendance, getImportJobs, getSyncState, subscribeToDataChanges, refreshFromDb } from '../../services/storage';

type ConnStatus = 'checking' | 'ok' | 'error' | 'disabled';

interface TableStat {
  name: string;
  label: string;
  count: number | null;
  error?: string;
}

interface ConnectionCard {
  id: string;
  title: string;
  subtitle: string;
  icon: React.ElementType;
  status: ConnStatus;
  latencyMs?: number;
  detail?: string;
  extra?: React.ReactNode;
}

const STATUS_META: Record<ConnStatus, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  checking: { label: 'Checking…', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200', icon: Clock },
  ok:       { label: 'Connected',  color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', icon: CheckCircle2 },
  error:    { label: 'Error',      color: 'text-red-600',     bg: 'bg-red-50 border-red-200',       icon: XCircle },
  disabled: { label: 'Not configured', color: 'text-slate-400', bg: 'bg-slate-50 border-slate-200', icon: AlertCircle },
};

function StatusBadge({ status }: { status: ConnStatus }) {
  const m = STATUS_META[status];
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${m.bg} ${m.color}`}>
      <Icon className="w-3.5 h-3.5" />
      {m.label}
    </span>
  );
}

/** What the app's own data sync last did — the same state the NCR Planner shows. */
function AppSyncPanel() {
  const [, setTick] = useState(0);
  useEffect(() => subscribeToDataChanges(() => setTick(n => n + 1)), []);
  const s = getSyncState();
  const loadOk = s.status === 'synced';
  const rows: Array<{ label: string; ok: boolean | null; text: string }> = [
    { label: 'Reading data', ok: s.status === 'disabled' ? null : loadOk,
      text: s.status === 'disabled' ? 'No database configured'
        : s.status === 'loading' ? 'Loading…'
        : loadOk ? `OK · last refreshed ${new Date(s.lastSyncedAt!).toLocaleTimeString()}` : (s.error ?? 'Failed') },
    { label: 'Saving changes', ok: s.status === 'disabled' ? null : !s.saveError,
      text: s.saveError ?? 'OK · no failed saves' },
    ...s.warnings.map(w => ({ label: 'Table issue', ok: false as boolean | null, text: w })),
  ];
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-bold text-slate-900">App data sync</div>
        {s.status !== 'disabled' && (
          <button onClick={() => refreshFromDb()} className="text-xs font-semibold text-blue-600 hover:underline">Sync now</button>
        )}
      </div>
      <p className="text-xs text-slate-500">The ping above only tests that Supabase answers. This shows whether the app's actual reads and saves succeed.</p>
      {rows.map((r, i) => (
        <div key={i} className="flex items-start gap-2 text-xs">
          <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${r.ok === null ? 'bg-slate-300' : r.ok ? 'bg-emerald-500' : 'bg-rose-500'}`} />
          <span className="w-28 shrink-0 font-semibold text-slate-700">{r.label}</span>
          <span className={`break-all ${r.ok === false ? 'text-rose-700' : 'text-slate-600'}`}>{r.text}</span>
        </div>
      ))}
    </div>
  );
}

export function ConnectionStatusPage() {
  const [supabaseStatus, setSupabaseStatus] = useState<ConnStatus>('checking');
  const [supabaseLatency, setSupabaseLatency] = useState<number | null>(null);
  const [supabaseError, setSupabaseError] = useState<string | null>(null);
  const [tableStats, setTableStats] = useState<TableStat[]>([]);
  const [networkStatus, setNetworkStatus] = useState<ConnStatus>(navigator.onLine ? 'ok' : 'error');
  const [localStorageStatus, setLocalStorageStatus] = useState<ConnStatus>('checking');
  const [localCounts, setLocalCounts] = useState<Record<string, number>>({});
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const checkLocalStorage = useCallback(() => {
    try {
      const key = '__fleetops_ls_test__';
      localStorage.setItem(key, '1');
      localStorage.removeItem(key);
      setLocalStorageStatus('ok');
    } catch {
      setLocalStorageStatus('error');
    }
    setLocalCounts({
      Centers: getCenters().length,
      Technicians: getTechnicians().length,
      Tickets: getTickets().length,
      Attendance: getAttendance().length,
      'Import Jobs': getImportJobs().length,
    });
  }, []);

  const checkSupabase = useCallback(async () => {
    if (!isDbEnabled()) {
      setSupabaseStatus('disabled');
      setTableStats([]);
      return;
    }
    setSupabaseStatus('checking');
    const db = supabase!;
    const t0 = performance.now();
    try {
      // Ping with a lightweight count query
      const { error: pingError } = await db.from('centers').select('id', { count: 'exact', head: true });
      const latency = Math.round(performance.now() - t0);
      if (pingError) throw pingError;
      setSupabaseLatency(latency);
      setSupabaseError(null);

      // Fetch row counts for each table
      const tables = [
        { name: 'centers', label: 'Centers' },
        { name: 'technicians', label: 'Technicians' },
        { name: 'tickets', label: 'Tickets' },
        { name: 'attendance', label: 'Attendance' },
        { name: 'import_jobs', label: 'Import Jobs' },
      ];
      const results = await Promise.allSettled(
        tables.map(t => db.from(t.name).select('id', { count: 'exact', head: true }))
      );
      setTableStats(tables.map((t, i) => {
        const r = results[i];
        if (r.status === 'fulfilled' && !r.value.error) {
          return { name: t.name, label: t.label, count: r.value.count ?? 0 };
        }
        return { name: t.name, label: t.label, count: null, error: r.status === 'rejected' ? String(r.reason) : r.value.error?.message };
      }));
      setSupabaseStatus('ok');
    } catch (err: unknown) {
      setSupabaseLatency(null);
      setSupabaseError(err instanceof Error ? err.message : String(err));
      setSupabaseStatus('error');
      setTableStats([]);
    }
  }, []);

  const runAllChecks = useCallback(async () => {
    setIsRefreshing(true);
    checkLocalStorage();
    await checkSupabase();
    setLastChecked(new Date());
    setIsRefreshing(false);
  }, [checkLocalStorage, checkSupabase]);

  useEffect(() => {
    runAllChecks();
    const onOnline = () => { setNetworkStatus('ok'); runAllChecks(); };
    const onOffline = () => setNetworkStatus('error');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [runAllChecks]);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const supabaseProject = supabaseUrl ? new URL(supabaseUrl).hostname.split('.')[0] : null;

  const cards: ConnectionCard[] = [
    {
      id: 'network',
      title: 'Network / Internet',
      subtitle: 'Browser connectivity check',
      icon: networkStatus === 'ok' ? Wifi : WifiOff,
      status: networkStatus,
      detail: networkStatus === 'ok' ? 'Browser reports online' : 'Browser reports offline — check your network connection.',
    },
    {
      id: 'localStorage',
      title: 'Local Storage',
      subtitle: 'In-browser primary data store',
      icon: HardDrive,
      status: localStorageStatus,
      detail: localStorageStatus === 'ok'
        ? `Read/write working — ${Object.values(localCounts).reduce((a, b) => a + b, 0)} total records cached`
        : 'localStorage unavailable (private mode or storage quota exceeded)',
      extra: localStorageStatus === 'ok' && (
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
          {Object.entries(localCounts).map(([label, count]) => (
            <div key={label} className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-center">
              <div className="text-lg font-bold text-slate-800">{count}</div>
              <div className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">{label}</div>
            </div>
          ))}
        </div>
      ),
    },
    {
      id: 'supabase',
      title: 'Supabase (PostgreSQL)',
      subtitle: supabaseProject ? `Project: ${supabaseProject}` : 'No VITE_SUPABASE_URL configured',
      icon: Database,
      status: supabaseStatus,
      latencyMs: supabaseLatency ?? undefined,
      detail: supabaseStatus === 'disabled'
        ? 'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set. App is running in localStorage-only mode.'
        : supabaseStatus === 'error'
        ? supabaseError ?? 'Connection failed'
        : supabaseStatus === 'ok'
        ? `Connected to ${supabaseUrl}`
        : 'Running connection test…',
      extra: supabaseStatus === 'ok' && tableStats.length > 0 && (
        <div className="mt-3">
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Database Tables</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {tableStats.map(t => (
              <div key={t.name} className={`border rounded-lg px-3 py-2 text-center ${t.error ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'}`}>
                {t.error ? (
                  <div className="text-xs text-red-500 truncate">{t.error}</div>
                ) : (
                  <>
                    <div className="text-lg font-bold text-slate-800">{t.count ?? '—'}</div>
                    <div className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">{t.label}</div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      ),
    },
    {
      id: 'render',
      title: 'Render (Static Hosting)',
      subtitle: 'fleetops-dispatch-master-data-console',
      icon: Globe,
      status: 'ok',
      detail: 'This page is being served by Render — if you can see the app, Render is working correctly.',
    },
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <AppSyncPanel />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-600" />
            Connection Status
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Live health check for all services FleetOps depends on
            {lastChecked && (
              <span className="ml-2 text-slate-400">
                · Last checked {lastChecked.toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={runAllChecks}
          disabled={isRefreshing}
          className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg text-xs font-semibold transition-colors shadow-sm"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          {isRefreshing ? 'Checking…' : 'Refresh'}
        </button>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Network', status: networkStatus },
          { label: 'LocalStorage', status: localStorageStatus },
          { label: 'Supabase', status: supabaseStatus },
          { label: 'Hosting', status: 'ok' as ConnStatus },
        ].map(({ label, status }) => {
          const m = STATUS_META[status];
          const Icon = m.icon;
          return (
            <div key={label} className={`border rounded-xl px-3 py-3 text-center ${m.bg}`}>
              <Icon className={`w-5 h-5 mx-auto mb-1 ${m.color}`} />
              <div className={`text-[10px] font-bold uppercase tracking-wide ${m.color}`}>{label}</div>
              <div className={`text-[10px] font-medium ${m.color} opacity-75`}>{m.label}</div>
            </div>
          );
        })}
      </div>

      {/* Connection cards */}
      {cards.map(card => {
        const m = STATUS_META[card.status];
        const CardIcon = card.icon;
        return (
          <div key={card.id} className={`border rounded-xl p-5 ${m.bg}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-white border border-slate-200 flex items-center justify-center shadow-xs shrink-0">
                  <CardIcon className="w-5 h-5 text-slate-600" />
                </div>
                <div>
                  <div className="font-semibold text-slate-900 text-sm">{card.title}</div>
                  <div className="text-[11px] text-slate-500 font-mono">{card.subtitle}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {card.latencyMs !== undefined && card.status === 'ok' && (
                  <span className="text-xs text-emerald-700 bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded-full font-mono">
                    {card.latencyMs} ms
                  </span>
                )}
                <StatusBadge status={card.status} />
              </div>
            </div>

            {card.detail && (
              <p className={`mt-3 text-xs ${card.status === 'error' ? 'text-red-700 font-mono bg-red-100 rounded px-2 py-1.5' : 'text-slate-600'}`}>
                {card.detail}
              </p>
            )}
            {card.extra}
          </div>
        );
      })}

      {/* Architecture note */}
      <div className="border border-slate-200 rounded-xl p-5 bg-white">
        <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2 mb-3">
          <Layers className="w-4 h-4 text-slate-500" />
          How data flows
        </h3>
        <div className="flex flex-col sm:flex-row items-center gap-2 text-xs text-slate-600">
          {[
            { icon: Server, label: 'App loads', desc: 'Supabase pull' },
            { icon: HardDrive, label: 'localStorage', desc: 'Primary store (instant)' },
            { icon: Database, label: 'Supabase', desc: 'Background sync' },
            { icon: LayoutGrid, label: 'UI re-renders', desc: 'via subscribeToDataChanges()' },
          ].map((step, i) => {
            const StepIcon = step.icon;
            return (
              <React.Fragment key={step.label}>
                <div className="flex flex-col items-center text-center min-w-[90px]">
                  <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center mb-1">
                    <StepIcon className="w-4 h-4 text-slate-600" />
                  </div>
                  <div className="font-semibold text-slate-700 text-[11px]">{step.label}</div>
                  <div className="text-slate-400 text-[10px]">{step.desc}</div>
                </div>
                {i < 3 && <div className="text-slate-300 text-lg font-light hidden sm:block">→</div>}
              </React.Fragment>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] text-slate-400 border-t border-slate-100 pt-3">
          All writes go to <strong>localStorage instantly</strong> (no loading state in UI), then replicate to Supabase silently in the background. On the next app load, Supabase data is pulled back into localStorage so all devices stay in sync.
        </p>
      </div>
    </div>
  );
}
