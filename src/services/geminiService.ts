import { getTechnicians, getTickets, getCenters, getAttendance } from './storage';

function resolveApiKey(): string {
  try {
    const stored = localStorage.getItem('fo_gemini_key');
    if (stored && stored.trim()) return stored.trim();
  } catch {}
  const envKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
  if (envKey && envKey.trim()) return envKey.trim();
  throw new Error('Gemini API key not set. Click ⚙ Settings to add your key.');
}

function buildFleetContext(): string {
  const technicians = getTechnicians();
  const tickets = getTickets();
  const centers = getCenters();
  const attendance = getAttendance();
  const today = new Date().toISOString().split('T')[0];

  const activeTechs = technicians.filter(t => t.status === 'Active');
  const openTickets = tickets.filter(t => ['Open', 'In Progress', 'Assigned'].includes(t.status));
  const criticalTickets = tickets.filter(t => t.priority === 'CRITICAL');
  const todayAtt = attendance.filter(a => a.date === today);
  const presentToday = todayAtt.filter(a => ['Present', 'Half-Day'].includes(a.status));

  const priorityOrder: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
  const topTickets = [...openTickets]
    .sort((a, b) => (priorityOrder[b.priority] ?? 0) - (priorityOrder[a.priority] ?? 0))
    .slice(0, 20)
    .map(t => `  [${t.ticketId}] ${t.priority} | ${t.centerName} | ${t.vehicleNumber} | ${t.issue} | Assigned: ${t.assignedTechnicianName || 'Unassigned'}`)
    .join('\n');

  const techSummary = activeTechs.slice(0, 20)
    .map(t => `  ${t.name} (${t.employeeId}) | ${t.role} | ${t.city} | Zone: ${t.zone || 'N/A'} | Spec: ${t.specialisation}`)
    .join('\n');

  const centerSummary = centers.slice(0, 15)
    .map(c => `  ${c.name} | ${c.city} | [${c.latitude.toFixed(4)}, ${c.longitude.toFixed(4)}]`)
    .join('\n');

  return `=== FLEET OPERATIONS CONTEXT (Delhi NCR) — ${today} ===
SUMMARY:
- Total Technicians: ${technicians.length} (Active: ${activeTechs.length})
- Total Tickets: ${tickets.length} (Open/Active: ${openTickets.length}, Critical: ${criticalTickets.length})
- Centers: ${centers.length}
- Attendance today: ${presentToday.length} present out of ${todayAtt.length} marked

TOP OPEN/ACTIVE TICKETS (by priority):
${topTickets || '  No open tickets'}

ACTIVE TECHNICIANS (sample):
${techSummary || '  No active technicians'}

SERVICE CENTERS (sample):
${centerSummary || '  No centers'}
===`;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM_PROMPT = `You are FleetOps AI, an intelligent operations assistant for a Delhi NCR electric vehicle (EV) field service fleet.
You have access to live fleet data (injected below). Use it to answer questions accurately.
Your capabilities:
- Analyse ticket backlogs and identify patterns
- Suggest optimal technician assignments based on skills, zones, and proximity
- Flag anomalies (unresolved critical tickets, overloaded techs, mismatched assignments)
- Summarise daily operations: attendance, route efficiency, ticket throughput
- Answer natural language questions about any aspect of the fleet
- Generate daily briefings, shift handover notes, escalation summaries
- Recommend priority order for open tickets
Always be concise, data-driven, and operational in tone. Format responses with clear sections when helpful.
Use markdown for tables and lists where it improves readability.`;

/** Stream chat via Gemini 2.0 Flash */
export async function* streamGemini(
  messages: ChatMessage[],
  model = 'gemini-3.8-flash'
): AsyncGenerator<string> {
  const key = resolveApiKey();
  const context = buildFleetContext();

  // Build contents array for Gemini
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const body = {
    system_instruction: { parts: [{ text: `${SYSTEM_PROMPT}\n\n${context}` }] },
    contents,
    generationConfig: { maxOutputTokens: 1024, temperature: 0.4 },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${key}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;
      try {
        const json = JSON.parse(data);
        const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) yield text;
      } catch {}
    }
  }
}

export const GEMINI_MODELS = [
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (Default)' },
  { id: 'gemini-3.8-flash-lite', label: 'Gemini 3.8 Flash Lite' },
  { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
];
