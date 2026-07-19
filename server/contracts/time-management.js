const { randomUUID } = require('node:crypto');

const GOAL_KEYS = Object.freeze(['昨天', '今天', '明天', '后天']);
const IMPORTANCE = Object.freeze(['高', '中', '低']);
const URGENCY = Object.freeze(['高', '中', '低']);
const SOURCES = Object.freeze(['复盘', '今天', '短期目标', '中长期', '临时']);
const TASK_STATUS = Object.freeze(['pending', 'done']);
const CLASSIFICATION_SOURCE = Object.freeze([
  'ai-extraction',
  'manual',
  'unclassified',
  'ai-matrix',
]);

const ENERGY_POLICY = Object.freeze({
  第一象限: 55,
  第二象限: 25,
  第三象限: 15,
  第四象限: 5,
});

const TASK_LIMIT = 100;
const TEXT_LIMITS = Object.freeze({
  goal: 4000,
  taskName: 200,
  due: 80,
  est: 40,
});

const MANUAL_FLAGS = Object.freeze({
  imp: Object.freeze({ importance: '高', urgency: '低', classificationSource: 'manual' }),
  urg: Object.freeze({ importance: '低', urgency: '高', classificationSource: 'manual' }),
  both: Object.freeze({ importance: '高', urgency: '高', classificationSource: 'manual' }),
  unclassified: Object.freeze({
    importance: null,
    urgency: null,
    classificationSource: 'unclassified',
  }),
});

function quadrantFor(task) {
  if (!IMPORTANCE.includes(task.importance) || !URGENCY.includes(task.urgency)) {
    throw Object.assign(new Error('task classification is incomplete'), {
      code: 'TASK_UNCLASSIFIED',
    });
  }

  const important = task.importance === '高';
  const urgent = task.urgency === '高';
  if (important && urgent) return '第一象限';
  if (important) return '第二象限';
  if (urgent) return '第三象限';
  return '第四象限';
}

function normalizedText(value, fallback = '') {
  const text = value == null ? '' : String(value).trim();
  return text || fallback;
}

function normalizeTask(task) {
  const hasClassification = IMPORTANCE.includes(task.importance)
    && URGENCY.includes(task.urgency);

  return {
    id: task.id || randomUUID(),
    name: normalizedText(task.name),
    importance: hasClassification ? task.importance : null,
    urgency: hasClassification ? task.urgency : null,
    source: task.source,
    due: normalizedText(task.due, '待确认'),
    est: normalizedText(task.est),
    status: task.status || 'pending',
    classificationSource: task.classificationSource
      || (hasClassification ? 'ai-extraction' : 'unclassified'),
  };
}

module.exports = {
  CLASSIFICATION_SOURCE,
  ENERGY_POLICY,
  GOAL_KEYS,
  IMPORTANCE,
  LEVELS: IMPORTANCE,
  MANUAL_FLAGS,
  SOURCES,
  TASK_LIMIT,
  TASK_STATUS,
  TEXT_LIMITS,
  URGENCY,
  normalizeTask,
  quadrantFor,
};
