const Ajv = require('ajv');

const {
  CLASSIFICATION_SOURCE,
  ENERGY_POLICY,
  GOAL_KEYS,
  IMPORTANCE,
  SOURCES,
  TASK_LIMIT,
  TASK_STATUS,
  TEXT_LIMITS,
  URGENCY,
  quadrantFor,
} = require('../contracts/time-management');

const HISTORY_SCHEMA_VERSION = 1;
const UUID_PATTERN = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
const ajv = new Ajv({ allErrors: true, strict: true });

const snapshotSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['clientRunId', 'title', 'goals', 'tasks', 'matrix', 'report'],
  properties: {
    clientRunId: { type: 'string', pattern: UUID_PATTERN },
    title: { type: 'string', minLength: 1, maxLength: 100 },
    goals: {
      type: 'object',
      additionalProperties: false,
      required: GOAL_KEYS,
      properties: Object.fromEntries(GOAL_KEYS.map((key) => [key, {
        type: 'string',
        maxLength: TEXT_LIMITS.goal,
      }])),
    },
    tasks: {
      type: 'array',
      maxItems: TASK_LIMIT,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'name',
          'importance',
          'urgency',
          'source',
          'due',
          'est',
          'acceptanceCriteria',
          'nextAction',
          'status',
          'classificationSource',
        ],
        properties: {
          id: { type: 'string', pattern: UUID_PATTERN },
          name: { type: 'string', minLength: 1, maxLength: TEXT_LIMITS.taskName },
          importance: { enum: IMPORTANCE },
          urgency: { enum: URGENCY },
          source: { enum: SOURCES },
          due: { type: 'string', minLength: 1, maxLength: TEXT_LIMITS.due },
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
      required: ['classifications', 'quadrants', 'note'],
      properties: {
        classifications: {
          type: 'array',
          maxItems: TASK_LIMIT,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['taskId', 'importance', 'urgency', 'classificationSource'],
            properties: {
              taskId: { type: 'string', pattern: UUID_PATTERN },
              importance: { enum: IMPORTANCE },
              urgency: { enum: URGENCY },
              classificationSource: { enum: CLASSIFICATION_SOURCE },
            },
          },
        },
        quadrants: {
          type: 'array',
          minItems: 4,
          maxItems: 4,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'priority', 'action', 'energyPercent', 'taskIds'],
            properties: {
              name: { enum: Object.keys(ENERGY_POLICY) },
              priority: { type: 'integer', minimum: 1, maximum: 4 },
              action: { enum: ['立即做', '计划做', '授权做', '减少做'] },
              energyPercent: { type: 'integer', minimum: 0, maximum: 100 },
              taskIds: {
                type: 'array',
                maxItems: TASK_LIMIT,
                items: { type: 'string', pattern: UUID_PATTERN },
              },
            },
          },
        },
        note: { type: 'string', maxLength: 4000 },
      },
    },
    report: {
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
              taskId: { type: 'string', pattern: UUID_PATTERN },
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
    },
  },
};

const validateShape = ajv.compile(snapshotSchema);
const QUADRANT_RULES = Object.freeze({
  第一象限: Object.freeze({ priority: 1, action: '立即做' }),
  第二象限: Object.freeze({ priority: 2, action: '计划做' }),
  第三象限: Object.freeze({ priority: 3, action: '授权做' }),
  第四象限: Object.freeze({ priority: 4, action: '减少做' }),
});

function inputError() {
  return Object.assign(new Error('历史快照格式不正确。'), {
    code: 'INPUT_INVALID',
    status: 400,
    expose: true,
  });
}

function dataError() {
  return Object.assign(new Error('历史数据暂时无法读取。'), {
    code: 'HISTORY_DATA_INVALID',
    status: 500,
    expose: false,
  });
}

function containsTaskIdLeak(text, tasks) {
  if (typeof text !== 'string') return false;
  const lowered = text.toLowerCase();
  return tasks.some((task) => (
    lowered.includes(task.id.toLowerCase())
    || lowered.includes(task.id.slice(0, 8).toLowerCase())
  ));
}

function assertSemantics(snapshot) {
  if (!snapshot.title.trim()) throw inputError();
  const tasksById = new Map();
  for (const task of snapshot.tasks) {
    if (!task.name.trim() || tasksById.has(task.id)) throw inputError();
    if (task.classificationSource === 'unclassified') throw inputError();
    tasksById.set(task.id, task);
  }

  if (snapshot.matrix.classifications.length !== snapshot.tasks.length) throw inputError();
  const classifications = new Map();
  for (const item of snapshot.matrix.classifications) {
    const task = tasksById.get(item.taskId);
    if (!task || classifications.has(item.taskId)) throw inputError();
    if (
      item.importance !== task.importance
      || item.urgency !== task.urgency
      || item.classificationSource !== task.classificationSource
    ) {
      throw inputError();
    }
    classifications.set(item.taskId, item);
  }

  const quadrantByName = new Map();
  const placedIds = [];
  for (const quadrant of snapshot.matrix.quadrants) {
    const rule = QUADRANT_RULES[quadrant.name];
    if (
      !rule
      || quadrantByName.has(quadrant.name)
      || quadrant.priority !== rule.priority
      || quadrant.action !== rule.action
      || quadrant.energyPercent !== ENERGY_POLICY[quadrant.name]
    ) {
      throw inputError();
    }
    quadrantByName.set(quadrant.name, quadrant);
    placedIds.push(...quadrant.taskIds);
  }
  if (
    quadrantByName.size !== 4
    || placedIds.length !== snapshot.tasks.length
    || new Set(placedIds).size !== placedIds.length
    || placedIds.some((id) => !tasksById.has(id))
  ) {
    throw inputError();
  }
  for (const task of snapshot.tasks) {
    if (!quadrantByName.get(quadrantFor(task)).taskIds.includes(task.id)) throw inputError();
  }

  const orderIds = snapshot.report.order.map((item) => item.taskId);
  if (
    new Set(orderIds).size !== orderIds.length
    || orderIds.some((id) => !tasksById.has(id))
  ) {
    throw inputError();
  }
  const visibleText = [
    ...snapshot.report.order.map((item) => item.reason),
    ...snapshot.report.energyRules,
    ...snapshot.report.adjustments,
  ];
  if (visibleText.some((text) => containsTaskIdLeak(text, snapshot.tasks))) throw inputError();
}

function validateHistorySnapshot(value) {
  if (!validateShape(value)) throw inputError();
  assertSemantics(value);
  return JSON.parse(JSON.stringify(value));
}

function decodeStoredSnapshot(record) {
  try {
    if (!record || record.schemaVersion !== HISTORY_SCHEMA_VERSION) throw dataError();
    return validateHistorySnapshot({
      clientRunId: record.clientRunId,
      title: record.title,
      goals: JSON.parse(record.goalsJson),
      tasks: JSON.parse(record.tasksJson),
      matrix: JSON.parse(record.matrixJson),
      report: JSON.parse(record.reportJson),
    });
  } catch {
    throw dataError();
  }
}

module.exports = {
  HISTORY_SCHEMA_VERSION,
  UUID_PATTERN,
  decodeStoredSnapshot,
  validateHistorySnapshot,
};
