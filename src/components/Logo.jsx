/**
 * Logo cloviela — hexagon (node) dengan busur "C" dan titik routing.
 * Dipakai di nav, sidebar dashboard, footer, dan favicon.
 */
export function LogoMark({ size = 28, radius = 8 }) {
  const id = 'clv-grad';
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true"
         style={{ display: 'block', flex: '0 0 auto' }}>
      <defs>
        <linearGradient id={id} x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#5ff7b8" />
          <stop offset="55%" stopColor="#3cf0a0" />
          <stop offset="100%" stopColor="#17a06a" />
        </linearGradient>
      </defs>

      {/* hexagon badan */}
      <path
        d="M16 2.2 28 9.1v13.8L16 29.8 4 22.9V9.1L16 2.2Z"
        fill="url(#clv-grad)"
      />
      {/* jalur routing di dalam */}
      <path
        d="M11 20.2V11.8c0-.9.7-1.6 1.6-1.6h6.2"
        stroke="#04140c" strokeWidth="2.3" strokeLinecap="round" fill="none" opacity=".92"
      />
      {/* node tujuan */}
      <circle cx="21.4" cy="10.2" r="2.5" fill="#04140c" />
      <circle cx="21.4" cy="10.2" r="1" fill="#3cf0a0" />
      {/* node asal */}
      <circle cx="11" cy="20.4" r="2" fill="#04140c" opacity=".92" />
    </svg>
  );
}

/** Logo lengkap: mark + wordmark. */
export function Logo({ size = 28, showText = true, fontSize = 16 }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
      <LogoMark size={size} />
      {showText && (
        <span style={{ fontWeight: 700, fontSize, letterSpacing: '-0.02em' }}>cloviela</span>
      )}
    </span>
  );
}

/** Favicon sebagai data URL — dipakai index.html dan bisa dipasang runtime. */
export const FAVICON_DATA_URL =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
      <defs><linearGradient id="g" x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#5ff7b8"/><stop offset="55%" stop-color="#3cf0a0"/><stop offset="100%" stop-color="#17a06a"/>
      </linearGradient></defs>
      <rect width="32" height="32" rx="8" fill="#070708"/>
      <path d="M16 4.6 26 10.4v11.2L16 27.4 6 21.6V10.4L16 4.6Z" fill="url(#g)"/>
      <path d="M11.8 20.4V12.6c0-.8.6-1.4 1.4-1.4h5.2" stroke="#04140c" stroke-width="2.2" stroke-linecap="round" fill="none"/>
      <circle cx="20.6" cy="11.2" r="2.2" fill="#04140c"/>
      <circle cx="20.6" cy="11.2" r=".9" fill="#3cf0a0"/>
      <circle cx="11.8" cy="20.4" r="1.8" fill="#04140c"/>
    </svg>`
  );
