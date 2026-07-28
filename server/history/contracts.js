const Ajv = require('ajv');

const {
  CATEGORY_KEYS,
  CLASSIFICATION_SOURCE,
  DISTRIBUTION_TARGETS,
  ENERGY_POLICY,
  GOAL_KEYS,
  IMPORTANCE,
  SOURCES,
  TASK_LIMIT,
  TASK_STATUS,
  TEXT_LIMITS,
  URGENCY,
  normalizeDueForWrite,
  normalizeOptionalDue,
  normalizeOptionalOwner,
  quadrantFor,
} = require('../contracts/time-management');

const HISTORY_SCHEMA_VERSION = 2;
const UUID_PATTERN = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
const ajv = new Ajv({ allErrors: true, strict: true });

const distributionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['totalMinutes', 'totalHours', 'validTaskCount', 'invalidTasks', 'categories', 'percentages', 'diagnosis', 'recommendations'],
  properties: {
    totalMinutes: { type: 'number', minimum: 1 },
    totalHours: { type: 'number', minimum: 0 },
    validTaskCount: { type: 'integer', minimum: 0 },
    invalidTasks: {
      type: 'array',
      maxItems: TASK_LIMIT,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['taskId', 'name', 'est'],
        properties: {
          taskId: { type: 'string', pattern: UUID_PATTERN },
          name: { type: 'string', minLength: 1, maxLength: TEXT_LIMITS.taskName },
          est: { type: 'string', maxLength: TEXT_LIMITS.est },
        },
      },
    },
    categories: {
      type: 'array',
      minItems: 4,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'minutes', 'hours', 'percent', 'target', 'status'],
        properties: {
          key: { enum: CATEGORY_KEYS },
          minutes: { type: 'number', minimum: 0 },
          hours: { type: 'number', minimum: 0 },
          percent: { type: 'number', minimum: 0, maximum: 100 },
          target: {
            type: 'object',
            additionalProperties: false,
            required: ['min', 'max', 'label'],
            properties: {
              min: { type: 'number', minimum: 0, maximum: 100 },
              max: { type: 'number', minimum: 0, maximum: 100 },
              label: { type: 'string', minLength: 1, maxLength: 20 },
            },
          },
          status: { enum: ['ok', 'under', 'over'] },
        },
      },
    },
    percentages: {
      type: 'object',
      additionalProperties: false,
      required: CATEGORY_KEYS,
      properties: Object.fromEntries(CATEGORY_KEYS.map((key) => [key, { type: 'number', minimum: 0, maximum: 100 }])),
    },
    diagnosis: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: { type: 'string', minLength: 1, maxLength: 4000 },
    },
    recommendations: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: { type: 'string', minLength: 1, maxLength: 4000 },
    },
  },
};

const validateDistribution = ajv.compile(distributionSchema);

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
          'owner',
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
          owner: { type: 'string', minLength: 1, maxLength: TEXT_LIMITS.owner },
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
    distribution: distributionSchema,
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

const SUPPORTED_READ_VERSIONS = Object.freeze(new Set([1, 2]));
const PERCENT_TOLERANCE = 0.1;
const MINUTES_TOLERANCE = 1;

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

function containsModelArtifacts(texts) {
  const patterns = [
    /{/,
    /}/,
    /"model"/i,
    /"prompt"/i,
    /"content"/i,
    /"role"/i,
    /"messages"/i,
    /api[_-]?key/i,
    /sk-[a-zA-Z0-9]{20,}/,
    /"error"/i,
    /stacktrace/i,
    /"choices"/i,
    /"usage"/i,
  ];
  return texts.some((text) => {
    if (typeof text !== 'string') return false;
    return patterns.some((pattern) => pattern.test(text));
  });
}

