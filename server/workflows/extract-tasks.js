const Ajv = require('ajv');

const {
  GOAL_KEYS,
  IMPORTANCE,
  SOURCES,
  TASK_LIMIT,
  TEXT_LIMITS,
  URGENCY,
  normalizeTask,
  parseEstimatedMinutes,
} = require('../contracts/time-management');
const { applyDeadlineUrgency } = require('../policies/deadline');
const { loadStepPrompt } = require('../prompts/load-step-prompt');

const ajv = new Ajv({ allErrors: true, strict: true });
const goalProperties = Object.fromEntries(GOAL_KEYS.map(key => [key, {
  type: 'string',
  maxLength: TEXT_LIMITS.goal,
}]));

const validateRequest = ajv.compile({
  type: 'object',
  additionalProperties: false,
  required: ['goals'],
  properties: {
    goals: {
      type: 'object',
      additionalProperties: false,
      required: GOAL_KEYS,
      properties: goalProperties,
    },
  },
});

const validateResponse = ajv.compile({
  type: 'object',
  additionalProperties: false,
  required: ['tasks'],
  properties: {
    tasks: {
      type: 'array',
      maxItems: TASK_LIMIT,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'importance', 'urgency', 'source', 'est', 'status'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: TEXT_LIMITS.taskName },
          importance: { enum: IMPORTANCE },
          urgency: { enum: URGENCY },
          source: { enum: SOURCES },
          due: { type: 'string', maxLength: TEXT_LIMITS.due },
          est: { type: 'string', minLength: 1, maxLength: TEXT_LIMITS.est },
          acceptanceCriteria: {
            type: 'array',
            maxItems: 5,
            items: {
              type: 'string',
              minLength: 1,
              maxLength: TEXT_LIMITS.acceptanceCriteria,
            },
          },
          nextAction: { type: 'string', maxLength: TEXT_LIMITS.nextAction },
          status: { const: 'pending' },
        },
      },
    },
  },
});

const SOURCE_GOAL_KEY = Object.freeze({
  复盘: '昨天',
  今天: '今天',
  短期目标: '明天',
  中长期: '后天',
});

function publicError(code, message, status) {
  return Object.assign(new Error(message), { code, status, expose: true });
}

function outputError() {
  return publicError('MODEL_OUTPUT_INVALID', 'AI 返回格式异常，请重试。', 502);
}

function completedHistoryOnly(goals) {
  if (goals.今天.trim() || goals.明天.trim() || goals.后天.trim()) return false;
  const yesterday = goals.昨天.trim();
  return /已(?:经)?(?:完成|提交|结束|解决|关闭)/.test(yesterday)
    && !/(下一步|后续|待办|需要|计划|将要|改进|补充|继续)/.test(yesterday);
}

function assertTaskSemantics(output, goals) {
  if (completedHistoryOnly(goals) && output.tasks.length > 0) throw outputError();

  for (const task of output.tasks) {
    if (!task.name.trim() || !task.est.trim() || (task.due != null && !task.due.trim())) {
      throw outputError();
    }
    const sourceKey = SOURCE_GOAL_KEY[task.source];
    if (sourceKey && !goals[sourceKey].trim()) throw outputError();
    const acceptanceCriteria = task.acceptanceCriteria || [];
    if (acceptanceCriteria.some(item => !item.trim())
        || (['短期目标', '中长期'].includes(task.source)
          && acceptanceCriteria.length === 0)) {
      throw outputError();
    }
    const estimatedMinutes = parseEstimatedMinutes(task.est);
    if (estimatedMinutes !== null && estimatedMinutes > 8 * 60
        && (task.source !== '中长期' || !task.nextAction?.trim())) {
      throw outputError();
    }
  }
}

function normalizeModelError(error) {
  if (error.code === 'MODEL_OUTPUT_INVALID') return outputError();
  if (error.code === 'MODEL_TIMEOUT') {
    return publicError('MODEL_TIMEOUT', 'AI 响应超时，请重试。', 504);
  }
  if (error.code === 'MODEL_UPSTREAM_ERROR') {
    return publicError('MODEL_UPSTREAM_ERROR', 'AI 服务暂时不可用，请稍后重试。', 502);
  }
  return error;
}

async function extractTasks({ goals, modelClient, requestBody, now }) {
  const input = requestBody || { goals };
  if (!validateRequest(input)) {
    throw publicError('INPUT_INVALID', '输入内容不符合要求。', 400);
  }

  const validatedGoals = input.goals;
  const request = {
    system: loadStepPrompt('extract-tasks'),
    user: JSON.stringify({ goals: validatedGoals }),
    temperature: 0.2,
    maxAttempts: 1,
  };

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const output = await modelClient.completeJson(request);
      if (!validateResponse(output)) throw outputError();
      assertTaskSemantics(output, validatedGoals);
      const tasks = output.tasks.map(task => normalizeTask({
        ...task,
        classificationSource: 'ai-extraction',
      }));
      return {
        tasks: tasks.map(task => applyDeadlineUrgency(task, {
          now: now || Date.now,
          timeZone: 'Asia/Shanghai',
        })),
      };
    } catch (error) {
      const normalized = normalizeModelError(error);
      if (normalized.code === 'MODEL_OUTPUT_INVALID' && attempt < 2) continue;
      throw normalized;
    }
  }
  throw outputError();
}

module.exports = { extractTasks };
