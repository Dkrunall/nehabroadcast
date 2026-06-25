'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  templatesStore, groupsStore, blacklistStore, historyStore, dailyStore,
  genId,
  type Template, type Group, type Contact, type CampaignRecord,
} from '@/lib/storage';

// ── Types ─────────────────────────────────────────────────
type View = 'campaign' | 'templates' | 'groups' | 'blacklist' | 'history';
type Step = 'connect' | 'compose' | 'sending' | 'done';
type InputMode = 'manual' | 'csv' | 'group';

const STEPS: Step[] = ['connect', 'compose', 'sending', 'done'];
const STEP_LABELS: Record<Step, string> = {
  connect: 'Connection',
  compose: 'Composer',
  sending: 'Sending',
  done: 'Results',
};

interface NumberResult {
  number: string;
  name: string;
  status: 'pending' | 'sending' | 'success' | 'failed';
  error?: string;
}

// ── Constants ─────────────────────────────────────────────
const EMOJIS = [
  '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😉','😊','😍',
  '🥰','😘','🤩','😎','🥳','🎉','🎊','🎈','🎁','🎀','🏆','🥇',
  '❤️','🧡','💛','💚','💙','💜','💯','🔥','⭐','✨','💥','🎯',
  '👍','👎','👌','✌️','🤞','🙌','👏','🙏','💪','🤝','💰','💵',
  '💎','🛍️','📱','💻','🌟','🌈','☀️','⚡','🌺','🌸','🌼','🌻',
  '🍀','🚀','✈️','🏠','🎭','🎬','📸','📢','📣','🔔','✅','❌',
];

