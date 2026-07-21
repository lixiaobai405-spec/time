const Ajv = require('ajv');

const {
  CLASSIFICATION_SOURCE,
  GOAL_KEYS,
  IMPORTANCE,
  SOURCES,
  TASK_LIMIT,
  TASK_STATUS,
  TEXT_LIMITS,
  URGENCY,
} = require('../contracts/time-management');
const { buildReportPriorityContext } = require('../policies/report-priority');
const {
  buildReportScheduleContext,
  hasScheduleConflict,
} = require('../policies/report-schedule');
const { loadStepPrompt } = require('../prompts/load-step-prompt');

const ajv = new Ajv({ allErrors: true, strict: true });
const nullableImportance = { anyOf: [{ enum: IMPORTANCE }, { type: 'null' }] };
const nullableUrgency = { anyOf: [{ enum: URGENCY }, { type: 'null' }] };
const goalProperties = Object.fromEntries(GOAL_KEYS.map(key => [key, {
  type: 'string',
  maxLength: TEXT_LIMITS.goal,
}]));

const validateRequest = ajv.compile({
  type: 'object',
  additionalProperties: false,
  required: ['tasks', 'matrix', 'goals'],
  properties: {
    tasks: {
      type: 'array',
      maxItems: TASK_LIMIT,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'source'],
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 200 },
          name: { type: 'string', minLength: 1, maxLength: TEXT_LIMITS.taskName },
          source: { enum: SOURCES },
          importance: nullableImportance,
          urgency: nullableUrgency,
          due: { type: 'string', maxLength: TEXT_LIMITS.due },
          est: { type: 'string', maxLength: TEXT_LIMITS.est },
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
          status: { enum: TASK_STATUS },
          classificationSource: { enum: CLASSIFICATION_SOURCE },
        },
      },
    },
    matrix: {
      type: 'object',
      additionalProperties: false,
      required: ['quadrants'],
      properties: {
        classifications: { type: 'array', maxItems: TASK_LIMIT },
        note: { type: 'string', maxLength: 4000 },
        quadrants: {
          type: 'array',
          maxItems: 4,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['taskIds'],
            properties: {
              q: { type: 'string', maxLength: 40 },
              name: { type: 'string', maxLength: 40 },
              priority: { type: 'integer', minimum: 1, maximum: 4 },
              action: { type: 'string', maxLength: 40 },
              energyPercent: { type: 'integer', minimum: 0, maximum: 100 },
              taskIds: {
                type: 'array',
                maxItems: TASK_LIMIT,
                items: { type: 'string', minLength: 1, maxLength: 200 },
              },
            },
          },
        },
      },
    },
    goals: {
      type: 'object',
      additionalProperties: false,
      required: ['昨天', '后天'],
      properties: goalProperties,
    },
  },
});

const validateResponse = ajv.compile({
  type: 'object',
  additionalProperties: false,
  required: ['order', 'energyRules', 'adjustments'],
  properties: {
    order: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['taskId', 'reason'],
        properties: {
          taskId: { type: 'string', minLength: 1, maxLength: 200 },
          reason: { type: 'string', minLength: 1, maxLength: 4000 },
        },
      },
    },
    energyRules: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      items: { type: 'string', minLength: 1, maxLength: 4000 },
    },
    adjustments: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      items: { type: 'string', minLength: 1, maxLength: 4000 },
    },
  },
});

function publicError(code, message, status) {
  return Object.assign(new Error(message), { code, status, expose: true });
}

function outputError() {
  return publicError('MODEL_OUTPUT_INVALID', 'AI 返回格式异常，请重试。', 502);
}

function inputError() {
  return publicError('INPUT_INVALID', '输入内容不符合要求。', 400);
}

function assertInputSemantics(tasks, matrix) {
  const taskIds = new Set();
  for (const task of tasks) {
    if (!task.id.trim() || !task.name.trim() || taskIds.has(task.id)) throw inputError();
    taskIds.add(task.id);
  }

  const matrixIds = matrix.quadrants.flatMap(item => item.taskIds);
  if (new Set(matrixIds).size !== matrixIds.length
      || matrixIds.some(taskId => !taskIds.has(taskId))) {
    throw inputError();
  }
}

