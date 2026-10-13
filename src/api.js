/**
 * API client — semua request membawa Firebase ID token
 * (Authorization: Bearer <idToken>) yang diset oleh auth store.
 */
let tokenProvider = () => null;

export function setTokenProvider(fn) {
  tokenProvider = fn;
}

async function request(path, { method = 'GET', body } = {}) {
  const token = await tokenProvider();
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Request gagal (${res.status})`);
    err.code = data?.error?.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  config: () => request('/api/config'),
  health: () => request('/api/health'),
  models: () => request('/api/models'),
  me: () => request('/api/me'),
  syncUser: () => request('/api/auth/sync', { method: 'POST' }),

  channels: () => request('/api/channels'),
  checkout: (channel, phone) => request('/api/checkout', { method: 'POST', body: { channel, phone } }),
  payments: () => request('/api/payments'),
  payment: (ref) => request(`/api/payments/${encodeURIComponent(ref)}`),

  rotateKey: () => request('/api/keys/rotate', { method: 'POST' }),
  revokeKey: (id) => request('/api/keys/revoke', { method: 'POST', body: { id } }),

  usage: () => request('/api/usage'),
  logs: ({ limit = 50, offset = 0, status = '', model = '' } = {}) =>
    request(`/api/logs?limit=${limit}&offset=${offset}&status=${encodeURIComponent(status)}&model=${encodeURIComponent(model)}`),
  playground: (model, prompt, maxTokens) =>
    request('/api/playground', { method: 'POST', body: { model, prompt, max_tokens: maxTokens } }),

  admin: {
    stats: () => request('/api/admin/stats'),
    users: (q = '') => request(`/api/admin/users?q=${encodeURIComponent(q)}`),
    payments: () => request('/api/admin/payments'),
    extend: (id, days) => request(`/api/admin/users/${id}/extend`, { method: 'POST', body: { days } }),
    revoke: (id) => request(`/api/admin/users/${id}/revoke`, { method: 'POST' }),
    providers: () => request('/api/admin/providers'),
    addProvider: (body) => request('/api/admin/providers', { method: 'POST', body }),
    updateProvider: (id, body) => request(`/api/admin/providers/${id}`, { method: 'PATCH', body }),
    deleteProvider: (id) => request(`/api/admin/providers/${id}`, { method: 'DELETE' }),
    testProvider: (id) => request(`/api/admin/providers/${id}/test`),
    models: () => request('/api/admin/models'),
    addModel: (body) => request('/api/admin/models', { method: 'POST', body }),
    updateModel: (id, body) => request(`/api/admin/models/${id}`, { method: 'PATCH', body }),
    deleteModel: (id) => request(`/api/admin/models/${id}`, { method: 'DELETE' }),
    testModel: (id, prompt) => request(`/api/admin/models/${id}/test`, { method: 'POST', body: { prompt } }),
    testAllModels: () => request('/api/admin/models/test-all', { method: 'POST' }),
    suggestAlias: () => request('/api/admin/alias/suggest'),
    renameAlias: (id, alias) => request(`/api/admin/models/${id}`, { method: 'PATCH', body: { model_id: alias } }),
  },
};

export const rupiah = (n) =>
  'Rp' + Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 });

export const shortDate = (s) => {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(+d)) return '—';
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
};

export const relative = (s) => {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(+d)) return '—';
  const diff = Math.round((Date.now() - +d) / 1000);
  if (diff < 60) return 'baru saja';
  if (diff < 3600) return `${Math.round(diff / 60)} mnt lalu`;
  if (diff < 86400) return `${Math.round(diff / 3600)} jam lalu`;
  return `${Math.round(diff / 86400)} hari lalu`;
};
