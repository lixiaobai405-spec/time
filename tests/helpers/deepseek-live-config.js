const fs = require('node:fs');
const path = require('node:path');

const { loadConfig } = require('../../server/config');

function configError(message) {
  return Object.assign(new Error(message), { code: 'DEEPSEEK_LIVE_CONFIG_INVALID' });
}

function findEnvironmentFile(root) {
  const explicit = process.env.DEEPSEEK_ENV_FILE;
  const candidates = explicit
    ? [path.resolve(root, explicit)]
    : [path.join(root, '.env.deepseek'), path.join(root, '.env')];
  const found = candidates.find(filename => fs.existsSync(filename));
  if (!found) {
    throw configError(
      'DeepSeek live config is missing. Copy .env.deepseek.example to .env.deepseek and set MODEL_API_KEY.',
    );
  }
  return found;
}

function loadDeepSeekLiveConfig() {
  if (typeof process.loadEnvFile !== 'function') {
    throw configError('DeepSeek live tests require Node.js 20.12 or newer.');
  }
  const root = path.join(__dirname, '..', '..');
  const environmentFile = findEnvironmentFile(root);
  process.loadEnvFile(environmentFile);
  const config = loadConfig(process.env);
  const endpoint = new URL(config.modelApiBaseUrl);
  if (endpoint.hostname !== 'api.deepseek.com') {
    throw configError('MODEL_API_BASE_URL must point to https://api.deepseek.com for this test.');
  }
  if (!config.modelName.startsWith('deepseek-')) {
    throw configError('MODEL_NAME must be a DeepSeek model for this test.');
  }
  if (config.modelResponseFormatMode !== 'json_object') {
    throw configError('MODEL_RESPONSE_FORMAT_MODE must be json_object for DeepSeek JSON Output.');
  }
  if (config.modelThinkingMode !== 'disabled') {
    throw configError('MODEL_THINKING_MODE must be disabled for bounded structured-output latency.');
  }
  if (/replace|fake|your[-_ ]?key/i.test(config.modelApiKey)) {
    throw configError('MODEL_API_KEY is still a placeholder.');
  }
  return Object.freeze({
    config,
    environmentFile: path.relative(root, environmentFile),
  });
}

module.exports = { loadDeepSeekLiveConfig };
