import React, { useState, useRef, useEffect } from 'react';
import { TechnicianRoutePlan, RouteStop } from '../../types';
import {
  getTechnicians, getCenters, getTickets, getAttendance,
  saveRoutePlans, saveTickets, getRoutePlans,
} from '../../services/storage';
import { planTodayRoutes, calculateDistanceKm } from '../../services/routeOptimizer';
import Groq from 'groq-sdk';
import {
  BrainCircuit, Zap, MapPin, Clock, AlertCircle, CheckCircle2,
  Loader2, ChevronDown, ChevronUp, RotateCcw, Download,
  Navigation, Sparkles, User, AlertTriangle, Info, Send,
} from 'lucide-react';

// ── resolve Groq key (localStorage > env var) ─────────────────────
function getGroqClient(): Groq {
  let key = '';
  try { key = localStorage.getItem('fo_groq_key') || ''; } catch {}
  if (!key) key = (import.meta.env.VITE_GROQ_API_KEY as string) || '';
  if (!key) throw new Error('Groq API key not set. Go to AI Assistant tab → ⚙ Settings to add your key.');
  return new Groq({ apiKey: key, dangerouslyAllowBrowser: true });
}

// ── Priority colours ──────────────────────────────────────────────
const PRIO_CLASS: Record<string, string> = {
  CRITICAL: 'bg-rose-100 text-rose-700 border-rose-200',
  HIGH:     'bg-orange-100 text-orange-700 border-orange-200',
  MEDIUM:   'bg-amber-100 text-amber-700 border-amber-200',
  LOW:      'bg-slate-100 text-slate-600 border-slate-200',
};
const TECH_COLORS = [
  '#0E6B6E','#2563EB','#7C3AED','#DB2777','#D97706',
  '#16A34A','#DC2626','#0891B2','#9333EA','#EA580C',
  '#065F46','#1D4ED8','#6D28D9','#BE185D','#B45309',
];

// ── Build a rich context payload for Groq ────────────────────────
function buildRouteContext(basePlans: TechnicianRoutePlan[]) {
  const technicians = getTechnicians();
  const centers     = getCenters();
  const tickets     = getTickets();
  const attendance  = getAttendance();
  const today       = new Date().toISOString().split('T')[0];

  const centerMap = new Map(centers.map(c => [c.name.trim().toLowerCase(), c]));

  const activeTechs = technicians.filter(t =>
    t.status === 'Active' &&
    t.startingLatitude != null && t.startingLongitude != null
  );

  const presentTechs = activeTechs.filter(t => {
    const att = attendance.find(a => a.employeeId.toUpperCase() === t.employeeId.toUpperCase() && a.date === today);
    return !att || att.status === 'Present' || att.status === 'Half-Day';
  });

  const openTickets = tickets.filter(t => t.status !== 'Resolved' && t.status !== 'Closed');
  const criticals   = openTickets.filter(t => t.priority === 'CRITICAL');
  const unassigned  = openTickets.filter(t =>
    !basePlans.some(p => p.stops.some(s => s.ticketId === t.ticketId))
  );

  const techDetails = presentTechs.map(t => ({
    id: t.id, name: t.name, empId: t.employeeId,
    city: t.city, zone: t.zone, specialisation: t.specialisation,
    startLat: t.startingLatitude, startLng: t.startingLongitude,
  }));

  const ticketDetails = openTickets.slice(0, 40).map(t => {
    const c = centerMap.get(t.centerName.trim().toLowerCase());
    return {
      ticketId: t.ticketId, vehicle: t.vehicleNumber,
      center: t.centerName, issue: t.issue,
      category: t.category, issueType: t.issueType,
      priority: t.priority, status: t.status,
      lat: c?.latitude, lng: c?.longitude,
    };
  });

  const baseRouteSummary = basePlans.map(p => ({
    tech: p.technicianName, empId: p.employeeId,
    stops: p.stops.map(s => ({ order: s.stopOrder, ticket: s.ticketId, center: s.centerName, priority: s.priority, eta: s.estimatedArrival, issue: s.issue })),
    totalKm: p.totalDistanceKm, totalMins: p.totalEstimatedMins,
  }));

  return { today, presentTechs: techDetails, openTickets: ticketDetails, criticals: criticals.length, unassigned: unassigned.length, baseRoutes: baseRouteSummary };
}

