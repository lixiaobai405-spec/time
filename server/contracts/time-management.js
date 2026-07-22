const { randomUUID } = require('node:crypto');

const GOAL_KEYS = Object.freeze(['昨天', '今天', '明天', '后天']);
const CATEGORY_KEYS = GOAL_KEYS;
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

const CATEGORY_TO_SOURCE = Object.freeze({
  昨天: '复盘',
  今天: '今天',
  明天: '短期目标',
  后天: '中长期',
});

const SOURCE_TO_CATEGORY = Object.freeze({
  复盘: '昨天',
  今天: '今天',
  临时: '今天',
  短期目标: '明天',
  中长期: '后天',
});

const DISTRIBUTION_TARGETS = Object.freeze({
  昨天: Object.freeze({ min: 0, max: 2, label: '→0%' }),
  今天: Object.freeze({ min: 70, max: 80, label: '70–80%' }),
  明天: Object.freeze({ min: 10, max: 20, label: '10–20%' }),
  后天: Object.freeze({ min: 3, max: 100, label: '5%' }),
});

const TASK_LIMIT = 100;
const TEXT_LIMITS = Object.freeze({
  goal: 4000,
  taskName: 200,
  due: 80,
  est: 40,
  acceptanceCriteria: 200,
  nextAction: 200,
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

function parseEstimatedMinutes(est) {
  if (typeof est !== 'string') return null;
  const value = est.trim().replace(/\s+/g, '').replace(/^约/, '');
  const hours = value.match(/^(\d+(?:\.\d+)?)(?:h|小时)$/i);
  if (hours) return Number(hours[1]) * 60;
  const minutes = value.match(/^(\d+)分钟$/);
  return minutes ? Number(minutes[1]) : null;
}

function categoryForTask(task) {
  if (CATEGORY_KEYS.includes(task?.category)) return task.category;
  return SOURCE_TO_CATEGORY[task?.source] || '今天';
}

function sourceForCategory(category) {
  return CATEGORY_TO_SOURCE[category] || '今天';
}

function normalizeTask(task) {
  const hasClassification = IMPORTANCE.includes(task.importance)
    && URGENCY.includes(task.urgency);
  const acceptanceCriteria = Array.isArray(task.acceptanceCriteria)
    ? task.acceptanceCriteria.map(item => normalizedText(item)).filter(Boolean).slice(0, 5)
    : [];

  return {
    id: task.id || randomUUID(),
    name: normalizedText(task.name),
    importance: hasClassification ? task.importance : null,
    urgency: hasClassification ? task.urgency : null,
    source: task.source,
    due: normalizedText(task.due, '待确认'),
    est: normalizedText(task.est),
    acceptanceCriteria,
    nextAction: normalizedText(task.nextAction),
    status: task.status || 'pending',
    classificationSource: task.classificationSource
      || (hasClassification ? 'ai-extraction' : 'unclassified'),
  };
}

module.exports = {
  CATEGORY_KEYS,
  CATEGORY_TO_SOURCE,
  CLASSIFICATION_SOURCE,
  DISTRIBUTION_TARGETS,
  ENERGY_POLICY,
  GOAL_KEYS,
  IMPORTANCE,
  LEVELS: IMPORTANCE,
  MANUAL_FLAGS,
  SOURCES,
  TASK_LIMIT,
  TASK_STATUS,
  SOURCE_TO_CATEGORY,
  TEXT_LIMITS,
  URGENCY,
  categoryForTask,
  normalizeTask,
  parseEstimatedMinutes,
  quadrantFor,
  sourceForCategory,
};
