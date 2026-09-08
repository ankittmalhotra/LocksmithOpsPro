import Link from 'next/link';

export default function CustomerTrackPage() {
  /* Customer tracking is intentionally disabled for the current release. */
  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-3xl border border-slate-200 shadow-xl p-8 text-center">
        <div className="text-4xl mb-3">📍</div>
        <h1 className="text-xl font-black text-slate-900 mb-2">Tracking unavailable</h1>
        <p className="text-sm text-slate-600 mb-5">
          Customer tracking is not enabled yet. The dispatcher will contact you when needed.
        </p>
        <Link
          href="/"
          className="inline-block py-2.5 px-5 rounded-xl bg-slate-900 text-white text-sm font-bold"
        >
          Return to LockOps
        </Link>
      </div>
    </div>
  );
}