// ── Parse Groq JSON response into route plans ─────────────────────
function parseGroqRoutes(jsonText: string, basePlans: TechnicianRoutePlan[]): TechnicianRoutePlan[] | null {
  try {
    // Extract JSON block if wrapped in markdown
    const match = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/) || jsonText.match(/(\[[\s\S]*\])/);
    const raw = match ? match[1].trim() : jsonText.trim();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;

    const technicians = getTechnicians();
    const centers = getCenters();
    const centerMap = new Map(centers.map(c => [c.name.trim().toLowerCase(), c]));
    const techMap = new Map(technicians.map(t => [t.employeeId.toUpperCase(), t]));

    return parsed.map((p: any, idx: number) => {
      const tech = techMap.get((p.empId || p.employeeId || '').toUpperCase());
      const base = basePlans.find(b => b.employeeId.toUpperCase() === (p.empId || p.employeeId || '').toUpperCase()) || basePlans[idx];

      const stops: RouteStop[] = (p.stops || []).map((s: any, si: number) => {
        const center = centerMap.get((s.center || s.centerName || '').trim().toLowerCase());
        const prevStop = si === 0 ? null : (p.stops[si - 1] as any);
        const prevLat  = si === 0 ? (tech?.startingLatitude  ?? base?.startLat ?? 28.6) : (centerMap.get((prevStop.center || '').trim().toLowerCase())?.latitude ?? 28.6);
        const prevLng  = si === 0 ? (tech?.startingLongitude ?? base?.startLng ?? 77.2) : (centerMap.get((prevStop.center || '').trim().toLowerCase())?.longitude ?? 77.2);
        const dist     = center ? calculateDistanceKm(prevLat, prevLng, center.latitude, center.longitude) : 5;
        const elapsed  = 30 + si * 60 + Math.round(dist * 2.5);
        const h = Math.floor(9 + elapsed / 60), m = elapsed % 60;

        return {
          stopOrder: si + 1,
          ticketId:  s.ticketId || s.ticket || `TKT-${si}`,
          centerName: s.center || s.centerName || 'Unknown',
          vehicleNumber: s.vehicle || s.vehicleNumber || '',
          issue: s.issue || '',
          priority: s.priority || 'MEDIUM',
          latitude:  center?.latitude  ?? prevLat,
          longitude: center?.longitude ?? prevLng,
          estimatedArrival: s.eta || `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`,
          estimatedDurationMins: s.priority === 'CRITICAL' ? 60 : 45,
        } as RouteStop;
      });

      // Recalculate distance
      let totalDist = 0;
      let curLat = tech?.startingLatitude ?? base?.startLat ?? 28.6;
      let curLng = tech?.startingLongitude ?? base?.startLng ?? 77.2;
      stops.forEach(s => {
        totalDist += calculateDistanceKm(curLat, curLng, s.latitude, s.longitude);
        curLat = s.latitude; curLng = s.longitude;
      });

      return {
        technicianId:   tech?.id   ?? base?.technicianId   ?? `ai-tech-${idx}`,
        technicianName: tech?.name ?? base?.technicianName ?? p.tech ?? p.name ?? `Tech ${idx+1}`,
        employeeId:     tech?.employeeId ?? base?.employeeId ?? p.empId ?? p.employeeId ?? '',
        startLat: tech?.startingLatitude  ?? base?.startLat ?? 28.6,
        startLng: tech?.startingLongitude ?? base?.startLng ?? 77.2,
        defaultDc: tech?.defaultDc ?? base?.defaultDc ?? '',
        stops,
        totalDistanceKm: Math.round(totalDist * 10) / 10,
        totalEstimatedMins: stops.reduce((a, s) => a + s.estimatedDurationMins, 0) + Math.round(totalDist * 2.5),
        status: 'Draft' as const,
      } as TechnicianRoutePlan;
    }).filter((p: TechnicianRoutePlan) => p.stops.length > 0);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────
export const AiRoutePlannerPage: React.FC = () => {
  const [phase, setPhase]           = useState<'idle' | 'base' | 'ai' | 'done' | 'error'>('idle');
  const [basePlans, setBasePlans]   = useState<TechnicianRoutePlan[]>([]);
  const [aiPlans, setAiPlans]       = useState<TechnicianRoutePlan[]>([]);
  const [activeView, setActiveView] = useState<'ai' | 'base'>('ai');
  const [streamLog, setStreamLog]   = useState<string>('');
  const [reasoning, setReasoning]   = useState<string>('');
  const [error, setError]           = useState<string>('');
  const [expanded, setExpanded]     = useState<Set<string>>(new Set());
  const [confirmed, setConfirmed]   = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [streamLog]);

  const displayed = activeView === 'ai' ? aiPlans : basePlans;

  const toggleExpand = (id: string) =>
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // ── Step 1: generate base plan ───────────────────────────────────
  async function handleOptimise() {
    setPhase('base');
    setError('');
    setStreamLog('');
    setReasoning('');
    setConfirmed(false);
    setAiPlans([]);

    await new Promise(r => setTimeout(r, 200));
    const base = planTodayRoutes();
    setBasePlans(base);

    if (base.length === 0) {
      setError('No routable tickets or available technicians found. Import tickets and ensure technicians have starting coordinates.');
      setPhase('error');
      return;
    }

    setPhase('ai');
    const ctx = buildRouteContext(base);

    const systemPrompt = `You are an expert field operations dispatcher for a Delhi NCR electric vehicle (EV) fleet.
You will receive a base route plan generated by a nearest-neighbour algorithm and full fleet context.
Your job: produce a BETTER optimised route plan considering:
1. Technician specialisation vs ticket category (Battery Specialist → battery issues, Electrical → electrical issues etc.)
2. Zone clustering — minimise cross-zone travel, keep techs within their city
3. Priority handling — CRITICAL tickets must be first stop for the nearest qualified tech
4. Traffic awareness — Delhi-Gurgaon corridor (NH48) is congested 08-10am; Noida-Delhi via Mayur Vihar is congested 09-11am; Faridabad-Delhi via Mathura Rd congested 08-10am. Adjust ETAs with a 1.5x multiplier for those corridors during those hours.
5. Skill match — prefer same-specialisation tech; if none available, use nearest General Fleet
6. Avoid overloading — max 5 stops/tech; balance workload
7. Return efficiency — prefer routes that end near the tech's start zone

OUTPUT FORMAT (strict JSON array, no prose outside the block):
\`\`\`json
[
  {
    "empId": "NCR-1101",
    "tech": "Mohit",
    "stops": [
      { "ticketId": "INC001", "center": "Delhi_Badharpur_D", "vehicle": "DL1VW2345", "issue": "Battery not charging", "priority": "CRITICAL", "eta": "09:30" },
      ...
    ]
  },
  ...
]
\`\`\`

After the JSON block, write a REASONING section (plain text, max 300 words) explaining key decisions: why you re-ordered stops, which skill matches you made, which traffic corridors you avoided, and any escalation flags.`;

    const userMsg = `FLEET CONTEXT:
Today: ${ctx.today}
Present technicians: ${ctx.presentTechs.length}
Open tickets: ${ctx.openTickets.length} (${ctx.criticals} CRITICAL, ${ctx.unassigned} unassigned)

TECHNICIAN DETAILS:
${ctx.presentTechs.map(t => `- ${t.name} (${t.empId}) | ${t.city} | Zone: ${t.zone} | Spec: ${t.specialisation} | Start: [${t.startLat?.toFixed(4)}, ${t.startLng?.toFixed(4)}]`).join('\n')}

OPEN TICKETS (top 40):
${ctx.openTickets.map(t => `- [${t.ticketId}] ${t.priority} | ${t.center} | ${t.vehicle} | ${t.issue} | ${t.category ?? ''} | [${t.lat?.toFixed(4)},${t.lng?.toFixed(4)}]`).join('\n')}

BASE ALGORITHM PLAN:
${ctx.baseRoutes.map(r => `${r.tech} (${r.empId}): ${r.stops.map(s => `${s.order}.${s.ticket}@${s.center}(${s.priority},${s.eta})`).join(' → ')} | ${r.totalKm}km ${r.totalMins}min`).join('\n')}

${customPrompt ? `ADDITIONAL INSTRUCTIONS FROM DISPATCHER:\n${customPrompt}` : ''}

Now produce the optimised plan.`;

    // Stream via Gemini (primary) → Groq fallback
    let fullText = '';
    let usedProvider = 'Gemini';
    try {
      // Try Gemini first
      let geminiKey = '';
      try { geminiKey = localStorage.getItem('fo_gemini_key') || ''; } catch {}
      if (!geminiKey) geminiKey = (import.meta.env.VITE_GEMINI_API_KEY as string) || '';

      if (geminiKey) {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse&key=${geminiKey}`;
        const geminiBody = {
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userMsg }] }],
          generationConfig: { maxOutputTokens: 2048, temperature: 0.2 },
        };
        const res = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(geminiBody),
        });
        if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') break;
            try {
              const json = JSON.parse(data);
              const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
              fullText += text;
              setStreamLog(fullText);
            } catch {}
          }
        }
      } else {
        throw new Error('no-gemini-key');
      }
    } catch (geminiErr: any) {
      // Fallback to Groq
      usedProvider = 'Groq';
      fullText = '';
      try {
        const client = getGroqClient();
        const stream = await client.chat.completions.create({
          model: 'llama3-70b-8192',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userMsg },
          ],
          stream: true,
          max_tokens: 2048,
          temperature: 0.2,
        });
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content || '';
          fullText += delta;
          setStreamLog(fullText);
        }
      } catch (groqErr: any) {
        setError(`Gemini: ${geminiErr?.message} | Groq: ${groqErr?.message}`);
        setPhase('error');
        return;
      }
    }
    void usedProvider;

    // Parse routes + extract reasoning
    const routes = parseGroqRoutes(fullText, base);
    const reasoningMatch = fullText.match(/REASONING[\s\S]*?(?=\n\n|\n#|$)/i);
    setReasoning(reasoningMatch ? reasoningMatch[0] : '');

    if (!routes || routes.length === 0) {
      setError('Groq returned a plan but it could not be parsed into routes. Raw response is shown in the log below.');
      setPhase('error');
      return;
    }

    setAiPlans(routes);
    setPhase('done');
    setActiveView('ai');
  }

  // ── Confirm: write routes + ticket assignments ───────────────────
  function handleConfirm() {
    const plans = aiPlans.length ? aiPlans : basePlans;
    const confirmed = plans.map(p => ({ ...p, status: 'Confirmed' as const }));
    saveRoutePlans(confirmed);

    const allTickets = getTickets();
    const updated = allTickets.map(tk => {
      for (const plan of plans) {
        const stop = plan.stops.find(s => s.ticketId === tk.ticketId);
        if (stop) {
          return { ...tk, assignedTechnicianId: plan.technicianId, assignedTechnicianName: plan.technicianName, status: 'Assigned' as const, scheduledSlot: stop.estimatedArrival, updatedAt: new Date().toISOString() };
        }
      }
      return tk;
    });
    saveTickets(updated);
    setConfirmed(true);
  }

  // ── CSV export ────────────────────────────────────────────────────
  function handleExport() {
    const plans = activeView === 'ai' ? aiPlans : basePlans;
    const rows = ['Technician,EmpID,Stop,TicketID,Center,Vehicle,Issue,Priority,ETA,Distance(km)'];
    plans.forEach(p => p.stops.forEach(s =>
      rows.push(`"${p.technicianName}","${p.employeeId}",${s.stopOrder},"${s.ticketId}","${s.centerName}","${s.vehicleNumber}","${s.issue}",${s.priority},${s.estimatedArrival},${p.totalDistanceKm}`)
    ));
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `ai_routes_${new Date().toISOString().split('T')[0]}.csv`; a.click();
  }

  // ── Stats ─────────────────────────────────────────────────────────
  const totalStops   = displayed.reduce((a, p) => a + p.stops.length, 0);
  const totalKm      = Math.round(displayed.reduce((a, p) => a + p.totalDistanceKm, 0) * 10) / 10;
  const criticalStops = displayed.reduce((a, p) => a + p.stops.filter(s => s.priority === 'CRITICAL').length, 0);
  const avgStops     = displayed.length ? (totalStops / displayed.length).toFixed(1) : '0';

  return (
    <div className="space-y-5">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <BrainCircuit className="w-5 h-5 text-teal-600" />
            AI Route Optimiser
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Groq LLM refines the base nearest-neighbour plan using skill matching, zone clustering, and Delhi traffic awareness.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {phase === 'done' && (
            <>
              <button onClick={handleExport} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg border border-slate-200 transition-colors">
                <Download className="w-3.5 h-3.5" /> Export CSV
              </button>
              {!confirmed ? (
                <button onClick={handleConfirm} className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors shadow-xs">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Confirm & Save Routes
                </button>
              ) : (
                <span className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-emerald-100 text-emerald-700 rounded-lg border border-emerald-200">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Routes Saved
                </span>
              )}
            </>
          )}
          <button
            onClick={handleOptimise}
            disabled={phase === 'base' || phase === 'ai'}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-lg transition-colors shadow-xs"
          >
            {phase === 'base' ? <><Loader2 className="w-4 h-4 animate-spin" /> Building Base Plan…</> :
             phase === 'ai'   ? <><Loader2 className="w-4 h-4 animate-spin" /> Groq Optimising…</> :
             <><Sparkles className="w-4 h-4" /> {phase === 'done' ? 'Re-Optimise' : 'AI Optimise Routes'}</>}
          </button>
        </div>
      </div>

      {/* ── Custom instructions ──────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex items-start gap-2 shadow-xs">
        <Info className="w-4 h-4 text-teal-500 shrink-0 mt-1" />
        <div className="flex-1">
          <p className="text-[11px] font-semibold text-slate-700 mb-1">Optional dispatcher instructions</p>
          <div className="flex gap-2">
            <input
              value={customPrompt}
              onChange={e => setCustomPrompt(e.target.value)}
              placeholder="e.g. Prioritise Gurgaon today. Abhishek is only available till 2pm."
              className="flex-1 text-xs px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-500/20 text-slate-800 placeholder:text-slate-400"
            />
            <button
              onClick={handleOptimise}
              disabled={phase === 'base' || phase === 'ai'}
              className="px-3 py-2 text-xs font-bold bg-teal-600 hover:bg-teal-700 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Error ────────────────────────────────────────────────────── */}
      {phase === 'error' && (
        <div className="flex items-start gap-2.5 p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
          <div>
            <strong>Error:</strong> {error}
            {error.includes('API key') && (
              <span className="ml-1">→ Go to <strong>AI Assistant</strong> tab → ⚙ Settings to add your Groq key.</span>
            )}
          </div>
        </div>
      )}

      {/* ── Stats bar ────────────────────────────────────────────────── */}
      {phase === 'done' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Technicians Routed', value: displayed.length, color: 'text-teal-700' },
            { label: 'Total Stops',         value: totalStops,        color: 'text-blue-700' },
            { label: 'Critical Assigned',   value: criticalStops,     color: 'text-rose-700' },
            { label: 'Fleet Distance',       value: `${totalKm} km`,  color: 'text-slate-800' },
          ].map(s => (
            <div key={s.label} className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs">
              <div className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">{s.label}</div>
              <div className={`text-xl font-bold mt-0.5 ${s.color}`} style={{ fontFamily: 'JetBrains Mono, monospace' }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── View toggle ──────────────────────────────────────────────── */}
      {phase === 'done' && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500">View:</span>
          {[
            { key: 'ai',   label: '✨ AI Optimised', color: 'bg-teal-600 text-white' },
            { key: 'base', label: '📐 Base Algorithm', color: 'bg-slate-700 text-white' },
          ].map(v => (
            <button
              key={v.key}
              onClick={() => setActiveView(v.key as 'ai' | 'base')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${activeView === v.key ? v.color : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              {v.label}
            </button>
          ))}
          {aiPlans.length > 0 && basePlans.length > 0 && (
            <span className="ml-auto text-[11px] text-slate-500">
              AI: {Math.round(aiPlans.reduce((a,p) => a+p.totalDistanceKm, 0)*10)/10} km &nbsp;|&nbsp; Base: {Math.round(basePlans.reduce((a,p) => a+p.totalDistanceKm, 0)*10)/10} km
              &nbsp;→&nbsp;
              <span className="text-emerald-700 font-semibold">
                {Math.round((1 - aiPlans.reduce((a,p) => a+p.totalDistanceKm, 0) / (basePlans.reduce((a,p) => a+p.totalDistanceKm, 0) || 1)) * 100)}% saved
              </span>
            </span>
          )}
        </div>
      )}

      {/* ── Route cards ──────────────────────────────────────────────── */}
      {phase === 'done' && displayed.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {displayed.map((plan, idx) => {
            const isExp = expanded.has(plan.technicianId);
            const color = TECH_COLORS[idx % TECH_COLORS.length];
            return (
              <div key={plan.technicianId} className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                {/* Card header */}
                <div
                  className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors"
                  onClick={() => toggleExpand(plan.technicianId)}
                  style={{ borderLeft: `4px solid ${color}` }}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold" style={{ background: color }}>
                      {plan.technicianName.charAt(0)}
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-900">{plan.technicianName}</div>
                      <div className="text-[10px] text-slate-500 font-mono">{plan.employeeId}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-xs font-bold text-slate-900" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{plan.stops.length} stops · {plan.totalDistanceKm} km</div>
                      <div className="text-[10px] text-slate-500">~{Math.round(plan.totalEstimatedMins / 60)}h {plan.totalEstimatedMins % 60}m</div>
                    </div>
                    {isExp ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                  </div>
                </div>

                {/* Stop list */}
                {isExp && (
                  <div className="border-t border-slate-100 divide-y divide-slate-50">
                    {plan.stops.map(stop => (
                      <div key={stop.stopOrder} className="flex items-start gap-3 px-4 py-2.5">
                        <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0 mt-0.5" style={{ background: color }}>
                          {stop.stopOrder}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-semibold text-slate-900 truncate">{stop.centerName}</span>
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${PRIO_CLASS[stop.priority] || PRIO_CLASS.LOW}`}>{stop.priority}</span>
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5 truncate">{stop.vehicleNumber} · {stop.issue}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-xs font-mono font-bold text-teal-700">{stop.estimatedArrival}</div>
                          <div className="text-[10px] text-slate-400">{stop.estimatedDurationMins}m</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── AI Reasoning ─────────────────────────────────────────────── */}
      {phase === 'done' && reasoning && (
        <div className="bg-teal-50 border border-teal-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <BrainCircuit className="w-4 h-4 text-teal-700" />
            <span className="text-xs font-bold text-teal-800">AI Reasoning</span>
          </div>
          <p className="text-xs text-teal-900 leading-relaxed whitespace-pre-wrap">{reasoning}</p>
        </div>
      )}

      {/* ── Stream log (while running) ────────────────────────────────── */}
      {(phase === 'ai' || (phase === 'error' && streamLog)) && (
        <div className="bg-slate-900 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-700">
            <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
            <span className="text-xs font-mono text-slate-400">Groq stream · llama-3.3-70b-versatile</span>
          </div>
          <div ref={logRef} className="px-4 py-3 text-[11px] font-mono text-slate-300 max-h-48 overflow-y-auto leading-relaxed whitespace-pre-wrap">
            {streamLog || 'Waiting for first token…'}
          </div>
        </div>
      )}

      {/* ── Idle state ───────────────────────────────────────────────── */}
      {phase === 'idle' && (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-4">
          <div className="w-14 h-14 bg-teal-50 rounded-2xl flex items-center justify-center mx-auto">
            <BrainCircuit className="w-7 h-7 text-teal-600" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">AI Route Optimiser</h3>
            <p className="text-xs text-slate-500 mt-1.5 max-w-sm mx-auto leading-relaxed">
              Clicks <strong>AI Optimise Routes</strong> to run the base nearest-neighbour algorithm, then send it to Groq for skill-aware, traffic-aware refinement.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-lg mx-auto text-left">
            {[
              { icon: <Navigation className="w-4 h-4 text-blue-600" />, title: 'Base Plan', desc: 'Nearest-neighbour greedy, priority-sorted' },
              { icon: <BrainCircuit className="w-4 h-4 text-teal-600" />, title: 'Groq Refinement', desc: 'Skill match, zone clustering, traffic corridors' },
              { icon: <CheckCircle2 className="w-4 h-4 text-emerald-600" />, title: 'Confirm & Save', desc: 'Writes routes + ticket assignments to storage' },
            ].map(f => (
              <div key={f.title} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                {f.icon}
                <div className="text-xs font-bold text-slate-800 mt-1.5">{f.title}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
