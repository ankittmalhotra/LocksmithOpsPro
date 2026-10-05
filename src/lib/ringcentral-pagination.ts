const MAX_RINGCENTRAL_PAGES = 100;

/** Fail closed when a provider result still advertises pages after our safety cap. */
export function assertRingCentralPaginationComplete(
  nextPage: number,
  nextPageUri: string | null,
  totalPages: number | null,
  source: 'call log' | 'voicemail',
) {
  if (nextPageUri || (totalPages !== null && nextPage <= totalPages)) {
    throw new Error(`RingCentral ${source} response exceeded ${MAX_RINGCENTRAL_PAGES} pages; results are incomplete.`);
  }
}

export { MAX_RINGCENTRAL_PAGES };
