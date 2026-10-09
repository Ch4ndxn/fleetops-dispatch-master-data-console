import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  streamChat,
  ChatMessage,
  GROQ_MODELS,
  QUICK_PROMPTS,
  resetGroqClient,
} from '../../services/groqService';
import { streamGemini, GEMINI_MODELS } from '../../services/geminiService';
import {
  Bot,
  Send,
  Trash2,
  Settings,
  Zap,
  Copy,
  CheckCheck,
  Loader2,
  AlertCircle,
  ChevronDown,
  X,
  Sparkles,
  Key,
} from 'lucide-react';

type Provider = 'groq' | 'gemini';

// ── Simple markdown renderer (bold, inline-code, bullet lists, headers) ────────
function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];

  lines.forEach((line, li) => {
    // Heading
    if (line.startsWith('### ')) {
      nodes.push(<h3 key={li} className="text-sm font-bold text-slate-900 mt-3 mb-1">{line.slice(4)}</h3>);
      return;
    }
    if (line.startsWith('## ')) {
      nodes.push(<h2 key={li} className="text-sm font-bold text-slate-900 mt-4 mb-1 border-b border-slate-200 pb-1">{line.slice(3)}</h2>);
      return;
    }
    if (line.startsWith('# ')) {
      nodes.push(<h1 key={li} className="text-base font-bold text-slate-900 mt-4 mb-2">{line.slice(2)}</h1>);
      return;
    }
    // Bullet
    if (line.startsWith('- ') || line.startsWith('* ')) {
      nodes.push(
        <div key={li} className="flex gap-2 my-0.5">
          <span className="text-teal-600 mt-0.5 shrink-0">•</span>
          <span>{inlineFormat(line.slice(2))}</span>
        </div>
      );
      return;
    }
    // Numbered list
    const numMatch = line.match(/^(\d+)\.\s+(.+)/);
    if (numMatch) {
      nodes.push(
        <div key={li} className="flex gap-2 my-0.5">
          <span className="text-teal-600 font-mono text-xs mt-0.5 shrink-0 w-4">{numMatch[1]}.</span>
          <span>{inlineFormat(numMatch[2])}</span>
        </div>
      );
      return;
    }
    // Blank line → spacer
    if (line.trim() === '') {
      nodes.push(<div key={li} className="h-1.5" />);
      return;
    }
    // Horizontal rule
    if (line.startsWith('---') || line.startsWith('===')) {
      nodes.push(<hr key={li} className="border-slate-200 my-2" />);
      return;
    }
    // Normal paragraph line
    nodes.push(<div key={li} className="leading-relaxed">{inlineFormat(line)}</div>);
  });

  return nodes;
}

