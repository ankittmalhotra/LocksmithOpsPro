export type RingCentralAnalyticsView = {
  range: string;
  section: string;
  page: number;
  search: string;
  outcome: string;
  receivingNumber: string;
  from: string;
  to: string;
};

export function ringCentralAnalyticsViewKey(view: RingCentralAnalyticsView) {
  return JSON.stringify([
    view.range,
    view.section,
    view.page,
    view.search,
    view.outcome,
    view.receivingNumber,
    view.from,
    view.to,
  ]);
}

export function normalizeRingCentralAnalyticsPage(value: number, maximum = 10_000) {
  return Number.isFinite(value) && Number.isInteger(value) && value >= 1
    ? Math.min(value, maximum)
    : 1;
}

export function clampRingCentralAnalyticsPage(value: number, totalPages: number) {
  return Math.min(normalizeRingCentralAnalyticsPage(value), Math.max(1, totalPages));
}
