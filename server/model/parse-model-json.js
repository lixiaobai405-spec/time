const MAX_MODEL_OUTPUT_BYTES = 64 * 1024;

function invalidOutputError() {
  return Object.assign(new Error('model output is invalid'), {
    code: 'MODEL_OUTPUT_INVALID',
  });
}

function parseModelJson(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_MODEL_OUTPUT_BYTES) {
    throw invalidOutputError();
  }

  try {
    return JSON.parse(text);
  } catch {
    throw invalidOutputError();
  }
}

module.exports = { MAX_MODEL_OUTPUT_BYTES, parseModelJson };
