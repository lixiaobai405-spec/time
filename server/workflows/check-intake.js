const Ajv = require('ajv');

const { CATEGORY_KEYS, TASK_LIMIT, TEXT_LIMITS } = require('../contracts/time-management');

const ajv = new Ajv({ allErrors: true, strict: true });
const entryProperties = Object.fromEntries(CATEGORY_KEYS.map(key => [key, {
  type: 'string',
  maxLength: TEXT_LIMITS.goal,
}]));

const validateRequest = ajv.compile({
  type: 'object',
  additionalProperties: false,
  required: ['entries'],
  properties: {
    entries: {
      type: 'object',
      additionalProperties: false,
      required: CATEGORY_KEYS,
      properties: entryProperties,
    },
  },
});

function publicError(code, message, status) {
  return Object.assign(new Error(message), { code, status, expose: true });
}

function splitEntries(value) {
  return String(value || '')
    .split(/\r?\n+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function checkIntake({ entries, requestBody } = {}) {
  const input = requestBody || { entries };
  if (!validateRequest(input)) {
    throw publicError('INPUT_INVALID', '四栏事务内容不符合要求。', 400);
  }

  const lineCounts = {};
  const warnings = [];
  let totalLines = 0;
  for (const key of CATEGORY_KEYS) {
    const count = splitEntries(input.entries[key]).length;
    lineCounts[key] = count;
    totalLines += count;
    if (count === 0) {
      warnings.push({ key, message: `${key}栏当前为空，可继续，但诊断可能缺少该类投入。` });
    }
  }

  if (totalLines === 0) {
    throw publicError('INPUT_EMPTY', '请至少填写一项事务。', 400);
  }
  if (totalLines > TASK_LIMIT) {
    throw publicError('TASK_LIMIT_EXCEEDED', `单次最多处理 ${TASK_LIMIT} 项事务。`, 400);
  }

  return {
    status: 'pass',
    entries: { ...input.entries },
    lineCounts,
    totalLines,
    warnings,
  };
}

module.exports = { checkIntake, splitEntries };
