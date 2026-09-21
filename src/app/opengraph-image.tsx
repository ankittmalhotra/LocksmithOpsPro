import { ImageResponse } from 'next/og';

export const alt = 'LockOps Pro locksmith business management software';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          background: '#020617',
          color: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          justifyContent: 'space-between',
          padding: '72px',
          width: '100%',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
          <div
            style={{
              alignItems: 'center',
              background: '#fbbf24',
              borderRadius: '20px',
              color: '#020617',
              display: 'flex',
              fontSize: '42px',
              fontWeight: 900,
              height: '76px',
              justifyContent: 'center',
              width: '76px',
            }}
          >
            L
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '28px', fontWeight: 900 }}>LockOps Pro</span>
            <span style={{ color: '#94a3b8', fontSize: '16px', letterSpacing: '3px', textTransform: 'uppercase' }}>Locksmith operations</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', maxWidth: '950px' }}>
          <span style={{ color: '#fbbf24', fontSize: '22px', fontWeight: 800, letterSpacing: '3px', textTransform: 'uppercase' }}>Business management software for locksmiths</span>
          <span style={{ fontSize: '68px', fontWeight: 900, letterSpacing: '-3px', lineHeight: 1.02, marginTop: '22px' }}>Run every job from first call to final payment.</span>
        </div>
        <div style={{ color: '#cbd5e1', display: 'flex', fontSize: '22px' }}>Dispatch · Field workflows · Payments · Owner reporting</div>
      </div>
    ),
    { ...size },
  );
}
