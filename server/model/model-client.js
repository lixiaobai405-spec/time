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

function normalizeFinishReason(value) {
  if (value === 'length' || value === 'content_filter' || value === 'stop') {
    return value;
  }
  return 'other';
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

  function responseFormats(responseSchema, responseSchemaName) {
    if (!responseSchema) return [{ type: 'json_object' }];
    const strict = {
      type: 'json_schema',
      json_schema: {
        name: responseSchemaName || 'structured_response',
        strict: true,
        schema: responseSchema,
      },
    };
    // OpenAI-compatible providers vary in Structured Outputs support. Try the
    // strict contract first, then fall back only for schema-capability 4xx errors.
    return [strict, { type: 'json_object' }];
  }

  async function fetchOnce({ system, user, temperature, responseFormat }) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(modelError('MODEL_TIMEOUT', 'model request timed out'));
      }, modelTimeoutMs);
    });

    try {
      return await Promise.race([
        Promise.resolve(fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${modelApiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: modelName,
            temperature,
            response_format: responseFormat,
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
  }

  async function requestOnce({
    system,
    user,
    temperature,
    responseSchema,
    responseSchemaName,
  }) {
    const formats = responseFormats(responseSchema, responseSchemaName);
    let response;
    for (let index = 0; index < formats.length; index += 1) {
      response = await fetchOnce({
        system,
        user,
        temperature,
        responseFormat: formats[index],
      });
      if (response?.ok === true) break;
      const canFallback = index === 0
        && formats.length > 1
        && [400, 404, 422].includes(response?.status);
      if (!canFallback) throw modelError('MODEL_UPSTREAM_ERROR', 'model request failed');
    }

    if (!response || response.ok !== true) {
      throw modelError('MODEL_UPSTREAM_ERROR', 'model request failed');
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      const error = Object.assign(new Error('model output is invalid'), {
        code: 'MODEL_OUTPUT_INVALID',
        diagnosticCode: 'MODEL_RESPONSE_ENVELOPE_INVALID',
      });
      throw error;
    }
    const choice = payload?.choices?.[0];
    return parseModelJson(choice?.message?.content, {
      finishReason: normalizeFinishReason(choice?.finish_reason),
    });
  }

  async function completeJson({
    system,
    user,
    temperature = 0.2,
    maxAttempts = 2,
    responseSchema,
    responseSchemaName,
  }) {
    const attempts = normalizeMaxAttempts(maxAttempts);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await requestOnce({
          system,
          user,
          temperature,
          responseSchema,
          responseSchemaName,
        });
      } catch (error) {
        if (error.code !== 'MODEL_OUTPUT_INVALID' || attempt === attempts) throw error;
      }
    }
    throw modelError('MODEL_OUTPUT_INVALID', 'model output is invalid');
  }

  return Object.freeze({ completeJson });
}

module.exports = { createModelClient };
