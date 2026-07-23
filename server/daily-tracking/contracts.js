const Ajv = require('ajv');

const {
  CLASSIFICATION_SOURCE,
  IMPORTANCE,
  SOURCES,
  TASK_LIMIT,
  TASK_STATUS,
  TEXT_LIMITS,
  URGENCY,
} = require('../contracts/time-management');
const { UUID_PATTERN } = require('../history/contracts');

const DAILY_TRACKING_SCHEMA_VERSION = 1;
const LOCAL_DATE_TIME_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$';
const TRACKING_DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';
const ajv = new Ajv({ allErrors: true, strict: true });

const taskSchema = {
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
    importance: { enum: [...IMPORTANCE, null] },
    urgency: { enum: [...URGENCY, null] },
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
};

const writeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['trackingDate', 'tasks', 'tracking', 'removedTaskIds', 'revision'],
  properties: {
    trackingDate: { type: 'string', pattern: TRACKING_DATE_PATTERN },
    tasks: {
      type: 'array',
      maxItems: TASK_LIMIT,
      items: taskSchema,
    },
    tracking: {
      type: 'object',
      maxProperties: TASK_LIMIT,
      propertyNames: { pattern: UUID_PATTERN },
      additionalProperties: {
        type: 'object',
        additionalProperties: false,
        required: ['done', 'doneAt'],
        properties: {
          done: { type: 'boolean' },
          doneAt: {
            type: 'string',
            anyOf: [
              { maxLength: 0 },
              { pattern: LOCAL_DATE_TIME_PATTERN },
            ],
          },
        },
      },
    },
    removedTaskIds: {
      type: 'array',
      maxItems: TASK_LIMIT,
      items: { type: 'string', pattern: UUID_PATTERN },
    },
    revision: { type: 'integer', minimum: 0 },
  },
};

const validateShape = ajv.compile(writeSchema);

function inputError() {
  return Object.assign(new Error('每日跟踪数据格式不正确。'), {
    code: 'INPUT_INVALID',
    status: 400,
    expose: true,
  });
}

function storedDataError() {
  return Object.assign(new Error('每日跟踪数据暂时无法读取。'), {
    code: 'DAILY_TRACKING_DATA_INVALID',
    status: 500,
    expose: false,
  });
}

function assertSemantics(value) {
  const taskIds = value.tasks.map((task) => task.id);
  const visible = new Set(taskIds);
  const removed = new Set(value.removedTaskIds);
  if (
    visible.size !== taskIds.length
    || removed.size !== value.removedTaskIds.length
    || taskIds.some((id) => removed.has(id))
  ) {
    throw inputError();
  }
  for (const [taskId, status] of Object.entries(value.tracking)) {
    if (!visible.has(taskId)) throw inputError();
    if (status.done !== Boolean(status.doneAt)) throw inputError();
  }
}

function validateDailyWrite(value) {
  if (!validateShape(value)) throw inputError();
  assertSemantics(value);
  return JSON.parse(JSON.stringify(value));
}

function decodeStoredDaily(row) {
  try {
    if (!row || row.schema_version !== undefined) throw storedDataError();
    return {
      id: row.id,
      ...validateDailyWrite({
        trackingDate: row.tracking_date,
        tasks: JSON.parse(row.tasks_json),
        tracking: JSON.parse(row.tracking_json),
        removedTaskIds: JSON.parse(row.removed_task_ids_json),
        revision: row.revision,
      }),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch {
    throw storedDataError();
  }
}

module.exports = {
  DAILY_TRACKING_SCHEMA_VERSION,
  decodeStoredDaily,
  validateDailyWrite,
};
