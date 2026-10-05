import type { AdminInsightsSnapshot } from '@/lib/admin-insights';

export type GeminiAdminInsight = {
  id: string;
  title: string;
  finding: string;
  recommendation: string;
  metricIds: string[];
  confidence: 'low' | 'medium' | 'high';
};

function getModel() {
  return process.env.GEMINI_ADMIN_INSIGHTS_MODEL || process.env.GEMINI_FLASH_MODEL || 'gemini-2.5-flash';
}

export class GeminiAdminInsightsConfigurationError extends Error {
  constructor() { super('Gemini Admin Insights is not configured.'); this.name = 'GeminiAdminInsightsConfigurationError'; }
}

export class GeminiAdminInsightsApiError extends Error {
  readonly status: number;
  constructor(status: number) { super('AI insights are temporarily unavailable.'); this.name = 'GeminiAdminInsightsApiError'; this.status = status; }
}

const responseSchema = {
  type: 'OBJECT',
  properties: {
    insights: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING' },
          title: { type: 'STRING' },
          finding: { type: 'STRING' },
          recommendation: { type: 'STRING' },
          metricIds: { type: 'ARRAY', items: { type: 'STRING' } },
          confidence: { type: 'STRING', enum: ['low', 'medium', 'high'] },
        },
        required: ['id', 'title', 'finding', 'recommendation', 'metricIds', 'confidence'],
      },
    },
  },
  required: ['insights'],
};

function responseText(payload: any) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  return Array.isArray(parts) ? parts.map((part: any) => typeof part?.text === 'string' ? part.text : '').join('').trim() : '';
}

function safeText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  // Numerical values must always be rendered from canonical server metrics.
  // Reject digits and phone-like patterns in model authored prose.
  if (!text || text.length > maxLength || /\d|\+?\d[\d\s().-]{5,}/.test(text)) return null;
  return text;
}

export function parseGeminiAdminInsights(payload: unknown, allowedMetricIds: Set<string>): GeminiAdminInsight[] {
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  if (!Array.isArray(root.insights)) throw new GeminiAdminInsightsApiError(502);
  const output: GeminiAdminInsight[] = [];
  for (const [index, item] of root.insights.entries()) {
    if (!item || typeof item !== 'object') continue;
    const value = item as Record<string, unknown>;
    const title = safeText(value.title, 120);
    const finding = safeText(value.finding, 360);
    const recommendation = safeText(value.recommendation, 360);
    const metricIds = Array.isArray(value.metricIds)
      ? Array.from(new Set(value.metricIds.filter((id): id is string => typeof id === 'string' && allowedMetricIds.has(id))))
      : [];
    if (!title || !finding || !recommendation || !metricIds.length) continue;
    const confidence = value.confidence === 'high' || value.confidence === 'medium' ? value.confidence : 'low';
    output.push({ id: `ai-${index + 1}`, title, finding, recommendation, metricIds, confidence });
    if (output.length === 4) break;
  }
  return output;
}

function vertexConfig() {
  return {
    project: process.env.VERTEX_AI_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT,
    location: process.env.VERTEX_AI_LOCATION || process.env.GOOGLE_CLOUD_LOCATION || 'us-central1',
  };
}

export async function generateAdminInsights(snapshot: AdminInsightsSnapshot): Promise<{ insights: GeminiAdminInsight[]; model: string }> {
  const model = getModel();
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_GENAI_API_KEY || process.env.GOOGLE_CLOUD_API_KEY;
  let endpoint: string;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (key) {
    endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    headers['x-goog-api-key'] = key;
  } else {
    const config = vertexConfig();
    const { GoogleAuth } = await import('google-auth-library');
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const project = config.project || await auth.getProjectId().catch(() => '');
    if (!project) throw new GeminiAdminInsightsConfigurationError();
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    if (!token.token) throw new GeminiAdminInsightsConfigurationError();
    endpoint = `https://${config.location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(config.location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
    headers.Authorization = `Bearer ${token.token}`;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [{ text: [
          'You are an operations analyst. Write at most three cautious observations from the supplied aggregate RingCentral call-demand metrics.',
          'Input is structured data only. Never claim that a call caused a job, never infer or claim Google Ads or campaign attribution, never describe the metrics as a conversion rate, and never make a seasonal claim.',
          'Do not include numeric values, dates, caller identity, names, addresses, job or call identifiers, or any invented facts in prose. Numeric values will be rendered separately from server metrics.',
          'Only cite metricIds that exist in the input. Recommend small reversible staffing or operating-hour experiments only when recurring demand and coverage support them. For sparse or incomplete coverage, say that evidence is insufficient.',
          'Return JSON only, following the requested schema.',
          JSON.stringify({
            timezone: snapshot.timezone,
            window: snapshot.window,
            coverage: snapshot.coverage,
            metrics: snapshot.metrics,
            recurringDemandCells: snapshot.recurringDemandCells,
          }),
        ].join('\n') }],
      }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema },
    }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new GeminiAdminInsightsApiError(response.status);
  }
  const rawText = responseText(await response.json());
  if (!rawText) throw new GeminiAdminInsightsApiError(502);
  try {
    const allowedMetricIds = new Set(snapshot.metrics.map((metric) => metric.id));
    const insights = parseGeminiAdminInsights(JSON.parse(rawText), allowedMetricIds);
    if (!insights.length) throw new GeminiAdminInsightsApiError(502);
    return { insights, model };
  } catch (error) {
    if (error instanceof GeminiAdminInsightsApiError) throw error;
    throw new GeminiAdminInsightsApiError(502);
  }
}
