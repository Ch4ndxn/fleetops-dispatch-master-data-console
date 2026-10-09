import Groq from 'groq-sdk';
import { getTechnicians, getTickets, getCenters, getAttendance, getRoutePlans } from './storage';
import { localDate } from '../lib/date';

// Groq client — API key injected from env var VITE_GROQ_API_KEY
// Set in .env as VITE_GROQ_API_KEY=gsk_...
let _client: Groq | null = null;

/** Resolve API key: localStorage (runtime) > VITE env var (build-time) */
function resolveApiKey(): string {
  try {
    const stored = localStorage.getItem('fo_groq_key');
    if (stored && stored.trim()) return stored.trim();
  } catch {}
  const envKey = import.meta.env.VITE_GROQ_API_KEY as string | undefined;
  if (envKey && envKey.trim()) return envKey.trim();
  throw new Error('Groq API key not set. Click ⚙ Settings to add your key.');
}

function getClient(): Groq {
  // Always resolve fresh so a newly-saved key takes effect without page reload
  const key = resolveApiKey();
  if (!_client) {
    _client = new Groq({ apiKey: key, dangerouslyAllowBrowser: true });
  }
  return _client;
}

export function resetGroqClient() {
  _client = null;
}

/** Build a compact fleet context string to inject into every system prompt */
function buildFleetContext(): string {
  const technicians = getTechnicians();
  const tickets = getTickets();
  const centers = getCenters();
  const attendance = getAttendance();
  const today = localDate();

  const activeTechs = technicians.filter(t => t.status === 'Active');
  const openTickets = tickets.filter(t => t.status === 'Open' || t.status === 'In Progress' || t.status === 'Assigned');
  const criticalTickets = tickets.filter(t => t.priority === 'CRITICAL');
  const todayAtt = attendance.filter(a => a.date === today);
  const presentToday = todayAtt.filter(a => a.status === 'Present' || a.status === 'Half-Day');

  // Compact ticket summary (top 20 open, sorted by priority)
  const priorityOrder: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
  const topTickets = [...openTickets]
    .sort((a, b) => (priorityOrder[b.priority] ?? 0) - (priorityOrder[a.priority] ?? 0))
    .slice(0, 20)
    .map(t => `  [${t.ticketId}] ${t.priority} | ${t.centerName} | ${t.vehicleNumber} | ${t.issue} | Assigned: ${t.assignedTechnicianName || 'Unassigned'}`)
    .join('\n');

  const techSummary = activeTechs
    .slice(0, 20)
    .map(t => `  ${t.name} (${t.employeeId}) | ${t.role} | ${t.city} | Zone: ${t.zone || 'N/A'} | Spec: ${t.specialisation}`)
    .join('\n');

  const centerSummary = centers
    .slice(0, 15)
    .map(c => `  ${c.name} | ${c.city} | [${c.latitude.toFixed(4)}, ${c.longitude.toFixed(4)}]`)
    .join('\n');

  return `
=== FLEET OPERATIONS CONTEXT (Delhi NCR) — ${today} ===

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

/** Stream a chat completion. Returns an async generator of text chunks. */
export async function* streamChat(
  messages: ChatMessage[],
  model = 'llama3-70b-8192'
): AsyncGenerator<string> {
  const client = getClient();
  const context = buildFleetContext();

  const systemPrompt = `You are FleetOps AI, an intelligent operations assistant for a Delhi NCR electric vehicle (EV) field service fleet.

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
Use markdown for tables and lists where it improves readability.

${context}`;

  const groqMessages = [
    { role: 'system' as const, content: systemPrompt },
    ...messages.map(m => ({ role: m.role, content: m.content }))
  ];

  const stream = await client.chat.completions.create({
    model,
    messages: groqMessages,
    stream: true,
    max_tokens: 1024,
    temperature: 0.4,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}

/** One-shot (non-streaming) call — for quick structured outputs */
export async function askGroq(prompt: string, model = 'llama3-70b-8192'): Promise<string> {
  const client = getClient();
  const context = buildFleetContext();

  const res = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: `You are FleetOps AI for Delhi NCR EV fleet operations. Be concise and data-driven.\n${context}` },
      { role: 'user', content: prompt }
    ],
    max_tokens: 512,
    temperature: 0.3,
  });
  return res.choices[0]?.message?.content ?? '';
}

export const GROQ_MODELS = [
  { id: 'llama3-70b-8192', label: 'Llama 3 70B (Default)' },
  { id: 'llama3-8b-8192', label: 'Llama 3 8B (Fast)' },
  { id: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B' },
  { id: 'gemma2-9b-it', label: 'Gemma2 9B' },
];

export const QUICK_PROMPTS = [
  { label: '📋 Daily Briefing', prompt: 'Give me a complete daily operations briefing for today. Include ticket backlog status, attendance summary, critical alerts, and top 3 recommended actions.' },
  { label: '🚨 Critical Tickets', prompt: 'List all critical tickets, identify which are unassigned, and suggest the best technician for each based on zone and specialisation.' },
  { label: '🏆 Suggest Assignments', prompt: 'Review the current open tickets and suggest optimal technician assignments. Prioritise critical cases and consider technician zones and skills.' },
  { label: '📊 Workload Analysis', prompt: 'Analyse the current workload distribution across technicians. Who is overloaded? Who has capacity? Show me the balance.' },
  { label: '⚠️ Flag Anomalies', prompt: 'Scan the fleet data and flag any anomalies: overdue tickets, unassigned critical cases, technicians with no tickets today, centers with multiple open cases.' },
  { label: '📝 Shift Handover', prompt: 'Generate a concise shift handover note covering: what was resolved today, what is still open, critical items for the next shift, and any escalations needed.' },
];
