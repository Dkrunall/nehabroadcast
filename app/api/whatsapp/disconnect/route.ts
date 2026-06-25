import { destroyClient } from '@/lib/whatsapp-client';

export const dynamic = 'force-dynamic';

export async function POST() {
  await destroyClient();
  return Response.json({ status: 'disconnected' });
}
