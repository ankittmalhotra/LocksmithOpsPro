import { NextResponse } from 'next/server';
import { withRequestLogging } from '@/lib/request-logger';

async function handlePOST() {
  // Stripe customer payments are disabled for now. Keep this endpoint closed
  // so a browser cannot simulate a successful payment.
  return NextResponse.json(
    { success: false, error: 'Stripe customer payments are currently disabled.' },
    { status: 410 }
  );
}

export const POST = withRequestLogging('/api/webhooks/stripe', handlePOST);
