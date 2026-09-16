'use client';

import { useEffect, useRef } from 'react';
import type { SmsDraft } from '@/lib/sms-draft';

interface SmsComposerModalProps {
  draft: SmsDraft | null;
  warnings?: string[];
  title?: string;
  autoOpen?: boolean;
  onClose: () => void;
}

/**
 * Device SMS hand-off. Opening the native Messages app remains a user-controlled
 * hand-off; a browser cannot send or verify an SMS on the user's behalf.
 */
export default function SmsComposerModal({
  draft,
  warnings = [],
  title = 'SMS ready to send',
  autoOpen = false,
  onClose,
}: SmsComposerModalProps) {
  const autoOpenedHref = useRef<string | null>(null);

  useEffect(() => {
    if (!autoOpen || !draft || autoOpenedHref.current === draft.href) return;
    autoOpenedHref.current = draft.href;
    const timer = window.setTimeout(() => {
      window.location.href = draft.href;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [autoOpen, draft]);

  if (!draft && warnings.length === 0) return null;

  if (!draft) {
    return (
      <div className="fixed inset-x-4 bottom-4 z-[60] sm:left-auto sm:max-w-md" role="alert">
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-xl text-xs text-amber-900">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-black mb-1">SMS draft unavailable</div>
              <ul className="list-disc pl-4 space-y-0.5">
                {warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            </div>
            <button type="button" onClick={onClose} className="text-amber-700 hover:text-amber-950 text-lg" aria-label="Dismiss SMS warning">×</button>
          </div>
        </div>
      </div>
    );
  }

  const allWarnings = [...draft.warnings, ...warnings].filter(
    (warning, index, items) => items.indexOf(warning) === index
  );

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(draft.body);
    } catch {
      // Clipboard permissions can be unavailable in some browsers. The body
      // remains selectable in the read-only field as a manual fallback.
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sms-composer-title"
        className="bg-white rounded-2xl max-w-lg w-full p-5 shadow-2xl border border-slate-200"
      >
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <h2 id="sms-composer-title" className="text-base font-black text-slate-900">{title}</h2>
            <p className="text-xs text-slate-600 mt-1">
              Prepared on this device. Review the message, then tap Send in Messages.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-900 text-xl" aria-label="Close SMS window">×</button>
        </div>

        <div className="text-xs font-semibold text-slate-700 mb-1">To: {draft.to}</div>
        <textarea
          aria-label="SMS message"
          readOnly
          value={draft.body}
          rows={10}
          className="w-full resize-y rounded-xl border border-slate-300 bg-slate-50 p-3 text-xs leading-relaxed text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {allWarnings.length > 0 && (
          <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            <div className="font-bold mb-1">Review before sending</div>
            <ul className="list-disc pl-4 space-y-0.5">
              {allWarnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <a
            href={draft.href}
            className="py-2.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-black text-center transition"
          >
            Open Messages
          </a>
          <button
            type="button"
            onClick={copyMessage}
            className="py-2.5 px-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-black transition"
          >
            Copy Message
          </button>
        </div>
        <a href={draft.recipientHref} className="block mt-2 text-center text-[11px] font-semibold text-slate-500 underline hover:text-slate-800">
          If the message body is not prefilled, open recipient-only Messages and paste the copied text.
        </a>
      </div>
    </div>
  );
}
