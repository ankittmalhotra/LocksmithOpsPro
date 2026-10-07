/** Simple latest-request guard for client fetches whose filters can change rapidly. */
export function createRequestSequenceGuard() {
  let sequence = 0;
  return {
    begin() { sequence += 1; return sequence; },
    invalidate() { sequence += 1; },
    isCurrent(requestSequence: number, signal?: AbortSignal) {
      return requestSequence === sequence && !signal?.aborted;
    },
  };
}
