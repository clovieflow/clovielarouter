import { navigate } from '../hooks';

export function GoogleButton({ config, onLogin, label = 'Lanjut dengan Google', block, busy, error }) {
  const click = async () => {
    try {
      const user = await onLogin();
      navigate(user?.admin ? '/admin' : '/dashboard');
    } catch {
      /* error ditampilkan dari hook */
    }
  };

  return (
    <>
      <button
        className={`btn ${block ? 'btn-block' : ''}`}
        onClick={click}
        disabled={busy}
        style={{ background: '#fff', color: '#111', borderColor: '#fff', fontWeight: 600 }}
      >
        {busy ? <span className="spinner" style={{ borderTopColor: '#111' }} /> : <GoogleMark />}
        {busy ? 'Menghubungkan…' : label}
      </button>
      {error && <p className="small text-red mt-8">{error}</p>}
    </>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.2 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.2-.4-4.7H24v9h12.4c-.5 2.9-2.1 5.3-4.5 7l7.2 5.6c4.2-3.9 6.6-9.6 6.6-16.9z" />
      <path fill="#FBBC05" d="M10.4 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6.1C1 16.4 0 20.1 0 24s1 7.6 2.6 10.8l7.8-6.1z" />
      <path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.6l-7.2-5.6c-2 1.4-4.6 2.2-8 2.2-6.3 0-11.7-3.7-13.6-9.1l-7.8 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

export function Avatar({ user, size = 32 }) {
  if (!user) return null;
  return user.photo ? (
    <img
      src={user.photo}
      alt=""
      width={size}
      height={size}
      style={{ borderRadius: '50%', display: 'block' }}
      referrerPolicy="no-referrer"
    />
  ) : (
    <div
      style={{
        width: size, height: size, borderRadius: '50%',
        background: 'var(--panel)', border: '1px solid var(--border)',
        display: 'grid', placeItems: 'center',
        fontSize: size * 0.42, fontWeight: 600, color: 'var(--green)',
      }}
    >
      {(user.name || user.email || '?')[0].toUpperCase()}
    </div>
  );
}