function inlineFormat(text: string): React.ReactNode {
  // Split by **bold**, *italic*, `code`
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold text-slate-900">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={i} className="italic">{part.slice(1, -1)}</em>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="bg-slate-100 text-rose-600 text-[11px] px-1.5 py-0.5 rounded font-mono">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

// ── Message bubble ─────────────────────────────────────────────────────────────
function MessageBubble({ msg, isStreaming }: { msg: ChatMessage & { id: string }; isStreaming?: boolean }) {
  const [copied, setCopied] = useState(false);
  const isUser = msg.role === 'user';

  const handleCopy = () => {
    navigator.clipboard.writeText(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'} group`}>
      {/* Avatar */}
      <div
        className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-white text-xs font-bold shadow-xs ${
          isUser ? 'bg-slate-700' : 'bg-teal-600'
        }`}
      >
        {isUser ? 'U' : <Bot className="w-3.5 h-3.5" />}
      </div>

      {/* Bubble */}
      <div
        className={`max-w-[82%] rounded-2xl px-4 py-3 text-xs leading-relaxed shadow-xs relative ${
          isUser
            ? 'bg-slate-800 text-white rounded-tr-sm'
            : 'bg-white border border-slate-200 text-slate-700 rounded-tl-sm'
        }`}
      >
        {isUser ? (
          <span>{msg.content}</span>
        ) : (
          <div className="space-y-0.5">
            {renderMarkdown(msg.content)}
            {isStreaming && (
              <span className="inline-block w-1.5 h-3.5 bg-teal-500 rounded-sm ml-0.5 animate-pulse" />
            )}
          </div>
        )}

        {/* Copy button */}
        {!isStreaming && (
          <button
            onClick={handleCopy}
            className={`absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md ${
              isUser ? 'hover:bg-white/10 text-white/60' : 'hover:bg-slate-100 text-slate-400'
            }`}
          >
            {copied ? <CheckCheck className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export const AiAssistantPage: React.FC = () => {
  const [messages, setMessages] = useState<(ChatMessage & { id: string })[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<Provider>('gemini');
  const [selectedModel, setSelectedModel] = useState(GEMINI_MODELS[0].id);
  const [showSettings, setShowSettings] = useState(false);
  // Write-only: never read stored keys back into the input (security)
  const [groqKey, setGroqKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const hasGroqKey = (() => { try { return !!localStorage.getItem('fo_groq_key'); } catch { return false; } })();
  const hasGeminiKey = (() => { try { return !!localStorage.getItem('fo_gemini_key'); } catch { return false; } })();
  const [apiKeySaved, setApiKeySaved] = useState(false);

  // Sync model when provider changes
  useEffect(() => {
    setSelectedModel(provider === 'groq' ? GROQ_MODELS[0].id : GEMINI_MODELS[0].id);
  }, [provider]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  const saveApiKey = () => {
    try {
      if (groqKey.trim()) localStorage.setItem('fo_groq_key', groqKey.trim());
      if (geminiKey.trim()) localStorage.setItem('fo_gemini_key', geminiKey.trim());
    } catch {}
    resetGroqClient();
    setApiKeySaved(true);
    setTimeout(() => setApiKeySaved(false), 2000);
    setShowSettings(false);
  };

  const sendMessage = useCallback(async (userText: string) => {
    if (!userText.trim() || isLoading) return;
    setError(null);

    const userMsg: ChatMessage & { id: string } = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: userText.trim(),
    };

    const assistantId = `a-${Date.now()}`;
    const assistantMsg: ChatMessage & { id: string } = {
      id: assistantId,
      role: 'assistant',
      content: '',
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput('');
    setIsLoading(true);
    setStreamingId(assistantId);

    // Build history (exclude the empty assistant placeholder)
    const history: ChatMessage[] = messages.map(m => ({ role: m.role, content: m.content }));
    history.push({ role: 'user', content: userText.trim() });

    try {
      let fullContent = '';
      const stream = provider === 'gemini'
        ? streamGemini(history, selectedModel)
        : streamChat(history, selectedModel);
      for await (const chunk of stream) {
        fullContent += chunk;
        setMessages(prev =>
          prev.map(m => m.id === assistantId ? { ...m, content: fullContent } : m)
        );
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      setError(msg);
      setMessages(prev => prev.filter(m => m.id !== assistantId));
    } finally {
      setIsLoading(false);
      setStreamingId(null);
    }
  }, [messages, isLoading, selectedModel]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const clearChat = () => {
    setMessages([]);
    setError(null);
  };

  return (
    <div className="flex flex-col h-full min-h-0" style={{ height: '100%' }}>

      {/* ── Header ── */}
      <div className="shrink-0 flex items-center justify-between px-5 py-3 bg-white border-b border-slate-200 shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center shadow-xs">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-900 tracking-tight">FleetOps AI</div>
            <div className="text-[10px] text-teal-600 font-mono">
              {provider === 'gemini' ? 'Powered by Google Gemini' : 'Powered by Groq'} · {(provider === 'gemini' ? GEMINI_MODELS : GROQ_MODELS).find(m => m.id === selectedModel)?.label}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Provider toggle */}
          <div className="flex items-center bg-slate-100 rounded-lg p-0.5 border border-slate-200">
            <button
              onClick={() => setProvider('gemini')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors ${provider === 'gemini' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-500 hover:text-slate-700'}`}
            >Gemini</button>
            <button
              onClick={() => setProvider('groq')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors ${provider === 'groq' ? 'bg-teal-600 text-white shadow-xs' : 'text-slate-500 hover:text-slate-700'}`}
            >Groq</button>
          </div>

          {/* Model picker */}
          <div className="relative">
            <select
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
              className="appearance-none text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1.5 pr-6 cursor-pointer focus:outline-none focus:ring-2 focus:ring-teal-500/40"
            >
              {(provider === 'gemini' ? GEMINI_MODELS : GROQ_MODELS).map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            <ChevronDown className="w-3 h-3 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          {messages.length > 0 && (
            <button
              onClick={clearChat}
              className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
              title="Clear chat"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}

          <button
            onClick={() => setShowSettings(s => !s)}
            className={`p-1.5 rounded-lg transition-colors ${showSettings ? 'bg-teal-50 text-teal-600' : 'hover:bg-slate-100 text-slate-400'}`}
            title="Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Settings panel ── */}
      {showSettings && (
        <div className="shrink-0 bg-slate-50 border-b border-slate-200 px-5 py-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700"><Key className="w-3.5 h-3.5" /> API Keys</div>
            <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-slate-600 p-1"><X className="w-4 h-4" /></button>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 flex items-center gap-2">
              <span className="text-[10px] font-bold text-blue-600 w-14 shrink-0">Gemini</span>
              <div className="flex-1 relative">
                <input type="password" value={geminiKey} onChange={e => setGeminiKey(e.target.value)}
                  placeholder={hasGeminiKey ? '••••••••••••••• (saved — paste to replace)' : 'AIza... or AQ.Ab...'}
                  className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 font-mono" />
                {hasGeminiKey && !geminiKey && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">SAVED</span>
                )}
              </div>
            </div>
            <div className="flex-1 flex items-center gap-2">
              <span className="text-[10px] font-bold text-teal-600 w-14 shrink-0">Groq</span>
              <div className="flex-1 relative">
                <input type="password" value={groqKey} onChange={e => setGroqKey(e.target.value)}
                  placeholder={hasGroqKey ? '••••••••••••••• (saved — paste to replace)' : 'gsk_...'}
                  className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/40 font-mono" />
                {hasGroqKey && !groqKey && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">SAVED</span>
                )}
              </div>
            </div>
            <button onClick={saveApiKey}
              className="px-4 py-1.5 bg-slate-800 hover:bg-black text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shrink-0">
              {apiKeySaved ? <CheckCheck className="w-3.5 h-3.5" /> : <Key className="w-3.5 h-3.5" />}
              {apiKeySaved ? 'Saved!' : 'Save'}
            </button>
          </div>
          <div className="text-[10px] text-slate-400">
            Gemini: <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-blue-500 underline">aistudio.google.com/apikey</a>
            {' · '}Groq: <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="text-teal-500 underline">console.groq.com/keys</a>
          </div>
        </div>
      )}

      {/* ── Messages area ── */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4 min-h-0">

        {/* Welcome state */}
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-6 py-12">
            <div className="w-16 h-16 rounded-2xl bg-teal-600/10 flex items-center justify-center">
              <Bot className="w-8 h-8 text-teal-600" />
            </div>
            <div className="text-center max-w-sm">
              <h2 className="text-base font-bold text-slate-900">FleetOps AI Assistant</h2>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                Ask anything about your Delhi NCR fleet — ticket assignments, workload balance, anomalies, shift briefings, and more.
              </p>
              <p className="text-[10px] text-slate-400 mt-2">
                Uses <span className="text-blue-500 font-semibold">Google Gemini</span> by default (free) · Switch to <span className="text-teal-500 font-semibold">Groq</span> anytime · Click ⚙ to manage keys.
              </p>
            </div>

            {/* Quick prompt grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
              {QUICK_PROMPTS.map((qp, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(qp.prompt)}
                  className="text-left px-3 py-2.5 bg-white border border-slate-200 hover:border-teal-400 hover:bg-teal-50/50 rounded-xl text-xs font-medium text-slate-700 transition-colors shadow-xs flex items-center gap-2"
                >
                  <Zap className="w-3.5 h-3.5 text-teal-500 shrink-0" />
                  {qp.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Chat messages */}
        {messages.map(msg => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            isStreaming={streamingId === msg.id}
          />
        ))}

        {/* Loading indicator (while waiting for first token) */}
        {isLoading && streamingId && messages.find(m => m.id === streamingId)?.content === '' && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-teal-600 flex items-center justify-center shrink-0">
              <Bot className="w-3.5 h-3.5 text-white" />
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-xs">
              <Loader2 className="w-4 h-4 text-teal-500 animate-spin" />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
            <div>
              <strong>Error:</strong> {error}
              {error.includes('API key') && (
                <button
                  onClick={() => setShowSettings(true)}
                  className="ml-2 underline text-red-600 hover:text-red-800"
                >
                  Add API key →
                </button>
              )}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Quick prompts strip (when chat is active) ── */}
      {messages.length > 0 && (
        <div className="shrink-0 px-4 sm:px-6 py-2 flex gap-2 overflow-x-auto border-t border-slate-100 bg-white/80 backdrop-blur-sm">
          {QUICK_PROMPTS.map((qp, i) => (
            <button
              key={i}
              onClick={() => sendMessage(qp.prompt)}
              disabled={isLoading}
              className="shrink-0 text-[11px] px-2.5 py-1.5 bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 rounded-full font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {qp.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Input bar ── */}
      <div className="shrink-0 px-4 sm:px-6 py-3 bg-white border-t border-slate-200">
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your fleet… (Enter to send, Shift+Enter for new line)"
              rows={1}
              disabled={isLoading}
              className="w-full resize-none text-xs px-4 py-3 pr-12 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-teal-400 focus:ring-2 focus:ring-teal-500/20 focus:outline-none transition-all placeholder:text-slate-400 text-slate-800 disabled:opacity-60 leading-relaxed"
              style={{ minHeight: 44, maxHeight: 120 }}
            />
          </div>
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="h-11 w-11 shrink-0 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:bg-slate-200 disabled:cursor-not-allowed text-white flex items-center justify-center transition-colors shadow-xs"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </form>
        <p className="text-[10px] text-slate-400 mt-1.5 text-center">
          Live fleet data (technicians, tickets, attendance, centers) is sent with every message · Responses may not be 100% accurate
        </p>
      </div>
    </div>
  );
};