function assertDistributionSemantics(distribution, tasks) {
  if (!validateDistribution(distribution)) throw inputError();

  const taskIds = new Set(tasks.map((task) => task.id));
  const invalidIds = new Set();
  for (const item of distribution.invalidTasks) {
    if (!taskIds.has(item.taskId)) throw inputError();
    if (invalidIds.has(item.taskId)) throw inputError();
    invalidIds.add(item.taskId);
  }

  if (distribution.validTaskCount + distribution.invalidTasks.length !== tasks.length) {
    throw inputError();
  }

  const categoryKeys = new Set();
  const categorySum = distribution.categories.reduce((sum, item) => {
    if (categoryKeys.has(item.key)) throw inputError();
    categoryKeys.add(item.key);
    return sum + item.minutes;
  }, 0);
  if (categoryKeys.size !== 4 || !CATEGORY_KEYS.every((key) => categoryKeys.has(key))) {
    throw inputError();
  }

  if (Math.abs(categorySum - distribution.totalMinutes) > MINUTES_TOLERANCE) {
    throw inputError();
  }

  const percentSum = Object.values(distribution.percentages).reduce((sum, value) => sum + value, 0);
  if (Math.abs(percentSum - 100) > PERCENT_TOLERANCE) throw inputError();

  for (const key of CATEGORY_KEYS) {
    if (typeof distribution.percentages[key] !== 'number') throw inputError();
  }

  for (const item of distribution.categories) {
    const expectedPercent = distribution.percentages[item.key];
    if (Math.abs(item.percent - expectedPercent) > PERCENT_TOLERANCE) throw inputError();
    if (item.target.min < 0 || item.target.max > 100 || item.target.min > item.target.max) throw inputError();
  }

  if (containsModelArtifacts(distribution.diagnosis)) throw inputError();
  if (containsModelArtifacts(distribution.recommendations)) throw inputError();
}

function assertSemantics(snapshot, schemaVersion = HISTORY_SCHEMA_VERSION) {
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

  if (schemaVersion === 2) {
    if (!snapshot.distribution) throw inputError();
    assertDistributionSemantics(snapshot.distribution, snapshot.tasks);
  }
}

function validateHistorySnapshot(value, { dueMode = 'read', schemaVersion = HISTORY_SCHEMA_VERSION } = {}) {
  if (!['read', 'write'].includes(dueMode)) throw inputError();
  if (!SUPPORTED_READ_VERSIONS.has(schemaVersion)) throw inputError();
  const normalized = Array.isArray(value?.tasks)
    ? {
      ...value,
      tasks: value.tasks.map((task) => {
        const withOwner = normalizeOptionalOwner(normalizeOptionalDue(task));
        return dueMode === 'write' ? normalizeDueForWrite(withOwner) : withOwner;
      }),
    }
    : value;
  if (!validateShape(normalized)) throw inputError();
  assertSemantics(normalized, schemaVersion);
  return JSON.parse(JSON.stringify(normalized));
}

function decodeStoredSnapshot(record) {
  try {
    if (!record || !SUPPORTED_READ_VERSIONS.has(record.schemaVersion)) throw dataError();
    const base = {
      clientRunId: record.clientRunId,
      title: record.title,
      goals: JSON.parse(record.goalsJson),
      tasks: JSON.parse(record.tasksJson),
      matrix: JSON.parse(record.matrixJson),
      report: JSON.parse(record.reportJson),
    };

    if (record.schemaVersion === 1) {
      const validated = validateHistorySnapshot(base, { schemaVersion: 1 });
      return { ...validated, distribution: null };
    }

    let distribution = null;
    if (typeof record.distributionJson === 'string') {
      distribution = JSON.parse(record.distributionJson);
    }
    if (!distribution) throw dataError();

    const validated = validateHistorySnapshot(
      { ...base, distribution },
      { schemaVersion: 2 },
    );
    return validated;
  } catch (error) {
    if (error?.code === 'INPUT_INVALID' || error?.code === 'HISTORY_DATA_INVALID') {
      throw error;
    }
    throw dataError();
  }
}

module.exports = {
  HISTORY_SCHEMA_VERSION,
  UUID_PATTERN,
  decodeStoredSnapshot,
  validateHistorySnapshot,
};
