import { getStatus } from '@/lib/whatsapp-client';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ status: getStatus() });
}