function hasLongTermMeasure(adjustments) {
  const content = adjustments.join('\n');
  return /\d|(?:每[日周月季年])|截止|之前|前完成|指标|里程碑|节点|数量|比例/.test(content);
}

const PROHIBITED_DELAY = /推迟|延后|取消|暂缓|搁置/;
const DELEGATION_ACTION = /授权|委派|交办/;
const EXPLICIT_SCHEDULE = /(?:[01]?\d|2[0-3]):[0-5]\d|立即授权/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function containsTaskIdLeak(text, tasks) {
  if (typeof text !== 'string') return false;
  for (const task of tasks) {
    if (text.includes(task.id)) return true;
    if (UUID.test(task.id)
        && text.toLowerCase().includes(task.id.slice(0, 8).toLowerCase())) {
      return true;
    }
  }
  return false;
}

function visibleTextForTask(report, task) {
  const orderReason = report.order.find(item => item.taskId === task.id)?.reason;
  return [
    orderReason,
    ...report.energyRules.filter(text => text.includes(task.name)),
    ...report.adjustments.filter(text => text.includes(task.name)),
  ].filter(Boolean);
}

function assertProtectedGuidance(report, tasks, priorityContext) {
  const taskById = new Map(tasks.map(task => [task.id, task]));
  for (const taskId of priorityContext.protectedTaskIds) {
    const task = taskById.get(taskId);
    const related = visibleTextForTask(report, task);
    if (related.some(text => PROHIBITED_DELAY.test(text))) throw outputError();
    if (priorityContext.actionByTaskId[taskId] === '立即授权'
        && !related.some(text => DELEGATION_ACTION.test(text))) {
      throw outputError();
    }
  }

  for (const taskId of priorityContext.remainingProtectedTaskIds) {
    const task = taskById.get(taskId);
    const scheduled = report.adjustments.some(text => (
      text.includes(task.name) && EXPLICIT_SCHEDULE.test(text)
    ));
    if (!scheduled) throw outputError();
  }
}

function assertReportSemantics(report, tasks, goals, priorityContext) {
  const taskIds = new Set(tasks.map(task => task.id));
  const orderIds = report.order.map(item => item.taskId);
  if (new Set(orderIds).size !== orderIds.length
      || orderIds.some(taskId => !taskIds.has(taskId))) {
    throw outputError();
  }

  if (orderIds.length !== priorityContext.recommendedTaskIds.length
      || orderIds.some((taskId, index) => (
        taskId !== priorityContext.recommendedTaskIds[index]
      ))) {
    throw outputError();
  }

  const visibleText = [
    ...report.order.map(item => item.reason),
    ...report.energyRules,
    ...report.adjustments,
  ];
  if (visibleText.some(text => containsTaskIdLeak(text, tasks))) throw outputError();

  if (goals.后天.trim() && !hasLongTermMeasure(report.adjustments)) {
    throw outputError();
  }
  assertProtectedGuidance(report, tasks, priorityContext);
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

async function generateReport({ tasks, matrix, goals, modelClient, requestBody, now }) {
  const input = requestBody || { tasks, matrix, goals };
  if (!validateRequest(input)) throw inputError();
  assertInputSemantics(input.tasks, input.matrix);
  const priorityContext = buildReportPriorityContext({
    tasks: input.tasks,
    matrix: input.matrix,
    now: now || Date.now,
    timeZone: 'Asia/Shanghai',
  });
  const scheduleContext = buildReportScheduleContext({
    tasks: input.tasks,
    now: now || Date.now,
    timeZone: 'Asia/Shanghai',
  });

  const request = {
    system: loadStepPrompt('generate-report'),
    user: JSON.stringify({ ...input, priorityContext, scheduleContext }),
    temperature: 0.5,
    maxAttempts: 1,
  };

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const report = await modelClient.completeJson(request);
      if (!validateResponse(report)) throw outputError();
      assertReportSemantics(report, input.tasks, input.goals, priorityContext);
      if (hasScheduleConflict(report, scheduleContext)) throw outputError();
      return report;
    } catch (error) {
      const normalized = normalizeModelError(error);
      if (normalized.code === 'MODEL_OUTPUT_INVALID' && attempt < 2) continue;
      throw normalized;
    }
  }
  throw outputError();
}

module.exports = { containsTaskIdLeak, generateReport };
