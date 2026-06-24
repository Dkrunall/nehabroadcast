import { NextRequest } from 'next/server';
import { initClient, emitter, getStatus, getQR } from '@/lib/whatsapp-client';
import QRCode from 'qrcode';

export const dynamic = 'force-dynamic';

export async function POST() {
  initClient();
  return Response.json({ ok: true });
}

export async function GET(req: NextRequest) {
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {}
      };

      const status = getStatus();
      send({ type: 'status', status });

      const qr = getQR();
      if (qr) {
        const qrImage = await QRCode.toDataURL(qr);
        send({ type: 'qr', qrImage });
      }

      const onStatus = (s: string) => send({ type: 'status', status: s });

      const onQR = async (raw: string) => {
        try {
          const qrImage = await QRCode.toDataURL(raw);
          send({ type: 'qr', qrImage });
        } catch {}
      };

      emitter.on('status', onStatus);
      emitter.on('qr', onQR);

      req.signal.addEventListener('abort', () => {
        emitter.off('status', onStatus);
        emitter.off('qr', onQR);
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
