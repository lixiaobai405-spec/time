let activeController;

function apiError(payload, status) {
  const detail = payload?.error || {};
  return Object.assign(
    new Error(detail.message || '请求失败，请重试。'),
    detail,
    { status },
  );
}

export async function postJson(path, body) {
  activeController?.abort();
  activeController = new AbortController();

  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: activeController.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw apiError(payload, response.status);
    if (payload == null) throw apiError(null, response.status);
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw Object.assign(new Error('请求已取消。'), { code: 'REQUEST_CANCELLED' });
    }
    throw error;
  }
}

export function cancelActiveRequest() {
  activeController?.abort();
}
