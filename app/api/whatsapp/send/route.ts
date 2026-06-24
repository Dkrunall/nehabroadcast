import { NextRequest } from 'next/server';
import { getClient, isPaused, setPaused } from '@/lib/whatsapp-client';
import { MessageMedia } from 'whatsapp-web.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 3600;

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const contactsRaw = formData.get('contacts') as string;
  const message = formData.get('message') as string;
  const fileItems = formData.getAll('files') as File[];
  const delayMs = parseInt((formData.get('delay') as string) || '40000');
  const dailyLimit = parseInt((formData.get('dailyLimit') as string) || '0');

  const contacts: { number: string; name: string }[] = JSON.parse(contactsRaw || '[]');

  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {}
      };

      const client = getClient();
      if (!client) {
        send({ type: 'error', message: 'WhatsApp not connected' });
        controller.close();
        return;
      }

      // Reset pause state at start
      setPaused(false);

      // Pre-process media files
      const mediaItems: MessageMedia[] = [];
      for (const file of fileItems) {
        if (file.size > 0) {
          const buffer = await file.arrayBuffer();
          const base64 = Buffer.from(buffer).toString('base64');
          mediaItems.push(new MessageMedia(file.type, base64, file.name));
        }
      }

      send({ type: 'start', total: contacts.length });
      let dailySent = 0;

      for (let i = 0; i < contacts.length; i++) {
        const contact = contacts[i];

        // Daily limit check
        if (dailyLimit > 0 && dailySent >= dailyLimit) {
          send({ type: 'limit_reached', sent: dailySent, limit: dailyLimit });
          break;
        }

        send({ type: 'sending', index: i, number: contact.number, name: contact.name });

        // Personalize message
        const personalizedMsg = message.replace(/{name}/gi, contact.name || 'Friend');
        const chatId = `${contact.number}@c.us`;

        try {
          if (mediaItems.length > 0) {
            // First file gets the caption (message)
            await client.sendMessage(chatId, mediaItems[0], { caption: personalizedMsg });
            // Additional files sent without caption
            for (let m = 1; m < mediaItems.length; m++) {
              await client.sendMessage(chatId, mediaItems[m]);
            }
          } else {
            await client.sendMessage(chatId, personalizedMsg);
          }
          send({ type: 'sent', index: i, number: contact.number, name: contact.name, status: 'success' });
          dailySent++;
        } catch (err) {
          send({
            type: 'sent',
            index: i,
            number: contact.number,
            name: contact.name,
            status: 'failed',
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }

        // Countdown with pause support
        if (i < contacts.length - 1) {
          const totalSecs = Math.ceil(delayMs / 1000);
          for (let s = totalSecs; s > 0; s--) {
            // Handle pause
            while (isPaused()) {
              send({ type: 'paused' });
              await new Promise((r) => setTimeout(r, 1000));
            }
            send({ type: 'countdown', seconds: s, next: contacts[i + 1].number });
            await new Promise((r) => setTimeout(r, 1000));
          }
        }
      }

      send({ type: 'complete' });
      controller.close();
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