// ── Helpers ───────────────────────────────────────────────
function parseCSV(text: string): Contact[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const parts = line.split(/[,;\t]/).map((p) => p.trim().replace(/^["']|["']$/g, ''));
    return { number: parts[0]?.replace(/\D/g, '') || '', name: parts[1] || '' };
  }).filter((c) => c.number.length >= 7);
}

function parseManual(text: string): Contact[] {
  return text.split(/[\n,]+/).map((n) => n.trim()).filter(Boolean)
    .map((n) => ({ number: n.replace(/\D/g, ''), name: '' }))
    .filter((c) => c.number.length >= 7);
}

function exportCSV(results: { number: string; name: string; status: string; error?: string }[], message: string) {
  const rows = [['Number','Name','Status','Error'], ...results.map((r) => [r.number, r.name, r.status, r.error || ''])];
  const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `campaign-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function fmtDuration(secs: number) {
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

// ── Sub-components ────────────────────────────────────────
function EmojiPicker({ onPick }: { onPick: (e: string) => void }) {
  return (
    <div className="absolute bottom-10 left-0 z-50 glass-panel rounded-2xl p-3 shadow-2xl w-64 border border-white/5 animate-fade-in bg-slate-900/95 backdrop-blur-xl">
      <div className="grid grid-cols-7 gap-1 max-h-48 overflow-y-auto pr-1">
        {EMOJIS.map((e) => (
          <button key={e} onClick={() => onPick(e)} className="text-lg p-1.5 hover:bg-emerald-500/20 rounded-lg transition-all active:scale-95">{e}</button>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ status, error }: { status: NumberResult['status']; error?: string }) {
  if (status === 'pending')
    return (
      <span className="text-[9px] sm:text-[10px] font-bold text-slate-500 bg-slate-900 border border-slate-800 px-2.5 py-1 rounded-full uppercase tracking-wider">
        Pending
      </span>
    );
  if (status === 'sending')
    return (
      <span className="text-[9px] sm:text-[10px] font-bold text-sky-400 bg-sky-500/10 border border-sky-500/20 px-2.5 py-1 rounded-full flex items-center gap-1.5 uppercase tracking-wider shadow-inner">
        <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping inline-block" />
        Active
      </span>
    );
  if (status === 'success')
    return (
      <span className="text-[9px] sm:text-[10px] font-bold text-emerald-400 bg-emerald-500/15 border border-emerald-500/20 px-2.5 py-1 rounded-full flex items-center gap-1 uppercase tracking-wider">
        ✓ Sent
      </span>
    );
  return (
    <span
      className="text-[9px] sm:text-[10px] font-bold text-rose-400 bg-rose-500/15 border border-rose-500/20 px-2.5 py-1 rounded-full flex items-center gap-1 uppercase tracking-wider cursor-help"
      title={error || 'Unknown error'}
    >
      ✕ Failed
    </span>
  );
}

// Defined outside the component to avoid SWC compilation ambiguities
const NAV: { id: View; label: string; icon: string }[] = [
  { id: 'campaign', label: 'Campaign', icon: 'campaign' },
  { id: 'templates', label: 'Templates', icon: 'templates' },
  { id: 'groups', label: 'Groups', icon: 'groups' },
  { id: 'blacklist', label: 'Blacklist', icon: 'blacklist' },
  { id: 'history', label: 'History', icon: 'history' },
];

// ── Main Component ────────────────────────────────────────
export default function Home() {
  const [view, setView] = useState<View>('campaign');
  const [step, setStep] = useState<Step>('connect');
  const [connStatus, setConnStatus] = useState('idle');
  const [qrCode, setQrCode] = useState('');

  const [inputMode, setInputMode] = useState<InputMode>('manual');
  const [numbersText, setNumbersText] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [csvFile, setCsvFile] = useState<File | null>(null);

  const [message, setMessage] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [showTemplatesPicker, setShowTemplatesPicker] = useState(false);

  const [files, setFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<{ url: string; name: string; type: string }[]>([]);

  const [delay, setDelay] = useState(40);
  const [dailyLimit, setDailyLimit] = useState(0);
  const [scheduleAt, setScheduleAt] = useState('');
  const [filterBlacklist, setFilterBlacklist] = useState(true);
  const [showSettings, setShowSettings] = useState(true);

  const [results, setResults] = useState<NumberResult[]>([]);
  const [countdown, setCountdown] = useState(0);
  const [nextNum, setNextNum] = useState('');
  const [sentCount, setSentCount] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [startTime, setStartTime] = useState(0);
  const [limitReached, setLimitReached] = useState(false);

  const [templates, setTemplates] = useState<Template[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [blacklist, setBlacklist] = useState<string[]>([]);
  const [historyItems, setHistoryItems] = useState<CampaignRecord[]>([]);

  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateMsg, setNewTemplateMsg] = useState('');
  const [editTemplateId, setEditTemplateId] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupNumbers, setNewGroupNumbers] = useState('');
  const [newBlacklistNum, setNewBlacklistNum] = useState('');
  const [expandedHistory, setExpandedHistory] = useState('');

  const esRef = useRef<EventSource | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const msgRef = useRef<HTMLTextAreaElement>(null);
  const scheduleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setTemplates(templatesStore.getAll());
    setGroups(groupsStore.getAll());
    setBlacklist(blacklistStore.getAll());
    setHistoryItems(historyStore.getAll());
  }, []);

  useEffect(() => {
    fetch('/api/whatsapp/status').then((r) => r.json()).then((d) => {
      if (d.status === 'ready') { setConnStatus('ready'); setStep('compose'); }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (inputMode === 'manual') setContacts(parseManual(numbersText));
  }, [numbersText, inputMode]);

  useEffect(() => {
    if (inputMode === 'group' && selectedGroup) {
      const g = groups.find((x) => x.id === selectedGroup);
      setContacts(g?.contacts || []);
    }
  }, [selectedGroup, groups, inputMode]);

  const filteredContacts = filterBlacklist ? contacts.filter((c) => !blacklist.includes(c.number)) : contacts;
  const canSend = filteredContacts.length > 0 && message.trim().length > 0;
  const totalMins = Math.ceil((filteredContacts.length * delay) / 60);

  const connect = async () => {
    setConnStatus('initializing');
    await fetch('/api/whatsapp/connect', { method: 'POST' });
    const es = new EventSource('/api/whatsapp/connect');
    esRef.current = es;
    es.onmessage = (e) => {
      const d = JSON.parse(e.data);
      if (d.type === 'qr') { setQrCode(d.qrImage); setConnStatus('qr'); }
      else if (d.type === 'status') { setConnStatus(d.status); if (d.status === 'ready') { setStep('compose'); es.close(); } }
    };
    es.onerror = () => {};
  };

  const addFiles = (newFiles: FileList | null) => {
    if (!newFiles) return;
    Array.from(newFiles).forEach((file) => {
      setFiles((p) => [...p, file]);
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onloadend = () => setFilePreviews((p) => [...p, { url: reader.result as string, name: file.name, type: 'image' }]);
        reader.readAsDataURL(file);
      } else {
        setFilePreviews((p) => [...p, { url: '', name: file.name, type: 'file' }]);
      }
    });
  };

  const removeFile = (idx: number) => {
    setFiles((p) => p.filter((_, i) => i !== idx));
    setFilePreviews((p) => p.filter((_, i) => i !== idx));
  };

  const handleCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setContacts(parseCSV(reader.result as string));
    reader.readAsText(file);
  };

  const insertEmoji = (emoji: string) => {
    const el = msgRef.current;
    if (!el) { setMessage((m) => m + emoji); setShowEmoji(false); return; }
    const s = el.selectionStart ?? message.length;
    const end = el.selectionEnd ?? message.length;
    setMessage(message.slice(0, s) + emoji + message.slice(end));
    setShowEmoji(false);
    setTimeout(() => { el.selectionStart = el.selectionEnd = s + emoji.length; el.focus(); }, 0);
  };

  const togglePause = async () => {
    const next = !isPaused;
    setIsPaused(next);
    await fetch('/api/whatsapp/pause', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused: next }) });
  };

  const doSend = useCallback(async () => {
    const nums = filteredContacts;
    if (!nums.length || !message.trim()) return;
    setStep('sending'); setSentCount(0); setCountdown(0); setIsPaused(false); setLimitReached(false);
    setStartTime(Date.now());
    setResults(nums.map((c) => ({ number: c.number, name: c.name, status: 'pending' })));
    const finalResults: NumberResult[] = nums.map((c) => ({ number: c.number, name: c.name, status: 'pending' }));

    const fd = new FormData();
    fd.append('contacts', JSON.stringify(nums));
    fd.append('message', message);
    fd.append('delay', String(delay * 1000));
    fd.append('dailyLimit', String(dailyLimit));
    files.forEach((f) => fd.append('files', f));

    const res = await fetch('/api/whatsapp/send', { method: 'POST', body: fd });
    if (!res.body) return;
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const d = JSON.parse(line.slice(6));
          if (d.type === 'sending') {
            setResults((p) => p.map((r, i) => i === d.index ? { ...r, status: 'sending' } : r));
            setTimeout(() => resultsRef.current?.children[d.index]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
          } else if (d.type === 'sent') {
            const upd: NumberResult = { number: d.number, name: d.name, status: d.status, error: d.error };
            finalResults[d.index] = upd;
            setResults((p) => p.map((r, i) => i === d.index ? upd : r));
            setSentCount((c) => c + 1); setCountdown(0);
            if (d.status === 'success') dailyStore.increment();
          } else if (d.type === 'countdown') {
            setCountdown(d.seconds); setNextNum(d.next);
          } else if (d.type === 'limit_reached') {
            setLimitReached(true);
          } else if (d.type === 'complete') {
            const duration = Math.floor((Date.now() - startTime) / 1000);
            const record: CampaignRecord = {
              id: genId(), date: new Date().toISOString(), message,
              total: nums.length,
              success: finalResults.filter((r) => r.status === 'success').length,
              failed: finalResults.filter((r) => r.status === 'failed').length,
              duration, results: finalResults,
            };
            historyStore.save(record); setHistoryItems(historyStore.getAll()); setStep('done');
          }
        } catch {}
      }
    }
  }, [filteredContacts, message, delay, dailyLimit, files, startTime]);

  const send = () => {
    if (scheduleAt) {
      const wait = new Date(scheduleAt).getTime() - Date.now();
      if (wait > 0) {
        if (scheduleTimer.current) clearTimeout(scheduleTimer.current);
        scheduleTimer.current = setTimeout(doSend, wait);
        alert(`Scheduled! Will send at ${new Date(scheduleAt).toLocaleString()}`);
        return;
      }
    }
    doSend();
  };

  const retryFailed = () => {
    const failed = results.filter((r) => r.status === 'failed').map((r) => ({ number: r.number, name: r.name }));
    setContacts(failed); setInputMode('manual'); setNumbersText(failed.map((c) => c.number).join('\n'));
    setStep('compose'); setResults([]); setSentCount(0);
  };

  const saveTemplate = () => {
    if (!newTemplateName.trim() || !newTemplateMsg.trim()) return;
    templatesStore.save({ id: editTemplateId || genId(), name: newTemplateName, message: newTemplateMsg, createdAt: new Date().toISOString() });
    setTemplates(templatesStore.getAll()); setNewTemplateName(''); setNewTemplateMsg(''); setEditTemplateId('');
  };

  const saveGroup = () => {
    if (!newGroupName.trim() || !newGroupNumbers.trim()) return;
    groupsStore.save({ id: genId(), name: newGroupName, contacts: parseManual(newGroupNumbers), createdAt: new Date().toISOString() });
    setGroups(groupsStore.getAll()); setNewGroupName(''); setNewGroupNumbers('');
  };

  const copyFailedNumbers = () => {
    const failedList = results
      .filter((r) => r.status === 'failed')
      .map((r) => r.number)
      .join('\n');
    navigator.clipboard.writeText(failedList);
  };

  const formatWhatsAppMessage = (text: string) => {
    if (!text) return 'Start typing your message to see a preview here...';
    let formatted = text
      .replace(/&/g, '&amp;')
      .replace(new RegExp('<', 'g'), '&lt;')
      .replace(new RegExp('>', 'g'), '&gt;');
    
    formatted = formatted.replace(/\*([^*]+)\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/_([^_]+)_/g, '<em>$1</em>');
    formatted = formatted.replace(/~([^~]+)~/g, '<del>$1</del>');
    formatted = formatted.replace(/\n/g, '<br />');
    
    return formatted;
  };

  const successCount = results.filter((r) => r.status === 'success').length;
  const failedCount = results.filter((r) => r.status === 'failed').length;
  const stepIndex = STEPS.indexOf(step);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      
      {/* ── Header ── */}
      <header className="w-full sticky top-0 z-40 glass-panel border-b border-white/5 bg-slate-950/80 backdrop-blur-xl">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-3.5 sm:py-0 sm:h-16 flex flex-col sm:flex-row items-center justify-between gap-3.5 sm:gap-4">
          
          {/* Logo & Mobile Connection Status */}
          <div className="flex items-center justify-between w-full sm:w-auto gap-4 flex-shrink-0">
            {/* Logo */}
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-emerald-400 flex items-center justify-center font-black text-slate-950 text-lg shadow-lg shadow-emerald-500/20">N</div>
              <div>
                <p className="text-sm font-bold tracking-tight bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">Neha Broadcast</p>
                <p className="text-[10px] text-slate-500 font-medium leading-none mt-0.5">Campaign Suite</p>
              </div>
            </div>

            {/* Mobile-only Connection Status badge */}
            <div className="sm:hidden flex items-center gap-1.5">
              {connStatus === 'ready' ? (
                <>
                  <div className="flex items-center gap-1.5 text-[10px] text-emerald-400 font-bold uppercase tracking-wider bg-emerald-950/40 border border-emerald-900/30 px-2.5 py-1 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-glow" />
                    Ready
                  </div>
                  <button
                    onClick={async () => {
                      await fetch('/api/whatsapp/disconnect', { method: 'POST' });
                      setConnStatus('idle'); setQrCode(''); setStep('connect');
                    }}
                    className="text-[10px] text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2 py-1 rounded-full font-bold uppercase tracking-wider"
                  >
                    ✕
                  </button>
                </>
              ) : (
                <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-bold uppercase tracking-wider bg-slate-900 border border-slate-800 px-2.5 py-1 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-700" />
                  Offline
                </div>
              )}
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex items-center bg-slate-900/60 p-1 rounded-xl border border-slate-800/80 overflow-x-auto w-full sm:w-auto scrollbar-none gap-0.5 justify-start sm:justify-center">
            {NAV.map((n) => {
              const isSel = view === n.id;
              return (
                <button key={n.id} onClick={() => setView(n.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 sm:px-3 sm:py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all flex-shrink-0
                    ${isSel 
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 shadow-inner' 
                      : 'text-slate-400 hover:bg-slate-900/60 hover:text-slate-200 border border-transparent'
                    }`}
                >
                  
                  {/* Dynamically render inline SVGs based on icon tag */}
                  {n.icon === 'campaign' && (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9-2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  )}
                  {n.icon === 'templates' && (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  )}
                  {n.icon === 'groups' && (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2m8-10a4 4 0 100-8 4 4 0 000 8zm8-2v2m0 0v2m0-2h2m-2 0h-2" />
                    </svg>
                  )}
                  {n.icon === 'blacklist' && (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                    </svg>
                  )}
                  {n.icon === 'history' && (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )}

                  <span>{n.label}</span>
                  {n.id === 'history' && historyItems.length > 0 && (
                    <span className="ml-1 text-[9px] bg-slate-800 text-slate-400 border border-slate-700/80 px-1.5 py-0.2 rounded-full font-bold">
                      {historyItems.length}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Desktop-only Connection Status */}
          <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
            {connStatus === 'ready' ? (
              <>
                <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-semibold uppercase tracking-wider bg-emerald-950/40 border border-emerald-900/30 px-3 py-1.5 rounded-full">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse-glow" />
                  Connected
                </div>
                <button
                  onClick={async () => {
                    await fetch('/api/whatsapp/disconnect', { method: 'POST' });
                    setConnStatus('idle'); setQrCode(''); setStep('connect');
                  }}
                  className="text-xs text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 px-3 py-1.5 rounded-full font-semibold uppercase tracking-wider transition-all"
                >
                  Disconnect
                </button>
              </>
            ) : (
              <div className="flex items-center gap-1.5 text-xs text-slate-500 font-semibold uppercase tracking-wider bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-full">
                <span className="w-2 h-2 rounded-full bg-slate-700" />
                Disconnected
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Main content pane ── */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-[1440px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 transition-all duration-300">

          {/* ──────────────── CAMPAIGN VIEW ──────────────── */}
          {view === 'campaign' && (
            <div className="space-y-6 sm:space-y-8">
              
              {/* Step indicator */}
              <div className="glass-panel rounded-2xl p-4 sm:p-5 border border-white/5 shadow-xl">
                <div className="flex-1 w-full grid grid-cols-4 gap-1.5 sm:gap-4">
                  {STEPS.map((s, i) => {
                    const isActive = step === s;
                    const isCompleted = stepIndex > i;
                    return (
                      <div key={s} className="relative flex flex-col items-center min-w-0">
                        <div className="flex items-center w-full">
                          <div className={`h-1 flex-1 ${i === 0 ? 'bg-transparent' : isCompleted || isActive ? 'bg-emerald-500/80' : 'bg-slate-800'}`} />
                          <div
                            className={`w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center font-bold text-xs sm:text-sm transition-all duration-300 shadow-md flex-shrink-0 z-10
                              ${isActive 
                                ? 'bg-emerald-500 text-slate-950 shadow-emerald-500/30 scale-105 ring-2 sm:ring-4 ring-emerald-950' 
                                : isCompleted 
                                ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-500/40' 
                                : 'bg-slate-900 text-slate-500 border border-slate-800'
                              }`}
                          >
                            {isCompleted ? (
                              <svg className="w-4.5 h-4.5 stroke-current" fill="none" viewBox="0 0 24 24" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            ) : (
                              i + 1
                            )}
                          </div>
                          <div className={`h-1 flex-1 ${i === STEPS.length - 1 ? 'bg-transparent' : isCompleted ? 'bg-emerald-500/80' : 'bg-slate-800'}`} />
                        </div>
                        <span
                          className={`mt-2 text-center text-[9px] sm:text-xs font-semibold tracking-wide uppercase transition-colors duration-300 max-w-full truncate px-0.5
                            ${isActive ? 'text-emerald-400 font-bold' : isCompleted ? 'text-slate-300' : 'text-slate-600'}`}
                        >
                          {STEP_LABELS[s]}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Step 1: Link Device */}
              {step === 'connect' && (
                <div className="grid md:grid-cols-12 gap-6 sm:gap-8 items-start">
                  <div className="md:col-span-7 space-y-6">
                    <div className="glass-panel rounded-3xl p-5 sm:p-8 border border-white/5 space-y-6 shadow-xl">
                      <div>
                        <span className="text-[10px] font-bold text-emerald-400 tracking-widest uppercase bg-emerald-950/50 px-2.5 py-1 rounded-md border border-emerald-900/60 inline-block mb-3">
                          Handshake
                        </span>
                        <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Link your WhatsApp Account</h2>
                        <p className="text-slate-400 text-xs sm:text-sm mt-1 leading-relaxed">
                          Scan the QR code to connect your number. The virtual session will be cached locally on the host server.
                        </p>
                      </div>

                      <div className="space-y-4">
                        <div className="flex gap-3">
                          <div className="w-7 h-7 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-xs font-bold text-emerald-400 flex-shrink-0 mt-0.5">1</div>
                          <div>
                            <h4 className="text-xs sm:text-sm font-semibold text-slate-200">Start server instance</h4>
                            <p className="text-[11px] text-slate-400 mt-0.5">Click the link button to launch Puppeteer on the host system.</p>
                          </div>
                        </div>
                        <div className="flex gap-3">
                          <div className="w-7 h-7 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-xs font-bold text-emerald-400 flex-shrink-0 mt-0.5">2</div>
                          <div>
                            <h4 className="text-xs sm:text-sm font-semibold text-slate-200">Scan QR Code</h4>
                            <p className="text-[11px] text-slate-400 mt-0.5">Open WhatsApp → Linked Devices → Link a Device and point the camera.</p>
                          </div>
                        </div>
                        <div className="flex gap-3">
                          <div className="w-7 h-7 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-xs font-bold text-emerald-400 flex-shrink-0 mt-0.5">3</div>
                          <div>
                            <h4 className="text-xs sm:text-sm font-semibold text-slate-200">Anti-Ban Configuration Active</h4>
                            <p className="text-[11px] text-slate-400 mt-0.5">Automated 40-second throttle interval protects your number from getting blocked.</p>
                          </div>
                        </div>
                      </div>

                      {connStatus === 'idle' && (
                        <button
                          onClick={connect}
                          className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-slate-950 font-bold rounded-2xl shadow-lg shadow-emerald-500/10 hover:shadow-emerald-500/20 hover:scale-[1.01] active:scale-[0.99] transition-all text-xs sm:text-sm tracking-wide uppercase"
                        >
                          Initialize Connection
                        </button>
                      )}

                      {connStatus === 'initializing' && (
                        <div className="py-6 flex flex-col items-center justify-center bg-slate-900/40 rounded-2xl border border-slate-800/80">
                          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500 mb-4" />
                          <p className="text-xs sm:text-sm text-slate-300 font-semibold">Launching Browser Engine...</p>
                          <p className="text-[10px] text-slate-500 mt-1 text-center px-4">This takes about 15-30 seconds. Do not reload.</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="md:col-span-5">
                    {connStatus === 'qr' && qrCode ? (
                      <div className="glass-panel rounded-3xl p-5 sm:p-8 border border-white/5 flex flex-col items-center text-center space-y-6 animate-fade-in shadow-2xl">
                        <div className="relative p-3.5 bg-white rounded-2xl shadow-lg ring-4 ring-emerald-500/30 max-w-full">
                          <img src={qrCode} alt="WhatsApp QR Code" className="w-52 h-52 sm:w-60 sm:h-60 block max-w-full" />
                        </div>
                        <div>
                          <h3 className="text-base sm:text-lg font-bold text-slate-100">Scan with WhatsApp</h3>
                          <p className="text-[11px] text-slate-400 mt-1.5 max-w-xs mx-auto leading-relaxed">
                            Point your device camera here to capture the session handshake.
                          </p>
                        </div>
                        <div className="w-full flex items-center justify-center gap-2 text-amber-400 text-[10px] sm:text-xs bg-amber-500/10 border border-amber-500/20 rounded-2xl py-3 px-4 shadow-inner">
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                          </span>
                          <span className="font-semibold tracking-wider uppercase">Awaiting Handshake...</span>
                        </div>
                      </div>
                    ) : (
                      <div className="glass-panel rounded-3xl p-6 sm:p-10 border border-white/5 border-dashed flex flex-col items-center justify-center text-center h-[280px] sm:h-[420px] text-slate-500">
                        <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-slate-900 flex items-center justify-center border border-slate-800 text-slate-600 mb-4 animate-float">
                          <svg className="w-6 h-6 sm:w-8 sm:h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                          </svg>
                        </div>
                        <h3 className="text-xs sm:text-sm font-semibold text-slate-400">QR Code Scanner</h3>
                        <p className="text-[11px] text-slate-600 mt-1 max-w-[180px] leading-relaxed">
                          Once initialized, the dynamic setup QR code will appear here.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Step 2: Compose */}
              {step === 'compose' && (
                <div className="grid lg:grid-cols-12 gap-6 sm:gap-8 items-start">
                  
                  {/* Form fields column */}
                  <div className="lg:col-span-7 space-y-6">
                    
                    {/* Connection Banner Notification */}
                    <div className="flex items-center gap-2 px-4 py-2 bg-emerald-950/40 border border-emerald-900/50 rounded-2xl shadow-inner">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse-glow flex-shrink-0" />
                      <span className="text-emerald-400 text-xs font-semibold uppercase tracking-wider">WhatsApp connected</span>
                    </div>

                    {/* Recipients Card */}
                    <div className="glass-panel rounded-3xl p-4 sm:p-6 border border-white/5 space-y-4 shadow-lg">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-sm sm:text-md font-bold tracking-tight text-slate-200">Recipients List</h3>
                          <p className="text-[11px] text-slate-500 mt-0.5">Specify destination mobile numbers.</p>
                        </div>
                        <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-500/20 px-2.5 py-0.5 sm:py-1 rounded-full">
                          {filteredContacts.length} Selected
                          {filterBlacklist && contacts.length !== filteredContacts.length && (
                            <span className="text-rose-400 font-bold ml-1">({contacts.length - filteredContacts.length} blocked)</span>
                          )}
                        </span>
                      </div>

                      {/* Mode tab selectors */}
                      <div className="flex gap-1 bg-slate-900/80 p-1 rounded-xl border border-slate-800/80">
                        {(['manual','csv','group'] as InputMode[]).map((m) => (
                          <button key={m} onClick={() => setInputMode(m)}
                            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all
                              ${inputMode === m 
                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 shadow-inner' 
                                : 'text-slate-500 hover:text-slate-300'}`}>
                            {m === 'csv' ? 'CSV Upload' : m === 'group' ? 'Load Group' : 'Manual'}
                          </button>
                        ))}
                      </div>

                      {/* Manual text area */}
                      {inputMode === 'manual' && (
                        <div className="space-y-1.5">
                          <textarea 
                            value={numbersText} 
                            onChange={(e) => setNumbersText(e.target.value)}
                            placeholder={'919876543210\n919876543211\n12025551234'}
                            className="w-full h-36 bg-slate-900/60 rounded-2xl px-4 py-3 text-sm text-slate-100 placeholder-slate-600 resize-none border border-slate-800/80 focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/10 focus:outline-none font-mono leading-relaxed transition-all" 
                          />
                          <p className="text-[10px] text-slate-600 leading-relaxed px-1">
                            Include country code, omit leading <span className="font-mono text-slate-400 bg-slate-900 px-1 py-0.5 rounded">+</span> sign or <span className="font-mono text-slate-400 bg-slate-900 px-1 py-0.5 rounded">00</span>.
                          </p>
                        </div>
                      )}

                      {/* CSV uploader */}
                      {inputMode === 'csv' && (
                        <div className="space-y-1.5">
                          <label className="cursor-pointer block">
                            <div className="border border-dashed border-slate-800 hover:border-emerald-500/40 rounded-2xl py-6 sm:py-8 text-center transition-all bg-slate-900/20 hover:bg-slate-900/40">
                              <div className="text-2xl mb-1.5">📄</div>
                              <p className="text-slate-300 text-xs font-semibold">{csvFile ? csvFile.name : 'Upload Contacts CSV'}</p>
                              <p className="text-slate-500 text-[10px] mt-0.5">Format: number,name (one per line)</p>
                            </div>
                            <input type="file" accept=".csv,.txt" onChange={handleCSV} className="hidden" />
                          </label>
                          {contacts.length > 0 && <p className="text-[10px] text-emerald-400 font-bold px-1">✓ Loaded {contacts.length} contacts from CSV</p>}
                        </div>
                      )}

                      {/* Group dropdown list */}
                      {inputMode === 'group' && (
                        <div className="space-y-1.5">
                          {groups.length === 0 ? (
                            <p className="text-slate-500 text-xs text-center py-4 bg-slate-900/20 rounded-2xl border border-slate-900">
                              No groups saved yet. <button onClick={() => setView('groups')} className="text-emerald-400 underline font-semibold">Create one</button>
                            </p>
                          ) : (
                            <select 
                              value={selectedGroup} 
                              onChange={(e) => setSelectedGroup(e.target.value)}
                              className="w-full bg-slate-900/60 rounded-2xl px-4 py-3 text-sm border border-slate-800/80 text-slate-200 focus:border-emerald-500/40 focus:outline-none transition-all"
                            >
                              <option value="" className="bg-slate-950 text-slate-400">Select a contact group...</option>
                              {groups.map((g) => (
                                <option key={g.id} value={g.id} className="bg-slate-950 text-slate-200">
                                  {g.name} ({g.contacts.length} numbers)
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Message Composer Card */}
                    <div className="glass-panel rounded-3xl p-4 sm:p-6 border border-white/5 space-y-4 shadow-lg">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-sm sm:text-md font-bold tracking-tight text-slate-200">Message Content</h3>
                          <p className="text-[11px] text-slate-500 mt-0.5">Draft the text body for your campaign.</p>
                        </div>
                        <div className="relative">
                          <button 
                            onClick={() => { setShowTemplatesPicker(!showTemplatesPicker); setShowEmoji(false); }}
                            className="text-[10px] text-slate-400 hover:text-emerald-400 bg-slate-900 px-2.5 py-1 rounded-xl border border-slate-800 font-bold uppercase tracking-wider transition-all"
                          >
                            📋 Templates
                          </button>
                          {showTemplatesPicker && templates.length > 0 && (
                            <div className="absolute right-0 top-8 z-50 glass-panel rounded-2xl shadow-2xl w-56 py-1.5 border border-white/10 bg-slate-900/95 backdrop-blur-xl">
                              {templates.map((t) => (
                                <button 
                                  key={t.id} 
                                  onClick={() => { setMessage(t.message); setShowTemplatesPicker(false); }}
                                  className="w-full text-left px-4 py-2.5 text-xs hover:bg-emerald-500/5 transition-colors border-b border-white/5 last:border-0"
                                >
                                  <p className="font-semibold text-slate-200 truncate">{t.name}</p>
                                  <p className="text-[10px] text-slate-500 truncate mt-0.5">{t.message}</p>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="relative">
                        <textarea 
                          ref={msgRef} 
                          value={message} 
                          onChange={(e) => setMessage(e.target.value)}
                          placeholder={'Type your message...\nUse {name} for personalized greetings!'}
                          className="w-full h-32 sm:h-36 bg-slate-900/60 rounded-2xl px-4 py-3 text-sm text-slate-100 placeholder-slate-600 resize-none border border-slate-800/80 focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/10 focus:outline-none leading-relaxed transition-all" 
                        />
                        {showEmoji && <EmojiPicker onPick={insertEmoji} />}
                      </div>

                      <div className="flex items-center justify-between">
                        <button 
                          onClick={() => { setShowEmoji(!showEmoji); setShowTemplatesPicker(false); }} 
                          className="text-xl hover:scale-110 active:scale-95 transition-transform"
                        >
                          😊
                        </button>
                        <div className="flex items-center gap-2.5">
                          {message.toLowerCase().includes('{name}') && (
                            <span className="text-[9px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider shadow-inner">
                              ✓ Personalized
                            </span>
                          )}
                          <span className="text-[10px] font-mono text-slate-600">{message.length} chars</span>
                        </div>
                      </div>

                      <div className="bg-slate-900/50 rounded-xl p-2.5 sm:p-3 border border-slate-800 flex flex-wrap gap-x-4 gap-y-1.5 text-[10px] sm:text-[11px] text-slate-400 justify-between">
                        <div className="flex items-center gap-1">
                          <span className="font-mono bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded font-bold">*bold*</span>
                          <span>Bold</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="font-mono bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded font-bold">_italic_</span>
                          <span>Italic</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="font-mono bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded font-bold">~strike~</span>
                          <span>Strikethrough</span>
                        </div>
                      </div>
                    </div>

                    {/* Attachments Card */}
                    <div className="glass-panel rounded-3xl p-4 sm:p-6 border border-white/5 space-y-4 shadow-lg">
                      <div>
                        <h3 className="text-sm sm:text-md font-bold tracking-tight text-slate-200">Attachments</h3>
                        <p className="text-[11px] text-slate-500 mt-0.5">Attach promotional media (images, PDFs, documents).</p>
                      </div>

                      <label className="cursor-pointer block">
                        <div className="border border-dashed border-slate-800 hover:border-emerald-500/40 rounded-2xl py-5 text-center transition-all bg-slate-900/20 hover:bg-slate-900/40">
                          <p className="text-slate-300 text-xs font-semibold">+ Add images or document files</p>
                          <p className="text-slate-500 text-[10px] mt-0.5">Supports images, PDFs, word docs</p>
                        </div>
                        <input type="file" accept="image/*,.pdf,.doc,.docx" multiple onChange={(e) => addFiles(e.target.files)} className="hidden" />
                      </label>

                      {filePreviews.length > 0 && (
                        <div className="flex flex-wrap gap-3 mt-3 p-2 bg-slate-900/30 rounded-2xl border border-slate-800">
                          {filePreviews.map((p, i) => (
                            <div key={i} className="relative group flex flex-col items-center">
                              {p.type === 'image' ? (
                                <img src={p.url} alt={p.name} className="w-14 h-14 object-cover rounded-xl border border-slate-800 bg-slate-950" />
                              ) : (
                                <div className="w-14 h-14 flex items-center justify-center bg-slate-800 rounded-xl border border-slate-700 text-2xl">📄</div>
                              )}
                              <button 
                                onClick={() => removeFile(i)} 
                                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-rose-500 text-white rounded-full text-[10px] flex items-center justify-center shadow-lg border border-slate-950 font-bold hover:bg-rose-400 active:scale-90 transition-all"
                              >
                                ✕
                              </button>
                              <p className="text-[9px] text-slate-500 truncate w-14 mt-1.5 text-center font-medium">{p.name}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Settings Accordion */}
                    <div className="glass-panel rounded-3xl overflow-hidden shadow-lg border border-white/5">
                      <button 
                        onClick={() => setShowSettings(!showSettings)} 
                        className="w-full flex items-center justify-between px-5 py-4 text-sm font-bold text-slate-200 hover:bg-slate-900/30 transition-colors"
                      >
                        <span className="flex items-center gap-2">⚙️ Advanced Campaign Settings</span>
                        <span className="text-slate-500 text-xs font-semibold">{showSettings ? '▲ Hide' : '▼ Show'}</span>
                      </button>
                      
                      {showSettings && (
                        <div className="px-5 pb-5 space-y-5 border-t border-slate-900/80 pt-4 bg-slate-900/10">
                          {/* Range slider delay */}
                          <div className="space-y-2">
                            <div className="flex justify-between items-baseline">
                              <label className="text-xs sm:text-sm font-semibold text-slate-300">Cooldown Throttling</label>
                              <span className="text-sm font-bold text-emerald-400">{delay} seconds</span>
                            </div>
                            <input 
                              type="range" 
                              min={10} 
                              max={120} 
                              value={delay} 
                              onChange={(e) => setDelay(Number(e.target.value))} 
                              className="w-full accent-emerald-500 cursor-pointer bg-slate-800 rounded-lg appearance-none h-1.5" 
                            />
                            <div className="flex justify-between text-[9px] sm:text-[10px] text-slate-600 font-bold uppercase tracking-wider mt-1 px-0.5">
                              <span className="text-rose-500/80">10s (Risky)</span>
                              <span className="text-emerald-500/80">60s (Safe)</span>
                              <span className="text-emerald-400">120s (Optimal)</span>
                            </div>
                          </div>

                          {/* Daily limit & stats */}
                          <div className="grid sm:grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                              <label className="text-xs font-semibold text-slate-300 block">Daily Limit Threshold</label>
                              <input 
                                type="number" 
                                min={0} 
                                max={500} 
                                value={dailyLimit} 
                                onChange={(e) => setDailyLimit(Number(e.target.value))}
                                className="w-full bg-slate-900/60 rounded-2xl px-4 py-2.5 text-sm border border-slate-800/80 text-slate-200 focus:border-emerald-500/40 focus:outline-none transition-all" 
                              />
                              <p className="text-[10px] text-slate-500 leading-none px-1">Today sent: <span className="font-mono text-slate-400 font-bold">{dailyStore.get().count}</span> (0 = unlimited)</p>
                            </div>

                            {/* Schedule send date */}
                            <div className="space-y-1.5">
                              <label className="text-xs font-semibold text-slate-300 block">Schedule Send Time</label>
                              <input 
                                type="datetime-local" 
                                value={scheduleAt} 
                                onChange={(e) => setScheduleAt(e.target.value)}
                                className="w-full bg-slate-900/60 rounded-2xl px-4 py-2 text-sm border border-slate-800/80 text-slate-200 focus:border-emerald-500/40 focus:outline-none transition-all" 
                              />
                            </div>
                          </div>

                          {/* Blacklist toggle */}
                          <div className="flex items-center justify-between bg-slate-900/40 border border-slate-800/80 rounded-2xl px-4 py-3.5 shadow-inner">
                            <div className="min-w-0">
                              <p className="text-xs sm:text-sm font-semibold text-slate-200">Filter Blacklisted Targets</p>
                              <p className="text-[10px] text-slate-500 truncate mt-0.5">Skips {blacklist.length} blocked numbers automatically.</p>
                            </div>
                            <button 
                              onClick={() => setFilterBlacklist(!filterBlacklist)}
                              className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${filterBlacklist ? 'bg-emerald-500 shadow-lg shadow-emerald-500/20' : 'bg-slate-800 border border-slate-700'}`}
                            >
                              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${filterBlacklist ? 'left-5' : 'left-0.5'}`} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Sidebar Preview Column */}
                  <div className="lg:col-span-5 space-y-6">
                    
                    {/* WhatsApp Mockup Preview */}
                    <div className="glass-panel rounded-3xl overflow-hidden border border-white/5 shadow-2xl flex flex-col h-[340px] sm:h-[390px]">
                      {/* Phone header mockup */}
                      <div className="bg-slate-900/90 px-4 py-3 border-b border-white/5 flex items-center gap-2.5">
                        <div className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                        <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                        <div className="ml-1.5 flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-400">N</div>
                          <div>
                            <h4 className="text-[10px] sm:text-xs font-bold text-slate-200 leading-none">Campaign Simulator</h4>
                            <span className="text-[8px] sm:text-[9px] text-emerald-400 leading-none mt-0.5 inline-block font-semibold">Live mock render</span>
                          </div>
                        </div>
                      </div>

                      {/* Phone screen mockup messages */}
                      <div 
                        className="flex-1 p-3 sm:p-4 overflow-y-auto space-y-3 bg-[#0d171e]"
                        style={{
                          backgroundImage: `radial-gradient(rgba(16, 185, 129, 0.02) 1px, transparent 0)`,
                          backgroundSize: '16px 16px',
                        }}
                      >
                        <div className="max-w-[88%] ml-auto bg-[#005c4b] text-slate-100 rounded-2xl rounded-tr-none px-3 sm:px-3.5 py-2 sm:py-2.5 text-xs shadow-md space-y-2 relative border border-emerald-800/40 animate-fade-in">
                          {/* File previews inside chat bubble */}
                          {filePreviews.length > 0 && (
                            <div className="space-y-1.5 mb-2 bg-slate-950/25 p-1.5 sm:p-2 rounded-xl border border-emerald-950/20 max-h-36 overflow-y-auto">
                              {filePreviews.map((p, i) => (
                                <div key={i} className="flex items-center gap-2 bg-[#0d171e]/70 p-1.5 rounded-lg border border-white/5 last:mb-0">
                                  {p.type === 'image' ? (
                                    <img src={p.url} alt={p.name} className="w-8 h-8 object-cover rounded-md border border-slate-950" />
                                  ) : (
                                    <div className="w-8 h-8 bg-slate-800 flex items-center justify-center rounded-md border border-slate-700 text-[10px]">📄</div>
                                  )}
                                  <span className="text-[9px] sm:text-[10px] text-slate-300 truncate w-32 font-semibold">{p.name}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          <p 
                            className="whitespace-pre-wrap leading-relaxed break-words font-sans text-slate-100 text-[11px] sm:text-xs"
                            dangerouslySetInnerHTML={{ __html: formatWhatsAppMessage(message.replace(/{name}/gi, 'John')) }}
                          />
                          
                          <div className="flex justify-end items-center gap-1 text-[8px] sm:text-[9px] text-slate-300 mt-1 leading-none">
                            <span>10:42 AM</span>
                            <svg className="w-3 h-3 text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Cost/Estimated Time Summary */}
                    <div className="glass-panel rounded-3xl p-4 sm:p-6 border border-white/5 space-y-6 shadow-lg">
                      <div>
                        <h3 className="text-sm font-bold text-slate-200 tracking-tight">Campaign Summary</h3>
                        <p className="text-[11px] text-slate-500">Estimations before dispatching queue.</p>
                      </div>

                      <div className="grid grid-cols-2 gap-3.5">
                        <div className="bg-slate-900/60 p-3 rounded-2xl border border-slate-800">
                          <span className="text-[9px] sm:text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Duration</span>
                          <h4 className="text-base sm:text-lg font-bold text-slate-100 mt-0.5">{totalMins} <span className="text-[11px] font-normal text-slate-400">mins</span></h4>
                        </div>
                        <div className="bg-slate-900/60 p-3 rounded-2xl border border-slate-800">
                          <span className="text-[9px] sm:text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Delay Rate</span>
                          <h4 className="text-base sm:text-lg font-bold text-slate-100 mt-0.5">{delay}s <span className="text-[11px] font-normal text-slate-400">fixed</span></h4>
                        </div>
                      </div>

                      {/* Cost/Ban Safety Badge */}
                      <div className="flex items-center justify-between bg-emerald-500/5 border border-emerald-500/10 rounded-2xl px-3 sm:px-4 py-2.5 sm:py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-5.5 h-5.5 rounded-full bg-emerald-500/10 flex items-center justify-center text-xs">🛡️</div>
                          <div>
                            <h5 className="text-[10px] sm:text-[11px] font-bold text-emerald-400">Safety Index: Maximum</h5>
                            <p className="text-[9px] text-slate-500 leading-none mt-0.5">Throttling limits simulate natural users.</p>
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={send}
                        disabled={!canSend}
                        className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 disabled:bg-slate-900 disabled:text-slate-600 disabled:border disabled:border-slate-800/80 text-slate-950 font-bold rounded-2xl transition-all shadow-lg shadow-emerald-500/5 disabled:shadow-none text-xs sm:text-sm tracking-wide uppercase"
                      >
                        {scheduleAt ? '📅 Schedule Campaign' : '🚀 Launch Campaign'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 3: Sending */}
              {step === 'sending' && (
                <div className="grid lg:grid-cols-12 gap-6 sm:gap-8 items-start">
                  
                  {/* Stats Progress block */}
                  <div className="lg:col-span-5 space-y-6">
                    <div className="glass-panel rounded-3xl p-4 sm:p-6 border border-white/5 space-y-6 shadow-lg">
                      <div>
                        <span className="text-[10px] font-bold text-sky-400 tracking-widest uppercase bg-sky-950/50 px-2.5 py-1 rounded-md border border-sky-900/60 inline-block mb-3 animate-pulse">
                          Broadcasting Live
                        </span>
                        <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Campaign Dispatch</h2>
                        <p className="text-slate-400 text-xs sm:text-sm mt-0.5">Please keep this browser window open.</p>
                      </div>

                      {/* Progress bar */}
                      <div className="space-y-2">
                        <div className="flex justify-between text-[11px] sm:text-xs font-mono font-semibold">
                          <span className="text-slate-400">Delivery Ratio</span>
                          <span className="text-emerald-400">{sentCount} of {results.length} processed</span>
                        </div>
                        <div className="w-full bg-slate-900 rounded-full h-2 sm:h-2.5 overflow-hidden border border-slate-800">
                          <div
                            className="bg-gradient-to-r from-emerald-500 to-emerald-300 h-full rounded-full transition-all duration-500 shadow-md shadow-emerald-500/20"
                            style={{ width: `${results.length ? (sentCount / results.length) * 100 : 0}%` }}
                          />
                        </div>
                      </div>

                      {limitReached && (
                        <div className="bg-orange-500/10 border border-orange-500/20 rounded-2xl px-4 py-3 text-xs sm:text-sm text-orange-400 font-semibold shadow-inner">
                          ⚠️ Daily limit of {dailyLimit} reached. Campaign paused.
                        </div>
                      )}

                      {/* Play/Pause Control Buttons */}
                      <div className="flex items-center justify-between bg-slate-900/40 border border-slate-800/85 p-3 rounded-2xl shadow-inner">
                        <span className="text-xs font-bold text-slate-300">
                          Status: {isPaused ? <span className="text-amber-400 font-black">PAUSED</span> : <span className="text-emerald-400 font-black">RUNNING</span>}
                        </span>
                        <button 
                          onClick={togglePause}
                          className={`text-xs px-3.5 py-1.5 rounded-xl font-bold transition-all border
                            ${isPaused 
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25 hover:bg-emerald-500/20' 
                              : 'bg-amber-500/10 text-amber-400 border-amber-500/25 hover:bg-amber-500/20'}`}
                        >
                          {isPaused ? '▶ Resume' : '⏸ Pause'}
                        </button>
                      </div>

                      {/* Countdown / Cooldown Timer */}
                      {!isPaused && countdown > 0 && (
                        <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-4 sm:p-5 flex items-center justify-between shadow-inner animate-pulse-glow">
                          <div className="space-y-1 min-w-0 flex-1 pr-3">
                            <h4 className="text-xs font-bold text-amber-400">Ban-Prevention Cool Down</h4>
                            <p className="text-[9px] sm:text-[10px] text-slate-500 truncate">Preparing package for: <span className="font-mono text-slate-400 font-semibold">+{nextNum}</span></p>
                          </div>
                          <div className="flex items-baseline gap-0.5 sm:gap-1 bg-amber-500/10 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl border border-amber-500/20 flex-shrink-0">
                            <span className="text-xl sm:text-2xl font-black font-mono text-amber-300 leading-none">{countdown}</span>
                            <span className="text-[9px] sm:text-[10px] text-amber-400 font-bold uppercase tracking-wider font-mono">sec</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Scrolling Results stream */}
                  <div className="lg:col-span-7">
                    <div className="glass-panel rounded-3xl p-4 sm:p-6 border border-white/5 flex flex-col h-[350px] sm:h-[400px] shadow-lg">
                      <div className="flex items-center justify-between pb-3 sm:pb-4 border-b border-slate-800/80">
                        <div>
                          <h3 className="text-sm font-bold text-slate-200">Delivery Status Stream</h3>
                          <p className="text-[11px] text-slate-500">Real-time response logs.</p>
                        </div>
                      </div>

                      <div ref={resultsRef} className="flex-1 overflow-y-auto mt-4 pr-1 space-y-1.5 sm:space-y-2">
                        {results.map((r, i) => (
                          <div
                            key={i}
                            className={`flex items-center justify-between rounded-xl px-3 sm:px-4 py-2.5 sm:py-3 transition-all duration-300 border
                              ${r.status === 'sending' 
                                ? 'bg-sky-500/5 border-sky-500/20' 
                                : r.status === 'success'
                                ? 'bg-emerald-500/5 border-emerald-500/10'
                                : r.status === 'failed'
                                ? 'bg-rose-500/5 border-rose-500/10'
                                : 'bg-slate-900/30 border-slate-900'
                              }`}
                          >
                            <div className="flex items-center gap-2.5 sm:gap-3">
                              <span className="w-2.5 h-2.5 rounded-full bg-slate-700 font-mono text-[9px] sm:text-[10px] text-slate-500 flex items-center justify-center">
                                {i + 1}
                              </span>
                              <div className="flex flex-col">
                                <span className="font-mono text-[11px] sm:text-xs font-bold text-slate-300">+{r.number}</span>
                                {r.name && <span className="text-[9px] text-slate-500 font-semibold">{r.name}</span>}
                              </div>
                            </div>
                            <StatusBadge status={r.status} error={r.error} />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 4: Done */}
              {step === 'done' && (
                <div className="max-w-2xl mx-auto glass-panel rounded-3xl p-5 sm:p-8 border border-white/5 text-center space-y-6 sm:space-y-8 shadow-2xl relative overflow-hidden">
                  <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 via-teal-500 to-sky-500" />
                  
                  <div className="space-y-3 sm:space-y-4">
                    <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-2xl sm:text-3xl mx-auto animate-float">
                      {failedCount === 0 ? '🎉' : '✅'}
                    </div>
                    <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Campaign Dispatch Concluded</h2>
                    <p className="text-slate-400 text-xs sm:text-sm">All entries in the queue have been fully processed.</p>
                  </div>

                  {/* Delivery summary statistics */}
                  <div className="grid grid-cols-3 gap-3.5 max-w-sm mx-auto">
                    <div className="bg-slate-900/60 p-3 rounded-2xl border border-slate-800 shadow-inner">
                      <span className="text-[9px] sm:text-[10px] text-emerald-400 font-bold uppercase tracking-wider">Delivered</span>
                      <h4 className="text-xl sm:text-2xl font-black text-slate-100 mt-0.5 sm:mt-1">{successCount}</h4>
                    </div>
                    <div className="bg-slate-900/60 p-3 rounded-2xl border border-slate-800 shadow-inner">
                      <span className="text-[9px] sm:text-[10px] text-slate-400 font-bold uppercase tracking-wider">Total</span>
                      <h4 className="text-xl sm:text-2xl font-black text-slate-200 mt-0.5 sm:mt-1">{results.length}</h4>
                    </div>
                    <div className="bg-slate-900/60 p-3 rounded-2xl border border-slate-800 shadow-inner">
                      <span className={`text-[9px] sm:text-[10px] font-bold uppercase tracking-wider ${failedCount > 0 ? 'text-rose-400 animate-pulse' : 'text-slate-500'}`}>
                        Failed
                      </span>
                      <h4 className={`text-xl sm:text-2xl font-black mt-0.5 sm:mt-1 ${failedCount > 0 ? 'text-rose-400' : 'text-slate-400'}`}>{failedCount}</h4>
                    </div>
                  </div>

                  {/* Actions buttons */}
                  <div className="flex flex-wrap justify-center gap-3 pt-2">
                    <button 
                      onClick={() => exportCSV(results, message)} 
                      className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 font-semibold rounded-2xl text-xs sm:text-sm transition-all"
                    >
                      📥 Export Results CSV
                    </button>
                    {failedCount > 0 && (
                      <button 
                        onClick={retryFailed} 
                        className="px-5 py-2.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 font-semibold rounded-2xl text-xs sm:text-sm transition-all shadow-lg shadow-rose-950/10"
                      >
                        🔄 Retry Failed
                      </button>
                    )}
                    <button 
                      onClick={() => { setStep('compose'); setResults([]); setSentCount(0); setCountdown(0); }} 
                      className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-2xl text-xs sm:text-sm transition-all"
                    >
                      Compose New Campaign
                    </button>
                  </div>

                  {/* Detailed failures block */}
                  {failedCount > 0 && (
                    <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5 text-left space-y-3 shadow-inner">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold text-slate-300">Detailed Failure Log</h4>
                        <button
                          onClick={copyFailedNumbers}
                          className="text-[9px] sm:text-[10px] text-emerald-400 hover:text-emerald-300 font-bold uppercase tracking-wider flex items-center gap-1"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                          </svg>
                          Copy Failed List
                        </button>
                      </div>
                      <div className="max-h-32 sm:max-h-36 overflow-y-auto space-y-1.5 pr-1 sm:pr-2">
                        {results.filter((r) => r.status === 'failed').map((r, i) => (
                          <div key={i} className="flex justify-between items-center text-xs py-1.5 border-b border-slate-800/40 last:border-0">
                            <span className="font-mono text-slate-300 font-bold text-[11px] sm:text-xs">
                              +{r.number}{r.name ? ` (${r.name})` : ''}
                            </span>
                            <span className="text-rose-400/80 bg-rose-500/5 px-2 py-0.5 border border-rose-500/10 rounded max-w-[55%] truncate font-mono text-[9px] sm:text-[10px]" title={r.error}>
                              {r.error || 'Connection Timeout'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ──────────────── TEMPLATES VIEW ──────────────── */}
          {view === 'templates' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl sm:text-2xl font-bold tracking-tight bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">Message Templates</h2>
                  <p className="text-xs text-slate-500 mt-0.5">Quick canned messages library.</p>
                </div>
                <span className="text-xs text-slate-400 font-semibold bg-slate-900 border border-slate-800 px-3 py-1 rounded-xl">
                  {templates.length} saved
                </span>
              </div>

              <div className="grid lg:grid-cols-12 gap-6 sm:gap-8 items-start">
                {/* Left Column: Form */}
                <div className="lg:col-span-5">
                  <div className="glass-panel rounded-3xl p-5 border border-white/5 space-y-4 shadow-lg sticky top-24">
                    <p className="text-sm font-bold text-emerald-400">{editTemplateId ? '✏️ Edit Template' : '➕ Create New Template'}</p>
                    <input 
                      value={newTemplateName} 
                      onChange={(e) => setNewTemplateName(e.target.value)} 
                      placeholder="Template name (e.g. Diwali Offer)"
                      className="w-full bg-slate-900/60 rounded-2xl px-4 py-3 text-sm text-slate-100 placeholder-slate-600 border border-slate-800/80 focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/10 focus:outline-none transition-all" 
                    />
                    <textarea 
                      value={newTemplateMsg} 
                      onChange={(e) => setNewTemplateMsg(e.target.value)}
                      placeholder={'Write your message...\nUse {name} for variable personalization.'}
                      className="w-full h-36 bg-slate-900/60 rounded-2xl px-4 py-3 text-sm text-slate-100 placeholder-slate-600 resize-none border border-slate-800/80 focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/10 focus:outline-none leading-relaxed transition-all" 
                    />
                    
                    <div className="flex gap-2.5 pt-2">
                      <button 
                        onClick={saveTemplate} 
                        className="px-6 py-2.5 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-slate-950 font-bold rounded-2xl text-xs sm:text-sm transition-all"
                      >
                        {editTemplateId ? 'Update Template' : 'Save Template'}
                      </button>
                      {editTemplateId && (
                        <button 
                          onClick={() => { setEditTemplateId(''); setNewTemplateName(''); setNewTemplateMsg(''); }} 
                          className="px-5 py-2.5 bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-300 font-semibold rounded-2xl text-xs sm:text-sm transition-all"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Column: List of saved templates */}
                <div className="lg:col-span-7 space-y-4">
                  {templates.length > 0 ? (
                    <div className="grid sm:grid-cols-2 gap-4">
                      {templates.map((t) => (
                        <div key={t.id} className="glass-panel rounded-3xl p-5 border border-white/5 space-y-3.5 shadow-lg group relative hover:border-emerald-500/20 transition-all duration-300 flex flex-col justify-between">
                          <div className="space-y-3">
                            <div className="flex items-start justify-between">
                              <p className="font-bold text-slate-200 text-sm sm:text-base leading-tight truncate max-w-[70%]">{t.name}</p>
                            </div>
                            <div className="bg-slate-950/45 p-3 rounded-2xl border border-slate-900 min-h-[80px]">
                              <p className="text-xs text-slate-400 whitespace-pre-wrap leading-relaxed font-sans line-clamp-4">{t.message}</p>
                            </div>
                          </div>
                          <div className="flex gap-3 mt-4 pt-3 border-t border-slate-900/60 justify-end">
                            <button onClick={() => { setEditTemplateId(t.id); setNewTemplateName(t.name); setNewTemplateMsg(t.message); window.scrollTo(0,0); }} className="text-[10px] text-slate-400 hover:text-emerald-400 font-bold uppercase tracking-wider transition-colors">Edit</button>
                            <button onClick={() => { setMessage(t.message); setView('campaign'); }} className="text-[10px] text-emerald-400 hover:text-emerald-300 font-bold uppercase tracking-wider transition-colors">Use</button>
                            <button onClick={() => { templatesStore.delete(t.id); setTemplates(templatesStore.getAll()); }} className="text-[10px] text-rose-400 hover:text-rose-300 font-bold uppercase tracking-wider transition-colors">Delete</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-16 text-slate-600 glass-panel border border-white/5 rounded-3xl">
                      <p className="text-4xl mb-3 animate-float">📋</p>
                      <p className="text-sm font-semibold">No Templates Yet</p>
                      <p className="text-[11px] text-slate-500 mt-1">Create one to quickly use canned texts in campaigns.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ──────────────── GROUPS VIEW ──────────────── */}
          {view === 'groups' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl sm:text-2xl font-bold tracking-tight bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">Contact Groups</h2>
                  <p className="text-xs text-slate-500 mt-0.5">Organize saved phone books.</p>
                </div>
                <span className="text-xs text-slate-400 font-semibold bg-slate-900 border border-slate-800 px-3 py-1 rounded-xl">
                  {groups.length} groups
                </span>
              </div>

              <div className="grid lg:grid-cols-12 gap-6 sm:gap-8 items-start">
                {/* Left Column: Form */}
                <div className="lg:col-span-5">
                  <div className="glass-panel rounded-3xl p-5 border border-white/5 space-y-4 shadow-lg sticky top-24">
                    <p className="text-sm font-bold text-emerald-400">👥 New Group</p>
                    <input 
                      value={newGroupName} 
                      onChange={(e) => setNewGroupName(e.target.value)} 
                      placeholder="Group name (e.g. VIP Customers)"
                      className="w-full bg-slate-900/60 rounded-2xl px-4 py-3 text-sm text-slate-100 placeholder-slate-600 border border-slate-800/80 focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/10 focus:outline-none transition-all" 
                    />
                    <textarea 
                      value={newGroupNumbers} 
                      onChange={(e) => setNewGroupNumbers(e.target.value)}
                      placeholder={'919876543210,John\n919876543211,Jane\n919876543212'}
                      className="w-full h-36 bg-slate-900/60 rounded-2xl px-4 py-3 text-sm text-slate-100 placeholder-slate-600 font-mono resize-none border border-slate-800/80 focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/10 focus:outline-none leading-relaxed transition-all" 
                    />
                    <div className="flex justify-between items-center pt-1.5">
                      <p className="text-[10px] text-slate-500 font-semibold leading-none">Format: <span className="text-slate-400">number,name</span></p>
                      <button 
                        onClick={saveGroup} 
                        className="px-6 py-2.5 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-slate-950 font-bold rounded-2xl text-xs sm:text-sm transition-all"
                      >
                        Save Group
                      </button>
                    </div>
                  </div>
                </div>

                {/* Right Column: Listing */}
                <div className="lg:col-span-7 space-y-4">
                  {groups.length > 0 ? (
                    <div className="grid sm:grid-cols-2 gap-4">
                      {groups.map((g) => (
                        <div key={g.id} className="glass-panel rounded-3xl p-5 border border-white/5 space-y-4 shadow-lg hover:border-emerald-500/20 transition-all duration-300 flex flex-col justify-between">
                          <div className="space-y-3">
                            <div className="flex items-center justify-between border-b border-slate-900 pb-3">
                              <div>
                                <p className="font-bold text-slate-200 text-base leading-tight truncate max-w-[140px]">{g.name}</p>
                                <p className="text-xs text-slate-500 mt-0.5">{g.contacts.length} recipients</p>
                              </div>
                            </div>
                            
                            {/* Contacts preview tags */}
                            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                              {g.contacts.slice(0, 8).map((c, i) => (
                                <span key={i} className="text-[10px] bg-slate-900 border border-slate-800/80 px-2.5 py-0.5 rounded-full text-slate-400 font-mono font-medium">
                                  {c.name || `+${c.number}`}
                                </span>
                              ))}
                              {g.contacts.length > 8 && (
                                <span className="text-[10px] text-slate-500 font-bold self-center ml-1">
                                  +{g.contacts.length - 8} more
                                </span>
                              )}
                            </div>
                          </div>
                          
                          <div className="flex gap-3 mt-4 pt-3 border-t border-slate-900/60 justify-end">
                            <button onClick={() => { setSelectedGroup(g.id); setInputMode('group'); setContacts(g.contacts); setView('campaign'); }} className="text-[10px] text-emerald-400 hover:text-emerald-300 font-bold uppercase tracking-wider transition-colors">Use</button>
                            <button onClick={() => { groupsStore.delete(g.id); setGroups(groupsStore.getAll()); }} className="text-[10px] text-rose-400 hover:text-rose-300 font-bold uppercase tracking-wider transition-colors">Delete</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-16 text-slate-600 glass-panel border border-white/5 rounded-3xl">
                      <p className="text-4xl mb-3 animate-float">👥</p>
                      <p className="text-sm font-semibold">No Saved Groups</p>
                      <p className="text-[11px] text-slate-500 mt-1">Combine contacts into reusable address lists.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ──────────────── BLACKLIST VIEW ──────────────── */}
          {view === 'blacklist' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl sm:text-2xl font-bold tracking-tight bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">Numbers Blacklist</h2>
                  <p className="text-xs text-slate-500 mt-0.5">Block numbers from marketing broadcasts.</p>
                </div>
                <span className="text-xs text-slate-400 font-semibold bg-slate-900 border border-slate-800 px-3 py-1 rounded-xl">
                  {blacklist.length} blocked
                </span>
              </div>

              <div className="grid lg:grid-cols-12 gap-6 sm:gap-8 items-start">
                {/* Left Column: Form */}
                <div className="lg:col-span-5">
                  <div className="glass-panel rounded-3xl p-5 border border-white/5 space-y-4 shadow-lg sticky top-24">
                    <p className="text-sm text-slate-400 leading-relaxed">Numbers in this list will be skipped automatically during campaign dispatch.</p>
                    <div className="space-y-3">
                      <input 
                        value={newBlacklistNum} 
                        onChange={(e) => setNewBlacklistNum(e.target.value)} 
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const n = newBlacklistNum.replace(/\D/g,'');
                            if (n.length >= 7) {
                              blacklistStore.add(n);
                              setBlacklist(blacklistStore.getAll());
                              setNewBlacklistNum('');
                            }
                          }
                        }}
                        placeholder="E.g. 919876543210" 
                        className="w-full bg-slate-900/60 rounded-2xl px-4 py-3 text-sm text-slate-100 placeholder-slate-600 border border-slate-800/80 focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/10 focus:outline-none transition-all" 
                      />
                      <button 
                        onClick={() => {
                          const n = newBlacklistNum.replace(/\D/g,'');
                          if (n.length >= 7) {
                            blacklistStore.add(n);
                            setBlacklist(blacklistStore.getAll());
                            setNewBlacklistNum('');
                          }
                        }}
                        className="w-full py-2.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 font-bold rounded-2xl text-xs sm:text-sm transition-all"
                      >
                        Block Number
                      </button>
                    </div>
                  </div>
                </div>

                {/* Right Column: Listing */}
                <div className="lg:col-span-7 space-y-4">
                  {blacklist.length > 0 ? (
                    <div className="glass-panel rounded-3xl border border-white/5 overflow-hidden shadow-lg animate-fade-in">
                      <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-slate-900/50 bg-slate-900/20 animate-fade-in">
                        {blacklist.map((n) => (
                          <div key={n} className="flex items-center justify-between px-5 py-3.5 hover:bg-slate-900/20 transition-colors border-b border-slate-900/50 sm:border-b-0">
                            <span className="font-mono text-sm font-semibold text-slate-300">+{n}</span>
                            <button 
                              onClick={() => { blacklistStore.remove(n); setBlacklist(blacklistStore.getAll()); }} 
                              className="text-[10px] text-rose-400 hover:text-rose-300 font-bold uppercase tracking-wider"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-16 text-slate-600 glass-panel border border-white/5 rounded-3xl">
                      <p className="text-4xl mb-3 animate-float">🚫</p>
                      <p className="text-sm font-semibold">Blacklist is Empty</p>
                      <p className="text-[11px] text-slate-500 mt-1">Blocked numbers will be protected from promotional campaigns.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ──────────────── HISTORY VIEW ──────────────── */}
          {view === 'history' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h2 className="text-xl sm:text-2xl font-bold tracking-tight bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">Campaign History</h2>
                  <p className="text-xs text-slate-500 mt-0.5">Review dispatch logs and results.</p>
                </div>
                {historyItems.length > 0 && (
                  <button 
                    onClick={() => { historyStore.clear(); setHistoryItems([]); }} 
                    className="text-[10px] text-rose-400 hover:text-rose-300 font-bold uppercase tracking-wider bg-rose-500/5 px-3 py-1.5 border border-rose-500/10 rounded-xl"
                  >
                    Clear History
                  </button>
                )}
              </div>

              {/* History list */}
              <div className="grid md:grid-cols-2 gap-4">
                {historyItems.map((h) => {
                  const isExp = expandedHistory === h.id;
                  return (
                    <div key={h.id} className="glass-panel rounded-3xl overflow-hidden shadow-lg border border-white/5 hover:border-white/10 transition-all duration-300 flex flex-col">
                      <button 
                        onClick={() => setExpandedHistory(isExp ? '' : h.id)}
                        className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-900/30 transition-colors text-left"
                      >
                        <div className="min-w-0 pr-4 flex-grow">
                          <p className="text-xs sm:text-sm font-bold text-slate-200 truncate max-w-sm sm:max-w-2xl">{h.message}</p>
                          <p className="text-[10px] text-slate-500 mt-1 font-semibold">{new Date(h.date).toLocaleString()}</p>
                        </div>
                        <div className="flex items-center gap-4 flex-shrink-0">
                          <div className="text-right">
                            <p className="text-xs sm:text-sm font-black text-emerald-400">{h.success} / {h.total}</p>
                            <p className="text-[9px] sm:text-[10px] text-slate-500 font-mono mt-0.5">{fmtDuration(h.duration)}</p>
                          </div>
                          <span className="text-slate-600 text-xs">{isExp ? '▲' : '▼'}</span>
                        </div>
                      </button>

                      {isExp && (
                        <div className="px-5 pb-5 border-t border-slate-900 bg-slate-900/10 space-y-4 pt-3.5 flex-grow">
                          {/* Aggregated Stats boxes */}
                          <div className="flex items-center gap-4">
                            <div className="text-center bg-slate-900/50 border border-slate-800/80 px-4 py-2 rounded-2xl min-w-16 shadow-inner">
                              <p className="text-base font-black text-emerald-400">{h.success}</p>
                              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Sent</p>
                            </div>
                            <div className="text-center bg-slate-900/50 border border-slate-800/80 px-4 py-2 rounded-2xl min-w-16 shadow-inner">
                              <p className="text-base font-black text-rose-400">{h.failed}</p>
                              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Failed</p>
                            </div>
                            <div className="text-center bg-slate-900/50 border border-slate-800/80 px-4 py-2 rounded-2xl min-w-16 shadow-inner">
                              <p className="text-base font-black text-slate-300">{h.total}</p>
                              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Total</p>
                            </div>
                            
                            <button 
                              onClick={() => exportCSV(h.results, h.message)} 
                              className="ml-auto text-[10px] bg-slate-900 hover:bg-slate-800 px-3.5 py-2 border border-slate-800 text-slate-300 font-bold uppercase tracking-wider rounded-xl transition-all"
                            >
                              📥 Export
                            </button>
                          </div>

                          {/* Recipient list statuses */}
                          <div className="grid sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                            {h.results.map((r, i) => (
                              <div key={i} className="flex justify-between items-center text-xs bg-slate-950/20 border border-slate-900/60 px-3.5 py-2 rounded-xl">
                                <span className="font-mono text-slate-300 font-bold text-[11px] truncate max-w-[65%]">
                                  +{r.number}{r.name ? ` (${r.name})` : ''}
                                </span>
                                <span className={`text-[10px] font-bold uppercase tracking-wider flex-shrink-0 ${r.status === 'success' ? 'text-emerald-400' : 'text-rose-400'}`}>
                                  {r.status === 'success' ? '✓ Delivered' : '✕ Failed'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {historyItems.length === 0 && (
                  <div className="text-center py-16 text-slate-600 glass-panel border border-white/5 rounded-3xl">
                    <p className="text-4xl mb-3 animate-float">📊</p>
                    <p className="text-sm font-semibold">No Campaigns Recorded</p>
                    <p className="text-[11px] text-slate-500 mt-1">Previous execution logs will be catalogued here.</p>
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
