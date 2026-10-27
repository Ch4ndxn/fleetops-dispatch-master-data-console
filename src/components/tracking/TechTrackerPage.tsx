/**
 * TechTrackerPage — mobile PWA for field technicians
 *
 * Accessed via: https://your-app.com/#/track
 * or:           https://your-app.com/#/track?eid=EMP001
 *
 * Features:
 * - GPS watchPosition → upserts to Supabase tech_locations every ≥30 s
 * - "My Stops"  — assigned route stops from saved plan, with proximity-gated visit marking
 * - "Nearby Tickets" — ALL open/in-progress tickets within NEARBY_RADIUS_KM, sorted by distance
 *   (including unassigned ones), same Mark Arrived / Mark Done buttons
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { getRoutePlans, getTechnicians, getTickets, getCenters } from '../../services/storage';
import { TechnicianRoutePlan, RouteStop, Ticket, Center } from '../../types';
import {
  MapPin, Radio, CheckCircle, AlertCircle, Loader2,
  WifiOff, Navigation, Clock, Wrench, ChevronDown, ChevronUp, Search, Download, Phone,
} from 'lucide-react';
import { DC_POC_DATA } from '../dcpoc/dcPocData';

// ── DC POC inline contact block ──────────────────────────────────
function findDcPoc(centerName: string) {
  if (!centerName) return null;
  const norm = centerName.trim().toLowerCase();
  // 1. exact match
  let m = DC_POC_DATA.find(d => d.center.toLowerCase() === norm);
  if (m) return m;
  // 2. try adding _D suffix (tickets often omit it)
  m = DC_POC_DATA.find(d => d.center.toLowerCase() === norm + '_d');
  if (m) return m;
  // 3. strip _D/_H/_W/_C from both sides and do contains match
  const base = norm.replace(/[_\s]+(d|h|w|c)$/, '');
  m = DC_POC_DATA.find(d => d.center.toLowerCase().replace(/[_\s]+(d|h|w|c)$/, '') === base);
  if (m) return m;
  // 4. loose contains
  m = DC_POC_DATA.find(d => d.center.toLowerCase().includes(base));
  return m ?? null;
}

function PocContacts({ centerName }: { centerName: string }) {
  const poc = findDcPoc(centerName);
  if (!poc) return null;
  const rows = [
    { label: 'POC', name: poc.poc, phone: poc.pocPhone, color: 'text-orange-300' },
    { label: 'TL',  name: poc.tl,  phone: poc.tlPhone,  color: 'text-blue-300'   },
    { label: 'ATL', name: poc.atl, phone: poc.atlPhone,  color: 'text-purple-300' },
  ].filter(r => r.name || r.phone);
  if (!rows.length) return null;
  return (
    <div className="mt-2 rounded-lg bg-slate-800 border border-slate-700 p-2.5 space-y-1.5">
      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">DC Contacts</div>
      {rows.map(r => (
        <div key={r.label} className="flex items-center gap-2">
          <span className={`text-[10px] font-bold w-6 ${r.color}`}>{r.label}</span>
          <span className="text-[11px] text-slate-300 flex-1 truncate">{r.name || '—'}</span>
          {r.phone ? (
            <div className="flex items-center gap-1.5 shrink-0">
              <a href={`tel:+91${r.phone}`}
                className="flex items-center gap-1 text-[11px] font-mono text-slate-300 hover:text-white">
                <Phone size={10} className="text-slate-500" />{r.phone}
              </a>
              <a href={`https://wa.me/91${r.phone}`} target="_blank" rel="noopener noreferrer"
                className="text-[9px] bg-green-700/40 text-green-300 px-1.5 py-0.5 rounded font-bold">
                WA
              </a>
            </div>
          ) : (
            <span className="text-[10px] text-slate-600">—</span>
          )}
        </div>
      ))}
    </div>
  );
}

type TrackState = 'idle' | 'requesting' | 'tracking' | 'error' | 'no_gps' | 'no_db';

const MIN_UPSERT_INTERVAL_MS = 30_000;
const MARK_RADIUS_M          = 200;   // must be within this to mark visited
const NEARBY_RADIUS_KM       = 5;     // show open tickets within this radius

// ── Haversine distance (meters) ─────────────────────────────────
function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Priority colours ─────────────────────────────────────────────
const PRIORITY_BG: Record<string, string> = {
  CRITICAL: '#7f1d1d', HIGH: '#7c2d12', MEDIUM: '#713f12', LOW: '#14532d',
};
const PRIORITY_TEXT: Record<string, string> = {
  CRITICAL: '#fca5a5', HIGH: '#fb923c', MEDIUM: '#fbbf24', LOW: '#4ade80',
};

// ── Local visit record ────────────────────────────────────────────
interface VisitRecord {
  ticketId: string;
  action: 'arrived' | 'completed';
  time: Date;
}

// ── Nearby open ticket (enriched with distance + center coords) ──
interface NearbyTicket {
  ticket: Ticket;
  center: Center;
  distM: number;
}

const DONE_STATUSES = new Set<string>(['Resolved', 'Closed']);

export const TechTrackerPage: React.FC = () => {
  const urlEid = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('eid') ?? '';

  const [employeeId, setEmployeeId]       = useState(urlEid.toUpperCase());
  const [techName, setTechName]           = useState('');
  const [state, setState]                 = useState<TrackState>('idle');
  const [errorMsg, setErrorMsg]           = useState('');
  const [lastFix, setLastFix]             = useState<{ lat: number; lng: number; accuracy: number; ts: Date } | null>(null);
  const [upsertCount, setUpsertCount]     = useState(0);

  const [myPlan, setMyPlan]               = useState<TechnicianRoutePlan | null>(null);
  const [stopDists, setStopDists]         = useState<Map<string, number>>(new Map());
  const [nearbyTickets, setNearbyTickets] = useState<NearbyTicket[]>([]);
  const [visits, setVisits]               = useState<Map<string, VisitRecord>>(new Map());
  const [expanded, setExpanded]           = useState<Set<string>>(new Set());
  const [marking, setMarking]             = useState<string | null>(null);
  const [showMyStops, setShowMyStops]     = useState(true);
  const [showNearby, setShowNearby]       = useState(true);

  // ── PWA install prompt ───────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled]     = useState(false);

  useEffect(() => {
    // Check if already running as installed PWA
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
    }
    // Capture the browser's install prompt
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = (e: any) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', () => { setIsInstalled(true); setInstallPrompt(null); });
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = useCallback(async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') { setIsInstalled(true); setInstallPrompt(null); }
  }, [installPrompt]);

  const watchIdRef     = useRef<number | null>(null);
  const lastUpsertRef  = useRef<number>(0);
  const lastFixTimeRef = useRef<number>(0);   // epoch ms of last GPS callback
  const keepAliveRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const centerMapRef   = useRef<Map<string, Center>>(new Map());
  // Auto-arrive: set of ticketIds already auto-logged this session (prevents re-fire)
  const autoLoggedRef  = useRef<Set<string>>(new Set());
  // Ref mirrors for use inside callbacks without stale closure
  const employeeIdRef  = useRef(employeeId);
  const techNameRef    = useRef(techName);
  const stateRef       = useRef<TrackState>('idle');
  useEffect(() => { employeeIdRef.current = employeeId; }, [employeeId]);
  useEffect(() => { techNameRef.current   = techName;   }, [techName]);
  useEffect(() => { stateRef.current      = state;      }, [state]);

  // ── Load centers once ────────────────────────────────────────────
  useEffect(() => {
    const cs = getCenters().filter(c => c.active && c.latitude && c.longitude);
    centerMapRef.current = new Map(
      cs.flatMap(c => [
        [c.name.trim().toLowerCase(), c],
        [c.normalizedName.trim().toLowerCase(), c],
      ])
    );
  }, []);

  // ── Load route plan when employeeId changes ──────────────────────
  useEffect(() => {
    if (!employeeId.trim()) { setMyPlan(null); return; }
    const eid   = employeeId.trim().toUpperCase();
    const techs = getTechnicians();
    const tech  = techs.find(t => t.employeeId?.toUpperCase() === eid);
    if (!tech) { setMyPlan(null); return; }
    if (!techName && tech.name) setTechName(tech.name);
    const plans = getRoutePlans();
    setMyPlan(plans.find(p => p.technicianId === tech.id) ?? null);
  }, [employeeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-log "arrived" when crossing within MARK_RADIUS_M ───────
  const autoLogVisit = useCallback(async (
    ticketId: string, centerName: string, lat: number, lng: number, accuracy: number
  ) => {
    if (!supabase) return;
    if (autoLoggedRef.current.has(ticketId)) return; // already fired this session
    autoLoggedRef.current.add(ticketId); // optimistic lock

    const eid  = employeeIdRef.current.trim().toUpperCase();
    const name = techNameRef.current.trim() || eid;

    const { error } = await supabase.from('visit_logs').insert({
      employee_id: eid,
      tech_name:   name,
      ticket_id:   ticketId,
      center_name: centerName,
      lat, lng, accuracy,
      action:      'auto_arrived',
      visited_at:  new Date().toISOString(),
    });

    if (error) {
      console.error('[Tracker] auto-visit error', error);
      autoLoggedRef.current.delete(ticketId); // allow retry
    } else {
      setVisits(prev => {
        const m = new Map(prev);
        // Only set if not already marked completed manually
        if (!m.has(ticketId)) m.set(ticketId, { ticketId, action: 'arrived', time: new Date() });
        return m;
      });
    }
  }, []);

  // ── Recalculate distances + nearby tickets on every GPS fix ─────
  const recalc = useCallback((lat: number, lng: number, accuracy: number) => {
    // Assigned stop distances + auto-arrive
    if (myPlan) {
      const m = new Map<string, number>();
      myPlan.stops.forEach(s => {
        if (s.latitude && s.longitude) {
          const d = distanceM(lat, lng, s.latitude, s.longitude);
          m.set(s.ticketId, d);
          if (d <= MARK_RADIUS_M) void autoLogVisit(s.ticketId, s.centerName, lat, lng, accuracy);
        }
      });
      setStopDists(m);
    }

    // Nearby open tickets from all centers + auto-arrive
    const cm = centerMapRef.current;
    const tickets = getTickets().filter(t => !DONE_STATUSES.has(t.status) && t.centerName);
    const enriched: NearbyTicket[] = [];
    tickets.forEach(t => {
      const center = cm.get(t.centerName.trim().toLowerCase());
      if (!center) return;
      const d = distanceM(lat, lng, center.latitude, center.longitude);
      if (d <= NEARBY_RADIUS_KM * 1000) enriched.push({ ticket: t, center, distM: d });
      if (d <= MARK_RADIUS_M) void autoLogVisit(t.ticketId, t.centerName, lat, lng, accuracy);
    });
    enriched.sort((a, b) => a.distM - b.distM);
    setNearbyTickets(enriched);
  }, [myPlan, autoLogVisit]);

  // ── Upsert location to Supabase ─────────────────────────────────
  const upsertLocation = useCallback(async (lat: number, lng: number, accuracy: number) => {
    if (!supabase) { setState('no_db'); return; }
    const now = Date.now();
    if (now - lastUpsertRef.current < MIN_UPSERT_INTERVAL_MS) return;
    lastUpsertRef.current = now;

    const { error } = await supabase.from('tech_locations').upsert(
      {
        employee_id: employeeId.trim().toUpperCase(),
        tech_name:   techName.trim() || employeeId.trim().toUpperCase(),
        lat, lng, accuracy,
        updated_at:  new Date().toISOString(),
      },
      { onConflict: 'employee_id' }
    );
    if (error) {
      console.error('[Tracker] upsert error', error);
      setErrorMsg(`DB error: ${error.message}`);
    } else {
      setErrorMsg('');
      setUpsertCount(c => c + 1);
    }
  }, [employeeId, techName]);

  // ── Wake Lock — prevents CPU/screen sleep in WebView ────────────
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const acquireWakeLock = useCallback(async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as Navigator & { wakeLock: { request: (type: string) => Promise<WakeLockSentinel> } }).wakeLock.request('screen');
        console.log('[Tracker] Wake lock acquired');
      }
    } catch (e) {
      console.warn('[Tracker] Wake lock failed', e);
    }
  }, []);
  const releaseWakeLock = useCallback(() => {
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }, []);

  // ── Register one watchPosition call ─────────────────────────────
  const registerWatch = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        lastFixTimeRef.current = Date.now();
        setLastFix({ lat: latitude, lng: longitude, accuracy: Math.round(accuracy), ts: new Date() });
        setState('tracking');
        stateRef.current = 'tracking';
        recalc(latitude, longitude, accuracy);
        void upsertLocation(latitude, longitude, accuracy);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setErrorMsg('Location permission denied. Please allow location access and try again.');
          setState('error');
          stateRef.current = 'error';
          if (watchIdRef.current !== null) { navigator.geolocation.clearWatch(watchIdRef.current); watchIdRef.current = null; }
          if (keepAliveRef.current !== null) { clearInterval(keepAliveRef.current); keepAliveRef.current = null; }
          releaseWakeLock();
        } else {
          console.warn('[Tracker] GPS warn', err.code, err.message);
        }
      },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 40_000 },
    );
  }, [recalc, upsertLocation, releaseWakeLock]);

  // ── Start GPS ────────────────────────────────────────────────────
  const startTracking = useCallback(() => {
    if (!employeeId.trim()) { setErrorMsg('Please enter your Employee ID first.'); setState('error'); return; }
    if (!navigator.geolocation) { setState('no_gps'); return; }
    if (!supabase) { setState('no_db'); return; }
    setState('requesting');
    stateRef.current = 'requesting';
    setErrorMsg('');
    lastUpsertRef.current = 0;
    lastFixTimeRef.current = Date.now();

    void acquireWakeLock();
    registerWatch();

    // Heartbeat: every 45 s, if no GPS fix received in last 50 s → restart watchPosition
    keepAliveRef.current = setInterval(() => {
      if (stateRef.current !== 'tracking' && stateRef.current !== 'requesting') return;
      const staleSec = (Date.now() - lastFixTimeRef.current) / 1000;
      if (staleSec > 50) {
        console.warn(`[Tracker] GPS stale for ${Math.round(staleSec)}s — restarting watchPosition`);
        registerWatch();
      }
    }, 45_000);

  }, [employeeId, acquireWakeLock, registerWatch]);

  // ── Stop GPS ─────────────────────────────────────────────────────
  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (keepAliveRef.current !== null) {
      clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;
    }
    releaseWakeLock();
    setState('idle');
    stateRef.current = 'idle';
    setLastFix(null);
    setUpsertCount(0);
    setNearbyTickets([]);
    autoLoggedRef.current.clear();
  }, [releaseWakeLock]);

  useEffect(() => () => stopTracking(), [stopTracking]);

  // Re-acquire wake lock and restart GPS when app comes back to foreground
  useEffect(() => {
    const onVisible = () => {
      if (stateRef.current !== 'tracking' && stateRef.current !== 'requesting') return;
      console.log('[Tracker] Visibility restored — restarting GPS & wake lock');
      void acquireWakeLock();
      lastUpsertRef.current = 0;
      registerWatch();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [acquireWakeLock, registerWatch]);

  // ── Mark visit ───────────────────────────────────────────────────
  const markVisit = useCallback(async (
    ticketId: string, centerName: string, action: 'arrived' | 'completed'
  ) => {
    if (!lastFix || !supabase) return;
    setMarking(ticketId);
    const { error } = await supabase.from('visit_logs').insert({
      employee_id: employeeId.trim().toUpperCase(),
      tech_name:   techName.trim() || employeeId.trim().toUpperCase(),
      ticket_id:   ticketId,
      center_name: centerName,
      lat:         lastFix.lat,
      lng:         lastFix.lng,
      accuracy:    lastFix.accuracy,
      action,
      visited_at:  new Date().toISOString(),
    });
    setMarking(null);
    if (error) {
      console.error('[Tracker] visit log error', error);
      setErrorMsg(`Visit log error: ${error.message}`);
    } else {
      setVisits(prev => {
        const m = new Map(prev);
        m.set(ticketId, { ticketId, action, time: new Date() });
        return m;
      });
    }
  }, [lastFix, employeeId, techName]);

  // ── Helpers ───────────────────────────────────────────────────────
  const isTracking   = state === 'tracking';
  const isRequesting = state === 'requesting';
  const fmtDist = (m: number) => m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;

  function ActionButtons({ ticketId, centerName, distM }: { ticketId: string; centerName: string; distM: number | undefined }) {
    const visit     = visits.get(ticketId);
    const nearby    = distM !== undefined && distM <= MARK_RADIUS_M;
    const isDone    = visit?.action === 'completed';
    const isMarking = marking === ticketId;
    if (isDone) return null;
    if (!isTracking) return <p className="text-[11px] text-slate-600 mt-1.5">Start GPS to enable visit marking</p>;
    return (
      <div className="flex gap-2 mt-2">
        {/* Auto-arrived: show info label, not a button */}
        {!visit && !nearby && (
          <div className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold bg-slate-800 text-slate-600">
            <MapPin className="w-3.5 h-3.5" />
            {distM !== undefined ? fmtDist(distM) + ' away' : '—'}
          </div>
        )}
        {/* Manual Mark Arrived — only shown if not yet arrived AND currently nearby */}
        {!visit && nearby && (
          <button onClick={() => void markVisit(ticketId, centerName, 'arrived')}
            disabled={isMarking}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors">
            {isMarking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MapPin className="w-3.5 h-3.5" />}
            Mark Arrived
          </button>
        )}
        {/* Mark Done */}
        <button onClick={() => void markVisit(ticketId, centerName, 'completed')}
          disabled={!nearby || isMarking}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors
            ${nearby ? 'bg-emerald-700 hover:bg-emerald-600 text-white' : 'bg-slate-800 text-slate-600 cursor-not-allowed'}`}>
          {isMarking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
          Mark Done
        </button>
      </div>
    );
  }

  const stopsSorted  = myPlan ? [...myPlan.stops].sort((a, b) => a.stopOrder - b.stopOrder) : [];
  const pendingCount = stopsSorted.filter(s => { const v = visits.get(s.ticketId); return !v || v.action !== 'completed'; }).length;
  const assignedIds  = new Set(stopsSorted.map(s => s.ticketId));
  const extraNearby  = nearbyTickets.filter(n => !assignedIds.has(n.ticket.ticketId));

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-950 text-white pb-10"
         style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/* Header */}
      <div className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio className={`w-5 h-5 ${isTracking ? 'text-emerald-400 animate-pulse' : 'text-slate-500'}`} />
          <span className="font-bold text-sm">FleetOps Tracking</span>
        </div>
        {isTracking && (
          <span className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-ping inline-block" />
            LIVE · {upsertCount} sync{upsertCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* ── PWA Install Banner ── */}
      {!isInstalled && installPrompt && (
        <div className="bg-emerald-900/80 border-b border-emerald-700 px-4 py-2.5 flex items-center gap-3">
          <Download className="w-4 h-4 text-emerald-300 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-emerald-200">Install for background GPS</p>
            <p className="text-[10px] text-emerald-500">Keeps tracking when screen turns off</p>
          </div>
          <button onClick={() => void handleInstall()}
            className="shrink-0 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors">
            Install
          </button>
        </div>
      )}

      <div className="px-4 pt-4 space-y-4 max-w-md mx-auto">

        {/* ID + Name + GPS status */}
        <div className="bg-slate-900 rounded-2xl border border-slate-700 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Employee ID</label>
              <input type="text" value={employeeId} onChange={e => setEmployeeId(e.target.value.toUpperCase())}
                placeholder="EMP001" disabled={isTracking || isRequesting}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-white placeholder-slate-600
                           focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-40" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Your Name</label>
              <input type="text" value={techName} onChange={e => setTechName(e.target.value)}
                placeholder="Rahul Sharma" disabled={isTracking || isRequesting}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600
                           focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-40" />
            </div>
          </div>

          {isTracking && lastFix && (
            <div className="bg-emerald-950/60 border border-emerald-800 rounded-xl p-3 space-y-1">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-xs font-semibold text-emerald-300">GPS Active</span>
                <span className="ml-auto text-[10px] text-emerald-600 font-mono">±{lastFix.accuracy} m</span>
              </div>
              <div className="text-[11px] text-emerald-600 font-mono">
                {lastFix.lat.toFixed(5)}, {lastFix.lng.toFixed(5)} · {lastFix.ts.toLocaleTimeString()}
              </div>
              {errorMsg && (
                <div className="text-[11px] text-red-400 flex items-center gap-1 pt-1">
                  <AlertCircle className="w-3 h-3 shrink-0" />{errorMsg}
                </div>
              )}
            </div>
          )}

          {isRequesting && (
            <div className="flex items-center gap-2 text-sm text-blue-400">
              <Loader2 className="w-4 h-4 animate-spin" /> Acquiring GPS…
            </div>
          )}

          {(state === 'error' || state === 'no_gps' || state === 'no_db') && (
            <div className="bg-red-950 border border-red-800 rounded-xl p-3 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <div className="text-xs text-red-300">
                {state === 'no_gps' && 'GPS not available on this device.'}
                {state === 'no_db'  && 'Database not configured. Contact dispatcher.'}
                {state === 'error'  && (errorMsg || 'An error occurred.')}
              </div>
            </div>
          )}

          {!isTracking ? (
            <button onClick={startTracking} disabled={isRequesting || !employeeId.trim()}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm
                         bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700
                         disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              {isRequesting ? <><Loader2 className="w-4 h-4 animate-spin" /> Getting location…</> : <><Navigation className="w-4 h-4" /> Start Sharing Location</>}
            </button>
          ) : (
            <button onClick={stopTracking}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm
                         bg-red-700 hover:bg-red-600 active:bg-red-800 transition-colors">
              <WifiOff className="w-4 h-4" /> Stop Sharing Location
            </button>
          )}
        </div>

        {/* ── My Assigned Stops ───────────────────────────────── */}
        {stopsSorted.length > 0 && (
          <div className="bg-slate-900 rounded-2xl border border-slate-700 overflow-hidden">
            <button onClick={() => setShowMyStops(s => !s)}
              className="w-full flex items-center justify-between px-4 py-3 text-left">
              <div className="flex items-center gap-2">
                <Wrench className="w-4 h-4 text-slate-400" />
                <span className="text-sm font-bold text-slate-200">My Stops</span>
                <span className="text-[11px] bg-slate-800 text-slate-400 border border-slate-700 px-2 py-0.5 rounded-full font-semibold">
                  {pendingCount} pending · {stopsSorted.length - pendingCount} done
                </span>
              </div>
              {showMyStops ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
            </button>

            {showMyStops && (
              <div className="divide-y divide-slate-800">
                {stopsSorted.map((stop: RouteStop) => {
                  const dist   = stopDists.get(stop.ticketId);
                  const nearby = dist !== undefined && dist <= MARK_RADIUS_M;
                  const visit  = visits.get(stop.ticketId);
                  const isDone = visit?.action === 'completed' || stop.ticketStatus === 'Resolved' || stop.ticketStatus === 'Closed';
                  const isExp  = expanded.has(stop.ticketId);

                  return (
                    <div key={stop.ticketId} className={`px-4 py-3 ${isDone ? 'opacity-60' : ''}`}>
                      <div className="flex items-start gap-3">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5
                          ${isDone ? 'bg-emerald-800 text-emerald-300' : nearby ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
                          {isDone ? '✓' : stop.stopOrder}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-slate-100 truncate">{stop.centerName.replace(/_D$/, '')}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-bold"
                              style={{ background: PRIORITY_BG[stop.priority] ?? '#1e293b', color: PRIORITY_TEXT[stop.priority] ?? '#94a3b8' }}>
                              {stop.priority}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5">{stop.vehicleNumber} · {stop.issue}</div>
                          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                            {dist !== undefined ? (
                              <span className={`text-[11px] font-semibold flex items-center gap-1 ${nearby ? 'text-blue-400' : 'text-slate-500'}`}>
                                <MapPin className="w-3 h-3" />{fmtDist(dist)}{nearby && <span className="text-blue-300"> · nearby!</span>}
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-600 flex items-center gap-1">
                                <MapPin className="w-3 h-3" /> Start GPS to see distance
                              </span>
                            )}
                            <span className="text-[11px] text-slate-500 flex items-center gap-1">
                              <Clock className="w-3 h-3" /> ETA {stop.estimatedArrival}
                            </span>
                          </div>
                          {visit && (
                            <div className="mt-1.5 text-[11px] text-emerald-400 font-semibold flex items-center gap-1">
                              <CheckCircle className="w-3.5 h-3.5" />
                              {visit.action === 'arrived' ? 'Arrived' : 'Completed'} at {visit.time.toLocaleTimeString()}
                            </div>
                          )}
                        </div>
                        <button onClick={() => setExpanded(s => { const n = new Set(s); n.has(stop.ticketId) ? n.delete(stop.ticketId) : n.add(stop.ticketId); return n; })}
                          className="p-1 text-slate-600 hover:text-slate-400 shrink-0">
                          {isExp ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </div>
                      {isExp && (
                        <div className="ml-10 mt-2 text-[11px] text-slate-500 space-y-0.5 border-l border-slate-800 pl-3">
                          <div>Ticket: <span className="text-slate-300 font-mono">{stop.ticketId}</span></div>
                          <div>Est. duration: {stop.estimatedDurationMins} min</div>
                          <div>Coords: {stop.latitude?.toFixed(4)}, {stop.longitude?.toFixed(4)}</div>
                          <PocContacts centerName={stop.centerName} />
                        </div>
                      )}
                      {!isDone && (
                        <div className="ml-10">
                          <ActionButtons ticketId={stop.ticketId} centerName={stop.centerName} distM={dist} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {myPlan === null && employeeId.trim() && (
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4 text-center text-sm text-slate-500">
            <Wrench className="w-5 h-5 mx-auto mb-2 text-slate-600" />
            No route plan for <span className="font-mono text-slate-300">{employeeId}</span>. Check with dispatcher.
          </div>
        )}

        {/* ── Nearby Open Tickets ─────────────────────────────── */}
        {(isTracking || nearbyTickets.length > 0) && (
          <div className="bg-slate-900 rounded-2xl border border-slate-700 overflow-hidden">
            <button onClick={() => setShowNearby(s => !s)}
              className="w-full flex items-center justify-between px-4 py-3 text-left">
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4 text-slate-400" />
                <span className="text-sm font-bold text-slate-200">Nearby Open Tickets</span>
                {isTracking && (
                  <span className="text-[11px] bg-slate-800 text-slate-400 border border-slate-700 px-2 py-0.5 rounded-full font-semibold">
                    {NEARBY_RADIUS_KM} km radius
                  </span>
                )}
                {extraNearby.length > 0 && (
                  <span className="text-[11px] bg-amber-900/60 text-amber-300 border border-amber-800 px-2 py-0.5 rounded-full font-semibold">
                    {extraNearby.length} found
                  </span>
                )}
              </div>
              {showNearby ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
            </button>

            {showNearby && (
              <div className="divide-y divide-slate-800">
                {!isTracking && (
                  <div className="px-4 py-5 text-center text-sm text-slate-600">
                    <Navigation className="w-4 h-4 mx-auto mb-1 text-slate-700" />
                    Start GPS sharing to see nearby tickets
                  </div>
                )}
                {isTracking && extraNearby.length === 0 && (
                  <div className="px-4 py-5 text-center text-sm text-slate-600">
                    No open tickets within {NEARBY_RADIUS_KM} km of your location
                  </div>
                )}
                {extraNearby.map(({ ticket, center, distM }) => {
                  const visit     = visits.get(ticket.ticketId);
                  const nearby    = distM <= MARK_RADIUS_M;
                  const isDone    = visit?.action === 'completed';
                  const isExp     = expanded.has(ticket.ticketId);

                  return (
                    <div key={ticket.ticketId} className={`px-4 py-3 ${isDone ? 'opacity-60' : ''}`}>
                      <div className="flex items-start gap-3">
                        {/* Distance badge */}
                        <div className={`shrink-0 mt-0.5 rounded-lg px-2 py-1 text-[10px] font-bold text-center min-w-[48px]
                          ${nearby ? 'bg-blue-700 text-blue-100' : 'bg-slate-800 text-slate-400'}`}>
                          {fmtDist(distM)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-slate-100 truncate">{center.name.replace(/_D$/, '')}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-bold"
                              style={{ background: PRIORITY_BG[ticket.priority] ?? '#1e293b', color: PRIORITY_TEXT[ticket.priority] ?? '#94a3b8' }}>
                              {ticket.priority}
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">{ticket.status}</span>
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5">{ticket.vehicleNumber} · {ticket.issue}</div>
                          {ticket.assignedTechnicianName && (
                            <div className="text-[11px] text-slate-600 mt-0.5">Assigned: {ticket.assignedTechnicianName}</div>
                          )}
                          {nearby && !isDone && <div className="text-[11px] text-blue-400 font-semibold mt-0.5">You are nearby!</div>}
                          {visit && (
                            <div className="mt-1 text-[11px] text-emerald-400 font-semibold flex items-center gap-1">
                              <CheckCircle className="w-3.5 h-3.5" />
                              {visit.action === 'arrived' ? 'Arrived' : 'Completed'} at {visit.time.toLocaleTimeString()}
                            </div>
                          )}
                        </div>
                        <button onClick={() => setExpanded(s => { const n = new Set(s); n.has(ticket.ticketId) ? n.delete(ticket.ticketId) : n.add(ticket.ticketId); return n; })}
                          className="p-1 text-slate-600 hover:text-slate-400 shrink-0">
                          {isExp ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </div>
                      {isExp && (
                        <div className="ml-14 mt-2 text-[11px] text-slate-500 space-y-0.5 border-l border-slate-800 pl-3">
                          <div>Ticket: <span className="text-slate-300 font-mono">{ticket.ticketId}</span></div>
                          <div>Center coords: {center.latitude.toFixed(4)}, {center.longitude.toFixed(4)}</div>
                          <PocContacts centerName={ticket.centerName} />
                        </div>
                      )}
                      {!isDone && (
                        <div className="ml-14">
                          <ActionButtons ticketId={ticket.ticketId} centerName={ticket.centerName} distM={distM} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="text-center text-[11px] text-slate-700 space-y-0.5">
          <p>Location shared only with your dispatch team.</p>
          <p>Keep this page open while on-field.</p>
        </div>
      </div>
    </div>
  );
};
