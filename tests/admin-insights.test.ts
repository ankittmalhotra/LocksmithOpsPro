import assert from 'node:assert/strict';
import { parseGeminiAdminInsights } from '../src/lib/gemini-admin-insights.ts';

const allowedMetricIds = new Set(['coverage.days', 'demand.mon-09']);

const parsed = parseGeminiAdminInsights({
  insights: [{
    id: 'ignored-model-id',
    title: 'Repeated demand is visible',
    finding: 'The same time window appears across covered weeks.',
    recommendation: 'Consider a small reversible staffing trial during this period.',
    metricIds: ['demand.mon-09', 'invented.metric'],
    confidence: 'medium',
  }],
}, allowedMetricIds);
assert.equal(parsed.length, 1);
assert.deepEqual(parsed[0].metricIds, ['demand.mon-09'], 'unknown evidence IDs are removed');
assert.equal(parsed[0].id, 'ai-1', 'model-provided identifiers are not trusted');

const unknownOnly = parseGeminiAdminInsights({
  insights: [{
    title: 'Unsupported observation',
    finding: 'This text has no valid evidence.',
    recommendation: 'Try changing the schedule.',
    metricIds: ['invented.metric'],
    confidence: 'high',
  }],
}, allowedMetricIds);
assert.deepEqual(unknownOnly, [], 'an insight with only unknown evidence is rejected');

const numericProse = parseGeminiAdminInsights({
  insights: [{
    title: 'Demand rose by 40%',
    finding: 'Calls increased by 40 percent.',
    recommendation: 'Schedule two technicians for this hour.',
    metricIds: ['coverage.days'],
    confidence: 'high',
  }],
}, allowedMetricIds);
assert.deepEqual(numericProse, [], 'numeric claims and invented values are rejected from prose');

console.log('admin-insights tests passed');
