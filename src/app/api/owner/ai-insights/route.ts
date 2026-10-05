import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { buildAdminInsightsSnapshot } from '@/lib/admin-insights';
import {
  generateAdminInsights,
  GeminiAdminInsightsApiError,
  GeminiAdminInsightsConfigurationError,
} from '@/lib/gemini-admin-insights';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';

export const dynamic = 'force-dynamic';

async function adminOnly(): Promise<NextResponse | null> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'ADMIN') return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
  return null;
}

async function handleGET(request: NextRequest) {
  try {
    const denied = await adminOnly();
    if (denied) return denied;
    const snapshot = await buildAdminInsightsSnapshot();
    return NextResponse.json({ success: true, snapshot }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    logCaughtRequestError(request, '/api/owner/ai-insights', error);
    return NextResponse.json({ success: false, error: 'Unable to load Admin Insights.' }, { status: 500, headers: { 'Cache-Control': 'private, no-store' } });
  }
}

async function handlePOST(request: NextRequest) {
  try {
    const denied = await adminOnly();
    if (denied) return denied;
    const body = await request.json().catch(() => ({}));
    if (body?.action !== 'generate-ai') {
      return NextResponse.json({ success: false, error: 'Choose Generate AI insights to request an AI narrative.' }, { status: 400, headers: { 'Cache-Control': 'private, no-store' } });
    }
    const snapshot = await buildAdminInsightsSnapshot();
    const result = await generateAdminInsights(snapshot);
    return NextResponse.json({ success: true, generatedAt: new Date().toISOString(), dataThrough: snapshot.dataThrough, model: result.model, insights: result.insights }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof GeminiAdminInsightsConfigurationError) {
      return NextResponse.json({ success: false, code: 'GEMINI_NOT_CONFIGURED', error: 'Gemini is not configured. Deterministic insights are still available.' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } });
    }
    if (error instanceof GeminiAdminInsightsApiError) {
      return NextResponse.json({ success: false, error: 'Gemini could not generate insights right now. Deterministic insights are still available.' }, { status: 502, headers: { 'Cache-Control': 'private, no-store' } });
    }
    logCaughtRequestError(request, '/api/owner/ai-insights', error);
    return NextResponse.json({ success: false, error: 'Unable to generate AI insights.' }, { status: 500, headers: { 'Cache-Control': 'private, no-store' } });
  }
}

export const GET = withRequestLogging('/api/owner/ai-insights', handleGET);
export const POST = withRequestLogging('/api/owner/ai-insights', handlePOST);
