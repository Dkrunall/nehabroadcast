import { NextRequest } from 'next/server';
import { isPaused, setPaused } from '@/lib/whatsapp-client';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ paused: isPaused() });
}

export async function POST(req: NextRequest) {
  const { paused } = await req.json();
  setPaused(paused);
  return Response.json({ paused: isPaused() });
}
