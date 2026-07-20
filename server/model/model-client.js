const { parseModelJson } = require('./parse-model-json');

function modelError(code, message) {
  return Object.assign(new Error(message), { code });
}

function normalizeMaxAttempts(value) {
  const attempts = value == null ? 2 : Number(value);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 2) {
    throw modelError('MODEL_CONFIG_INVALID', 'maxAttempts must be 1 or 2');
  }
  return attempts;
}

function createModelClient({
  modelApiBaseUrl,
  modelApiKey,
  modelName,
  modelTimeoutMs,
  fetchImpl = globalThis.fetch,
}) {
  if (typeof fetchImpl !== 'function') {
    throw modelError('MODEL_CONFIG_INVALID', 'fetch implementation is required');
  }

  const endpoint = `${String(modelApiBaseUrl).replace(/\/+$/, '')}/chat/completions`;

  async function requestOnce({ system, user, temperature }) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(modelError('MODEL_TIMEOUT', 'model request timed out'));
      }, modelTimeoutMs);
    });

    let response;
    try {
      response = await Promise.race([
        Promise.resolve(fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${modelApiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: modelName,
            temperature,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          }),
          signal: controller.signal,
        })),
        timeout,
      ]);
    } catch (error) {
      if (error && error.code === 'MODEL_TIMEOUT') throw error;
      throw modelError('MODEL_UPSTREAM_ERROR', 'model request failed');
    } finally {
      clearTimeout(timer);
    }

    if (!response || response.ok !== true) {
      throw modelError('MODEL_UPSTREAM_ERROR', 'model request failed');
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw modelError('MODEL_OUTPUT_INVALID', 'model output is invalid');
    }
    return parseModelJson(payload?.choices?.[0]?.message?.content);
  }

  async function completeJson({ system, user, temperature = 0.2, maxAttempts = 2 }) {
    const attempts = normalizeMaxAttempts(maxAttempts);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await requestOnce({ system, user, temperature });
      } catch (error) {
        if (error.code !== 'MODEL_OUTPUT_INVALID' || attempt === attempts) throw error;
      }
    }
    throw modelError('MODEL_OUTPUT_INVALID', 'model output is invalid');
  }

  return Object.freeze({ completeJson });
}

module.exports = { createModelClient };
