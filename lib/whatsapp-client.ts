import { Client, LocalAuth } from 'whatsapp-web.js';
import EventEmitter from 'events';

type Status = 'disconnected' | 'initializing' | 'qr' | 'ready';

interface WaState {
  client?: Client;
  status: Status;
  qr?: string;
  paused: boolean;
  emitter: EventEmitter;
}

const KEY = '__wa_state__';
const g = global as unknown as Record<string, WaState | undefined>;

if (!g[KEY]) {
  const em = new EventEmitter();
  em.setMaxListeners(100);
  g[KEY] = { status: 'disconnected', paused: false, emitter: em };
}

const state = g[KEY]!;

export const getStatus = (): Status => state.status;
export const getQR = (): string | undefined => state.qr;
export const getClient = (): Client | undefined => state.client;
export const emitter: EventEmitter = state.emitter;
export const isPaused = (): boolean => state.paused;
export const setPaused = (v: boolean): void => { state.paused = v; };

export function initClient(): void {
  if (state.status === 'ready' || state.status === 'initializing') return;

  state.status = 'initializing';
  emitter.emit('status', 'initializing');

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--disable-gpu',
      ],
    },
  });

  state.client = client;

  client.on('qr', (qr: string) => {
    state.qr = qr;
    state.status = 'qr';
    emitter.emit('qr', qr);
    emitter.emit('status', 'qr');
  });

  client.on('ready', () => {
    state.status = 'ready';
    state.qr = undefined;
    emitter.emit('ready');
    emitter.emit('status', 'ready');
  });

  client.on('auth_failure', () => {
    state.status = 'disconnected';
    state.client = undefined;
    emitter.emit('status', 'disconnected');
  });

  client.on('disconnected', () => {
    state.status = 'disconnected';
    state.client = undefined;
    emitter.emit('status', 'disconnected');
  });

  client.initialize().catch((err: unknown) => {
    console.error('WhatsApp init error:', err);
    state.status = 'disconnected';
    state.client = undefined;
    emitter.emit('status', 'disconnected');
  });
}
