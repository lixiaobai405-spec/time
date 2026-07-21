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

function requiredBoolean(environment, key) {
  const value = requiredText(environment, key).toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw configError(`Invalid boolean environment variable: ${key}`);
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

  const sessionSecret = requiredText(environment, 'SESSION_SECRET');
  if (Buffer.byteLength(sessionSecret, 'utf8') < 48) {
    throw configError('SESSION_SECRET must contain at least 48 bytes');
  }
  const sessionMaxAgeMs = positiveInteger(
    environment.SESSION_MAX_AGE_MS,
    'SESSION_MAX_AGE_MS',
    604_800_000,
  );
  if (sessionMaxAgeMs !== 604_800_000) {
    throw configError('SESSION_MAX_AGE_MS must be 604800000');
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
    databasePath: requiredText(environment, 'DATABASE_PATH'),
    sessionSecret,
    sessionCookieSecure: requiredBoolean(environment, 'SESSION_COOKIE_SECURE'),
    sessionMaxAgeMs,
  });
}

module.exports = { loadConfig };
