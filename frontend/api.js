let activeController;
let csrfToken = null;

function apiError(payload, status) {
  const detail = payload?.error || {};
  return Object.assign(
    new Error(detail.message || '请求失败，请重试。'),
    detail,
    { status },
  );
}

async function requestJson(path, { method = 'GET', body, cancelPrevious = false } = {}) {
  if (cancelPrevious) activeController?.abort();
  const controller = new AbortController();
  if (cancelPrevious) activeController = controller;

  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (!['GET', 'HEAD'].includes(method) && csrfToken) headers['x-csrf-token'] = csrfToken;

  try {
    const response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal: controller.signal,
    });
    if (response.status === 204) return null;
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw apiError(payload, response.status);
    if (payload == null) throw apiError(null, response.status);
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw Object.assign(new Error('请求已取消。'), { code: 'REQUEST_CANCELLED' });
    }
    if (error instanceof TypeError) {
      throw Object.assign(new Error('网络连接异常，请检查网络后重试。'), {
        code: 'NETWORK_ERROR',
      });
    }
    throw error;
  }
}

export function getJson(path) {
  return requestJson(path);
}

export function postJson(path, body) {
  return requestJson(path, { method: 'POST', body, cancelPrevious: true });
}

export function putJson(path, body) {
  return requestJson(path, { method: 'PUT', body });
}

export function deleteJson(path) {
  return requestJson(path, { method: 'DELETE', cancelPrevious: true });
}

export function setCsrfToken(value) {
  csrfToken = typeof value === 'string' && value ? value : null;
}

export function cancelActiveRequest() {
  activeController?.abort();
}
