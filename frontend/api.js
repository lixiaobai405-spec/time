const activeControllers = new Map();
let csrfToken = null;

function apiError(payload, status) {
  const detail = payload?.error || {};
  return Object.assign(
    new Error(detail.message || '请求失败，请重试。'),
    detail,
    { status },
  );
}

function controllersFor(channel) {
  if (!channel) return null;
  let controllers = activeControllers.get(channel);
  if (!controllers) {
    controllers = new Set();
    activeControllers.set(channel, controllers);
  }
  return controllers;
}

function removeController(channel, controller) {
  if (!channel) return;
  const controllers = activeControllers.get(channel);
  controllers?.delete(controller);
  if (controllers?.size === 0) activeControllers.delete(channel);
}

async function requestJson(path, {
  method = 'GET',
  body,
  channel,
  cancelPrevious = false,
} = {}) {
  if (cancelPrevious && channel) cancelRequestChannel(channel);
  const controller = new AbortController();
  controllersFor(channel)?.add(controller);

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
  } finally {
    removeController(channel, controller);
  }
}

export function getJson(path, options = {}) {
  return requestJson(path, options);
}

export function postJson(path, body, {
  channel = 'foreground',
  cancelPrevious = true,
} = {}) {
  return requestJson(path, {
    method: 'POST',
    body,
    channel,
    cancelPrevious,
  });
}

export function patchJson(path, body, {
  channel = 'history-write',
  cancelPrevious = false,
} = {}) {
  return requestJson(path, {
    method: 'PATCH',
    body,
    channel,
    cancelPrevious,
  });
}

export function putJson(path, body, options = {}) {
  return requestJson(path, { method: 'PUT', body, ...options });
}

export function deleteJson(path, {
  channel = 'foreground',
  cancelPrevious = true,
} = {}) {
  return requestJson(path, { method: 'DELETE', channel, cancelPrevious });
}

export function setCsrfToken(value) {
  csrfToken = typeof value === 'string' && value ? value : null;
}

export function cancelRequestChannel(channel) {
  const controllers = activeControllers.get(channel);
  if (!controllers) return;
  activeControllers.delete(channel);
  for (const controller of controllers) controller.abort();
}

export function cancelActiveRequest() {
  cancelRequestChannel('foreground');
}
