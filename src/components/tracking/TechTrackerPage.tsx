/**
 * TechTrackerPage — mobile PWA for field technicians
 *
 * Accessed via: https://your-app.com/#/track
 * or: https://your-app.com/#/track?eid=EMP001
 *
 * Features:
 * - GPS watchPosition → upserts to Supabase tech_locations every ≥30 s
 * - Shows assigned stops from the saved route plan (matched by employee ID)
 * - Proximity check: stop within 200 m → "Mark Arrived" button activates
 * - Visit logged to Supabase visit_logs table with GPS proof
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { getRoutePlans, getTechnicians } from '../../services/storage';
import { TechnicianRoutePlan, RouteStop } from '../../types';
import {
  MapPin, Radio, CheckCircle, AlertCircle, Loader2,
  WifiOff, Navigation, Clock, Wrench, ChevronDown, ChevronUp,
} from 'lucide-react';

type TrackState = 'idle' | 'requesting' | 'tracking' | 'error' | 'no_gps' | 'no_db';

const MIN_UPSERT_INTERVAL_MS = 30_000;
const NEARBY_METERS = 200; // distance threshold to enable "Mark Arrived"

// ── Haversine distance (meters) ────────────────────────────────
function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Priority colour ────────────────────────────────────────────
const PRIORITY_BG: Record<string, string> = {
  CRITICAL: '#7f1d1d', HIGH: '#7c2d12', MEDIUM: '#713f12', LOW: '#14532d',
};
const PRIORITY_TEXT: Record<string, string> = {
  CRITICAL: '#fca5a5', HIGH: '#fb923c', MEDIUM: '#fbbf24', LOW: '#4ade80',
};

// ── Visit record (local) ───────────────────────────────────────
interface VisitRecord {
  ticketId: string;
  action: 'arrived' | 'completed';
  time: Date;
}

export const TechTrackerPage: React.FC = () => {
  const urlEid = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('eid') ?? '';

  const [employeeId, setEmployeeId]   = useState(urlEid.toUpperCase());
  const [techName, setTechName]       = useState('');
  const [state, setState]             = useState<TrackState>('idle');
  const [errorMsg, setErrorMsg]       = useState('');
  const [lastFix, setLastFix]         = useState<{ lat: number; lng: number; accuracy: number; ts: Date } | null>(null);
  const [upsertCount, setUpsertCount] = useState(0);

  // Route plan for this tech
  const [myPlan, setMyPlan]           = useState<TechnicianRoutePlan | null>(null);
  // Distance from current GPS to each stop (keyed by ticketId)
  const [distances, setDistances]     = useState<Map<string, number>>(new Map());
  // Visits logged this session
  const [visits, setVisits]           = useState<Map<string, VisitRecord>>(new Map());
  // Which stop cards are expanded
  const [expanded, setExpanded]       = useState<Set<string>>(new Set());
  // Marking in progress
  const [marking, setMarking]         = useState<string | null>(null);
  // Show stops section
  const [showStops, setShowStops]     = useState(true);

  const watchIdRef    = useRef<number | null>(null);
  const lastUpsertRef = useRef<number>(0);

  // ── Load route plan once employee ID is known ──────────────────
  useEffect(() => {
    if (!employeeId.trim()) { setMyPlan(null); return; }
    const eid = employeeId.trim().toUpperCase();
    const techs = getTechnicians();
    const tech  = techs.find(t => t.employeeId?.toUpperCase() === eid);
    if (!tech) { setMyPlan(null); return; }

    // Pre-fill name from master data if blank
    if (!techName && tech.name) setTechName(tech.name);

    const plans = getRoutePlans();
    const plan  = plans.find(p => p.technicianId === tech.id) ?? null;
    setMyPlan(plan);
  }, [employeeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Update distances on every GPS fix ─────────────────────────
  const updateDistances = useCallback((lat: number, lng: number) => {
    if (!myPlan) return;
    const m = new Map<string, number>();
    myPlan.stops.forEach(s => {
      if (s.latitude && s.longitude)
        m.set(s.ticketId, distanceM(lat, lng, s.latitude, s.longitude));
    });
    setDistances(m);
  }, [myPlan]);

  // ── Upsert location to Supabase ────────────────────────────────
  const upsertLocation = useCallback(async (lat: number, lng: number, accuracy: number) => {
    if (!supabase) { setState('no_db'); return; }
    const now = Date.now();
    if (now - lastUpsertRef.current < MIN_UPSERT_INTERVAL_MS) return;
    lastUpsertRef.current = now;

    const { error } = await supabase.from('tech_locations').upsert(
      {
        employee_id: employeeId.trim().toUpperCase(),
        tech_name: techName.trim() || employeeId.trim().toUpperCase(),
        lat, lng, accuracy,
        updated_at: new Date().toISOString(),
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

  // ── Start GPS ──────────────────────────────────────────────────
  const startTracking = useCallback(() => {
    if (!employeeId.trim()) { setErrorMsg('Please enter your Employee ID first.'); setState('error'); return; }
    if (!navigator.geolocation) { setState('no_gps'); return; }
    if (!supabase) { setState('no_db'); return; }

    setState('requesting');
    setErrorMsg('');
    lastUpsertRef.current = 0;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        const fix = { lat: latitude, lng: longitude, accuracy: Math.round(accuracy), ts: new Date() };
        setLastFix(fix);
        setState('tracking');
        updateDistances(latitude, longitude);
        void upsertLocation(latitude, longitude, accuracy);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setErrorMsg('Location permission denied. Please allow location access and try again.');
          setState('error');
          if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
        } else {
          console.warn('[Tracker] GPS warn', err.message);
        }
      },
      { enableHighAccuracy: true, maximumAge: 20_000, timeout: 30_000 }
    );
  }, [employeeId, upsertLocation, updateDistances]);

  // ── Stop GPS ───────────────────────────────────────────────────
  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setState('idle');
    setLastFix(null);
    setUpsertCount(0);
  }, []);

  useEffect(() => () => stopTracking(), [stopTracking]);

  // Keep-alive on tab focus
  useEffect(() => {
    const onVisible = () => {
      if (state === 'tracking' && lastFix) {
        lastUpsertRef.current = 0;
        void upsertLocation(lastFix.lat, lastFix.lng, lastFix.accuracy);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [state, lastFix, upsertLocation]);

  // ── Mark visit ─────────────────────────────────────────────────
  const markVisit = useCallback(async (stop: RouteStop, action: 'arrived' | 'completed') => {
    if (!lastFix || !supabase) return;
    setMarking(stop.ticketId);

    const { error } = await supabase.from('visit_logs').insert({
      employee_id: employeeId.trim().toUpperCase(),
      tech_name: techName.trim() || employeeId.trim().toUpperCase(),
      ticket_id: stop.ticketId,
      center_name: stop.centerName,
      lat: lastFix.lat,
      lng: lastFix.lng,
      accuracy: lastFix.accuracy,
      action,
      visited_at: new Date().toISOString(),
    });

    setMarking(null);

    if (error) {
      console.error('[Tracker] visit log error', error);
      setErrorMsg(`Visit log error: ${error.message}`);
    } else {
      setVisits(prev => {
        const m = new Map(prev);
        m.set(stop.ticketId, { ticketId: stop.ticketId, action, time: new Date() });
        return m;
      });
    }
  }, [lastFix, employeeId, techName]);

  // ── Helpers ────────────────────────────────────────────────────
  const isTracking   = state === 'tracking';
  const isRequesting = state === 'requesting';

  function fmtDist(m: number): string {
    if (m < 1000) return `${Math.round(m)} m`;
    return `${(m / 1000).toFixed(1)} km`;
  }

  const stopsSorted = myPlan
    ? [...myPlan.stops].sort((a, b) => a.stopOrder - b.stopOrder)
    : [];

  const pendingCount = stopsSorted.filter(s => {
    const v = visits.get(s.ticketId);
    return !v || v.action !== 'completed';
  }).length;

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-950 text-white pb-10"
         style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/* ── Header ─────────────────────────────────────────────── */}
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

      <div className="px-4 pt-4 space-y-4 max-w-md mx-auto">

        {/* ── ID + Name inputs ──────────────────────────────────── */}
        <div className="bg-slate-900 rounded-2xl border border-slate-700 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Employee ID</label>
              <input
                type="text" value={employeeId}
                onChange={e => setEmployeeId(e.target.value.toUpperCase())}
                placeholder="EMP001"
                disabled={isTracking || isRequesting}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-white placeholder-slate-600
                           focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-40"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Your Name</label>
              <input
                type="text" value={techName}
                onChange={e => setTechName(e.target.value)}
                placeholder="Rahul Sharma"
                disabled={isTracking || isRequesting}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600
                           focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-40"
              />
            </div>
          </div>

          {/* GPS status */}
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

          {state === 'requesting' && (
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

          {/* Start / Stop button */}
          {!isTracking ? (
            <button onClick={startTracking} disabled={isRequesting || !employeeId.trim()}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm
                         bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700
                         disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              {isRequesting
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Getting location…</>
                : <><Navigation className="w-4 h-4" /> Start Sharing Location</>}
            </button>
          ) : (
            <button onClick={stopTracking}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm
                         bg-red-700 hover:bg-red-600 active:bg-red-800 transition-colors">
              <WifiOff className="w-4 h-4" /> Stop Sharing Location
            </button>
          )}
        </div>

        {/* ── Assigned Stops ────────────────────────────────────── */}
        {myPlan && stopsSorted.length > 0 && (
          <div className="bg-slate-900 rounded-2xl border border-slate-700 overflow-hidden">

            {/* Section header */}
            <button
              onClick={() => setShowStops(s => !s)}
              className="w-full flex items-center justify-between px-4 py-3 text-left"
            >
              <div className="flex items-center gap-2">
                <Wrench className="w-4 h-4 text-slate-400" />
                <span className="text-sm font-bold text-slate-200">
                  My Stops
                </span>
                <span className="text-[11px] bg-slate-800 text-slate-400 border border-slate-700 px-2 py-0.5 rounded-full font-semibold">
                  {pendingCount} pending · {stopsSorted.length - pendingCount} done
                </span>
              </div>
              {showStops ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
            </button>

            {showStops && (
              <div className="divide-y divide-slate-800">
                {stopsSorted.map(stop => {
                  const dist    = distances.get(stop.ticketId);
                  const nearby  = dist !== undefined && dist <= NEARBY_METERS;
                  const visit   = visits.get(stop.ticketId);
                  const isMarking = marking === stop.ticketId;
                  const isDone  = visit?.action === 'completed'
                    || stop.ticketStatus === 'Resolved'
                    || stop.ticketStatus === 'Closed';
                  const isExpanded = expanded.has(stop.ticketId);

                  return (
                    <div key={stop.ticketId}
                      className={`px-4 py-3 transition-colors ${isDone ? 'opacity-60' : ''}`}>

                      {/* Stop header row */}
                      <div className="flex items-start gap-3">
                        {/* Stop number */}
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5
                          ${isDone ? 'bg-emerald-800 text-emerald-300' : nearby ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
                          {isDone ? '✓' : stop.stopOrder}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-slate-100 truncate">
                              {stop.centerName.replace(/_D$/, '')}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-bold"
                              style={{ background: PRIORITY_BG[stop.priority] ?? '#1e293b', color: PRIORITY_TEXT[stop.priority] ?? '#94a3b8' }}>
                              {stop.priority}
                            </span>
                          </div>

                          <div className="text-[11px] text-slate-400 mt-0.5">
                            {stop.vehicleNumber} · {stop.issue}
                          </div>

                          {/* Distance + ETA */}
                          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                            {dist !== undefined && (
                              <span className={`text-[11px] font-semibold flex items-center gap-1 ${nearby ? 'text-blue-400' : 'text-slate-500'}`}>
                                <MapPin className="w-3 h-3" />
                                {fmtDist(dist)} away
                                {nearby && <span className="text-blue-300">(nearby!)</span>}
                              </span>
                            )}
                            {!isTracking && (
                              <span className="text-[11px] text-slate-600 flex items-center gap-1">
                                <MapPin className="w-3 h-3" /> Start GPS to see distance
                              </span>
                            )}
                            <span className="text-[11px] text-slate-500 flex items-center gap-1">
                              <Clock className="w-3 h-3" /> ETA {stop.estimatedArrival}
                            </span>
                          </div>

                          {/* Visit confirmation */}
                          {visit && (
                            <div className="mt-1.5 text-[11px] text-emerald-400 font-semibold flex items-center gap-1">
                              <CheckCircle className="w-3.5 h-3.5" />
                              {visit.action === 'arrived' ? 'Arrived' : 'Completed'} at {visit.time.toLocaleTimeString()}
                            </div>
                          )}
                        </div>

                        {/* Expand toggle */}
                        <button
                          onClick={() => setExpanded(s => {
                            const n = new Set(s);
                            n.has(stop.ticketId) ? n.delete(stop.ticketId) : n.add(stop.ticketId);
                            return n;
                          })}
                          className="p-1 text-slate-600 hover:text-slate-400 shrink-0">
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </div>

                      {/* Expanded details */}
                      {isExpanded && (
                        <div className="ml-10 mt-2 text-[11px] text-slate-500 space-y-0.5 border-l border-slate-800 pl-3">
                          <div>Ticket: <span className="text-slate-300 font-mono">{stop.ticketId}</span></div>
                          <div>Est. duration: {stop.estimatedDurationMins} min</div>
                          <div>Coords: {stop.latitude?.toFixed(4)}, {stop.longitude?.toFixed(4)}</div>
                        </div>
                      )}

                      {/* Action buttons */}
                      {!isDone && isTracking && (
                        <div className="ml-10 mt-2 flex gap-2">
                          {/* Arrived */}
                          {!visit && (
                            <button
                              onClick={() => void markVisit(stop, 'arrived')}
                              disabled={!nearby || isMarking}
                              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors
                                ${nearby
                                  ? 'bg-blue-600 hover:bg-blue-500 text-white'
                                  : 'bg-slate-800 text-slate-600 cursor-not-allowed'}`}
                            >
                              {isMarking
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <MapPin className="w-3.5 h-3.5" />}
                              {nearby ? 'Mark Arrived' : `${dist !== undefined ? fmtDist(dist) : '—'} away`}
                            </button>
                          )}
                          {/* Completed */}
                          <button
                            onClick={() => void markVisit(stop, 'completed')}
                            disabled={!nearby || isMarking}
                            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors
                              ${nearby
                                ? 'bg-emerald-700 hover:bg-emerald-600 text-white'
                                : 'bg-slate-800 text-slate-600 cursor-not-allowed'}`}
                          >
                            {isMarking
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <CheckCircle className="w-3.5 h-3.5" />}
                            Mark Done
                          </button>
                        </div>
                      )}

                      {/* Not tracking hint */}
                      {!isDone && !isTracking && (
                        <div className="ml-10 mt-2 text-[11px] text-slate-600">
                          Start GPS sharing to enable visit marking
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* No route plan assigned */}
        {myPlan === null && employeeId.trim() && (
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4 text-center text-sm text-slate-500">
            <Wrench className="w-5 h-5 mx-auto mb-2 text-slate-600" />
            No route plan assigned for <span className="font-mono text-slate-300">{employeeId}</span>.
            <div className="text-xs mt-1">Check with your dispatcher.</div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center text-[11px] text-slate-700 space-y-0.5">
          <p>Location shared only with your dispatch team.</p>
          <p>Keep this page open while on-field.</p>
        </div>
      </div>
    </div>
  );
};
