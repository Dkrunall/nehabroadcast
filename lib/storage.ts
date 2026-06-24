export interface Template {
  id: string;
  name: string;
  message: string;
  createdAt: string;
}

export interface Contact {
  number: string;
  name: string;
}

export interface Group {
  id: string;
  name: string;
  contacts: Contact[];
  createdAt: string;
}

export interface CampaignRecord {
  id: string;
  date: string;
  message: string;
  total: number;
  success: number;
  failed: number;
  duration: number;
  results: { number: string; name: string; status: string; error?: string }[];
}

export const genId = () => Math.random().toString(36).slice(2, 10);

function read<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(key, JSON.stringify(value));
}

// ── Templates ────────────────────────────────────────────
export const templatesStore = {
  getAll: () => read<Template[]>('wa_templates', []),
  save: (t: Template) => {
    const all = templatesStore.getAll();
    const idx = all.findIndex((x) => x.id === t.id);
    if (idx >= 0) all[idx] = t;
    else all.unshift(t);
    write('wa_templates', all);
  },
  delete: (id: string) => write('wa_templates', templatesStore.getAll().filter((t) => t.id !== id)),
};

// ── Groups ────────────────────────────────────────────────
export const groupsStore = {
  getAll: () => read<Group[]>('wa_groups', []),
  save: (g: Group) => {
    const all = groupsStore.getAll();
    const idx = all.findIndex((x) => x.id === g.id);
    if (idx >= 0) all[idx] = g;
    else all.unshift(g);
    write('wa_groups', all);
  },
  delete: (id: string) => write('wa_groups', groupsStore.getAll().filter((g) => g.id !== id)),
};

// ── Blacklist ─────────────────────────────────────────────
export const blacklistStore = {
  getAll: () => read<string[]>('wa_blacklist', []),
  add: (number: string) => {
    const all = blacklistStore.getAll();
    if (!all.includes(number)) { all.push(number); write('wa_blacklist', all); }
  },
  remove: (number: string) => write('wa_blacklist', blacklistStore.getAll().filter((n) => n !== number)),
  has: (number: string) => blacklistStore.getAll().includes(number),
};

// ── History ───────────────────────────────────────────────
export const historyStore = {
  getAll: () => read<CampaignRecord[]>('wa_history', []),
  save: (record: CampaignRecord) => {
    const all = historyStore.getAll();
    all.unshift(record);
    if (all.length > 50) all.pop();
    write('wa_history', all);
  },
  clear: () => write('wa_history', []),
};

// ── Daily Limit ───────────────────────────────────────────
export const dailyStore = {
  get: () => {
    const today = new Date().toISOString().split('T')[0];
    const stored = read<{ date: string; count: number }>('wa_daily', { date: '', count: 0 });
    return stored.date === today ? stored : { date: today, count: 0 };
  },
  increment: () => {
    const d = dailyStore.get();
    d.count += 1;
    write('wa_daily', d);
  },
};
