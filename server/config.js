function configError(message) {
  return Object.assign(new Error(message), { code: 'CONFIG_INVALID' });
}

function requiredText(environment, key) {
  const value = environment[key] == null ? '' : String(environment[key]).trim();
  if (!value) throw configError(`Missing required environment variable: ${key}`);
  return value;
}

function positiveInteger(value, key, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const candidate = value == null || String(value).trim() === '' ? fallback : Number(value);
  if (!Number.isInteger(candidate) || candidate < 1 || candidate > maximum) {
    throw configError(`Invalid numeric environment variable: ${key}`);
  }
  return candidate;
}

function loadConfig(environment = {}) {
  const modelApiBaseUrl = requiredText(environment, 'MODEL_API_BASE_URL');
  let parsedUrl;
  try {
    parsedUrl = new URL(modelApiBaseUrl);
  } catch {
    throw configError('MODEL_API_BASE_URL must be an absolute HTTP(S) URL');
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw configError('MODEL_API_BASE_URL must be an absolute HTTP(S) URL');
  }

  return Object.freeze({
    port: positiveInteger(environment.PORT, 'PORT', 4174, 65535),
    modelApiBaseUrl: modelApiBaseUrl.replace(/\/+$/, ''),
    modelApiKey: requiredText(environment, 'MODEL_API_KEY'),
    modelName: requiredText(environment, 'MODEL_NAME'),
    modelTimeoutMs: positiveInteger(
      environment.MODEL_TIMEOUT_MS,
      'MODEL_TIMEOUT_MS',
      30_000,
    ),
  });
}

module.exports = { loadConfig };
