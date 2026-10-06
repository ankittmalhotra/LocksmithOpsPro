'use client';

import { useEffect } from 'react';

export default function RingCentralRefreshOnLoad() {
  useEffect(() => {
    void fetch('/api/ringcentral/call-analytics/refresh?range=today', {
      method: 'POST',
      cache: 'no-store',
    }).catch(() => {});
  }, []);

  return null;
}
