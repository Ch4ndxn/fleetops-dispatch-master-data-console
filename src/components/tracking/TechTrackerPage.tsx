/**
 * TechTrackerPage — mobile PWA for field technicians
 *
 * Accessed via: https://your-app.com/#/track
 * or: https://your-app.com/#/track?eid=EMP001
 *
 * - Tech enters their employee ID (pre-filled from URL param)
 * - Browser GPS watchPosition fires every ~30 s
 * - Each fix upserts to Supabase tech_locations table
 * - Dispatcher sees live dots on LiveTrackingPage
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { MapPin, Radio, CheckCircle, AlertCircle, Loader2, WifiOff, Navigation } from 'lucide-react';

type TrackState = 'idle' | 'requesting' | 'tracking' | 'error' | 'no_gps' | 'no_db';

const MIN_UPSERT_INTERVAL_MS = 30_000; // don't hit Supabase more than once per 30 s

export const TechTrackerPage: React.FC = () => {
  // Pre-fill employee ID from URL hash param: #/track?eid=EMP001
  const urlEid = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('eid') ?? '';

  const [employeeId, setEmployeeId] = useState(urlEid.toUpperCase());
  const [techName, setTechName] = useState('');
  const [state, setState] = useState<TrackState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [lastFix, setLastFix] = useState<{ lat: number; lng: number; accuracy: number; ts: Date } | null>(null);
  const [upsertCount, setUpsertCount] = useState(0);

  const watchIdRef = useRef<number | null>(null);
  const lastUpsertRef = useRef<number>(0);

  // ── Upsert to Supabase ──────────────────────────────────────────
  const upsertLocation = useCallback(
    async (lat: number, lng: number, accuracy: number) => {
      if (!supabase) { setState('no_db'); return; }

      const now = Date.now();
      if (now - lastUpsertRef.current < MIN_UPSERT_INTERVAL_MS) return; // debounce
      lastUpsertRef.current = now;

      const { error } = await supabase.from('tech_locations').upsert(
        {
          employee_id: employeeId.trim().toUpperCase(),
          tech_name: techName.trim() || employeeId.trim().toUpperCase(),
          lat,
          lng,
          accuracy,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'employee_id' }
      );

      if (error) {
        console.error('[Tracker] upsert error', error);
        setErrorMsg(error.message);
        // Don't stop tracking — might be transient
      } else {
        setUpsertCount(c => c + 1);
      }
    },
    [employeeId, techName]
  );

  // ── Start GPS watch ─────────────────────────────────────────────
  const startTracking = useCallback(() => {
    if (!employeeId.trim()) {
      setErrorMsg('Please enter your Employee ID first.');
      setState('error');
      return;
    }
    if (!navigator.geolocation) {
      setState('no_gps');
      return;
    }
    if (!supabase) {
      setState('no_db');
      return;
    }

    setState('requesting');
    setErrorMsg('');

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        setLastFix({ lat: latitude, lng: longitude, accuracy: Math.round(accuracy), ts: new Date() });
        setState('tracking');
        void upsertLocation(latitude, longitude, accuracy);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setErrorMsg('Location permission denied. Please allow location access and try again.');
          setState('error');
          stopTracking();
        } else {
          // TIMEOUT / UNAVAILABLE — keep watching
          console.warn('[Tracker] GPS error', err.message);
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 20_000,
        timeout: 30_000,
      }
    );
  }, [employeeId, upsertLocation]);

  // ── Stop GPS watch ──────────────────────────────────────────────
  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setState('idle');
    setLastFix(null);
    setUpsertCount(0);
  }, []);

  // Cleanup on unmount
  useEffect(() => () => stopTracking(), [stopTracking]);

  // ── Keep-alive: also re-upsert on visibilitychange (background tab returns) ──
  useEffect(() => {
    const onVisible = () => {
      if (state === 'tracking' && lastFix) {
        lastUpsertRef.current = 0; // force immediate upsert on resume
        void upsertLocation(lastFix.lat, lastFix.lng, lastFix.accuracy);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [state, lastFix, upsertLocation]);

  // ── Render ──────────────────────────────────────────────────────
  const isTracking = state === 'tracking';
  const isRequesting = state === 'requesting';

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-5 gap-6"
         style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/* Header */}
      <div className="text-center">
        <div className="flex items-center justify-center gap-2 mb-1">
          <Radio className={`w-6 h-6 ${isTracking ? 'text-emerald-400 animate-pulse' : 'text-slate-400'}`} />
          <span className="text-lg font-bold tracking-tight">FleetOps Live Tracking</span>
        </div>
        <p className="text-xs text-slate-400">Field Technician GPS</p>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm bg-slate-900 rounded-2xl border border-slate-700 p-6 space-y-5 shadow-2xl">

        {/* Employee ID */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Employee ID</label>
          <input
            type="text"
            value={employeeId}
            onChange={e => setEmployeeId(e.target.value.toUpperCase())}
            placeholder="e.g. EMP001"
            disabled={isTracking || isRequesting}
            className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 text-sm font-mono text-white placeholder-slate-500
                       focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent
                       disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>

        {/* Tech Name (optional) */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Your Name <span className="text-slate-600 normal-case">(optional)</span></label>
          <input
            type="text"
            value={techName}
            onChange={e => setTechName(e.target.value)}
            placeholder="e.g. Rahul Sharma"
            disabled={isTracking || isRequesting}
            className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500
                       focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent
                       disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>

        {/* Status display */}
        {state === 'tracking' && lastFix && (
          <div className="bg-emerald-950 border border-emerald-700 rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-sm font-semibold text-emerald-300">Tracking Active</span>
            </div>
            <div className="text-xs text-emerald-400 space-y-0.5 font-mono">
              <div>Lat: {lastFix.lat.toFixed(5)}</div>
              <div>Lng: {lastFix.lng.toFixed(5)}</div>
              <div>Accuracy: ±{lastFix.accuracy} m</div>
              <div>Last sent: {lastFix.ts.toLocaleTimeString()}</div>
              <div>Updates sent: {upsertCount}</div>
            </div>
          </div>
        )}

        {state === 'requesting' && (
          <div className="bg-blue-950 border border-blue-700 rounded-xl p-4 flex items-center gap-3">
            <Loader2 className="w-4 h-4 text-blue-400 animate-spin shrink-0" />
            <span className="text-sm text-blue-300">Acquiring GPS signal…</span>
          </div>
        )}

        {(state === 'error' || state === 'no_gps' || state === 'no_db') && (
          <div className="bg-red-950 border border-red-700 rounded-xl p-4 flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <div className="text-sm text-red-300">
              {state === 'no_gps' && 'GPS is not available on this device.'}
              {state === 'no_db' && 'Database not configured. Contact your dispatcher.'}
              {state === 'error' && (errorMsg || 'An error occurred.')}
            </div>
          </div>
        )}

        {/* Action button */}
        {!isTracking ? (
          <button
            onClick={startTracking}
            disabled={isRequesting || !employeeId.trim()}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-semibold text-sm
                       bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700
                       disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isRequesting
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Getting location…</>
              : <><Navigation className="w-4 h-4" /> Start Sharing Location</>}
          </button>
        ) : (
          <button
            onClick={stopTracking}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-semibold text-sm
                       bg-red-700 hover:bg-red-600 active:bg-red-800 transition-colors"
          >
            <WifiOff className="w-4 h-4" /> Stop Sharing Location
          </button>
        )}
      </div>

      {/* Footer notes */}
      <div className="text-center text-xs text-slate-600 max-w-xs space-y-1">
        <p>Your location is shared only with your dispatch team.</p>
        <p>Keep this page open while on-field. Your battery-saving mode may pause GPS — tap the screen if updates stop.</p>
      </div>
    </div>
  );
};
