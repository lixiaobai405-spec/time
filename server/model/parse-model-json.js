const MAX_MODEL_OUTPUT_BYTES = 64 * 1024;

function invalidOutputError(diagnosticCode) {
  return Object.assign(new Error('model output is invalid'), {
    code: 'MODEL_OUTPUT_INVALID',
    diagnosticCode,
  });
}

function classifyInvalidJson(text, finishReason) {
  if (finishReason === 'length') return 'MODEL_JSON_TRUNCATED';
  if (finishReason === 'content_filter') return 'MODEL_CONTENT_FILTERED';
  if (typeof text !== 'string') return 'MODEL_CONTENT_MISSING';

  const trimmed = text.trim();
  if (!trimmed) return 'MODEL_CONTENT_EMPTY';
  if (/^```(?:json)?\s/i.test(trimmed) && /\s```$/.test(trimmed)) {
    return 'MODEL_JSON_CODE_FENCE';
  }
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return 'MODEL_JSON_EXTRA_TEXT';
  }
  return 'MODEL_JSON_SYNTAX_INVALID';
}

function classifyJsonSyntaxError(error) {
  const message = error instanceof SyntaxError ? error.message : '';

  if (message.startsWith('Bad control character in string literal')) {
    return 'MODEL_JSON_CONTROL_CHARACTER_INVALID';
  }
  if (message.startsWith('Bad escaped character')
      || message.startsWith('Bad Unicode escape')) {
    return 'MODEL_JSON_ESCAPE_INVALID';
  }
  if (message.startsWith('Expected double-quoted property name')
      || message.startsWith("Expected property name or '}'")) {
    return 'MODEL_JSON_PROPERTY_NAME_INVALID';
  }
  if (message.startsWith("Expected ',' or '}' after property value")
      || message.startsWith("Expected ',' or ']' after array element")) {
    return 'MODEL_JSON_SEPARATOR_INVALID';
  }
  if (message.startsWith('Unexpected non-whitespace character after JSON')) {
    return 'MODEL_JSON_TRAILING_CONTENT';
  }
  if (message.startsWith('Unterminated string')) {
    return 'MODEL_JSON_UNTERMINATED_STRING';
  }
  return 'MODEL_JSON_SYNTAX_INVALID';
}

function parseModelJson(text, {
  finishReason,
  maxBytes = MAX_MODEL_OUTPUT_BYTES,
} = {}) {
  if (typeof text === 'string'
      && Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw invalidOutputError('MODEL_OUTPUT_TOO_LARGE');
  }

  if (typeof text !== 'string') {
    throw invalidOutputError(classifyInvalidJson(text, finishReason));
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    const coarseReason = classifyInvalidJson(text, finishReason);
    throw invalidOutputError(
      coarseReason === 'MODEL_JSON_SYNTAX_INVALID'
        ? classifyJsonSyntaxError(error)
        : coarseReason,
    );
  }
}

module.exports = { MAX_MODEL_OUTPUT_BYTES, parseModelJson };
