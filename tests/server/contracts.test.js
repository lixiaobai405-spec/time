const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const {
  CLASSIFICATION_SOURCE,
  ENERGY_POLICY,
  GOAL_KEYS,
  IMPORTANCE,
  SOURCES,
  TASK_STATUS,
  URGENCY,
  normalizeTask,
  quadrantFor,
} = require('../../server/contracts/time-management');

test('正式枚举与四步业务契约保持一致', () => {
  assert.deepEqual(GOAL_KEYS, ['昨天', '今天', '明天', '后天']);
  assert.deepEqual(IMPORTANCE, ['高', '中', '低']);
  assert.deepEqual(URGENCY, ['高', '中', '低']);
  assert.deepEqual(SOURCES, ['复盘', '今天', '短期目标', '中长期', '临时']);
  assert.deepEqual(TASK_STATUS, ['pending', 'done']);
  assert.deepEqual(CLASSIFICATION_SOURCE, [
    'ai-extraction',
    'manual',
    'unclassified',
    'ai-matrix',
  ]);
});

test('四象限固定精力比例合计 100', () => {
  assert.deepEqual(ENERGY_POLICY, {
    第一象限: 55,
    第二象限: 25,
    第三象限: 15,
    第四象限: 5,
  });
  assert.equal(Object.values(ENERGY_POLICY).reduce((sum, value) => sum + value, 0), 100);
});

test('只有高等级映射为重要或紧急', () => {
  assert.equal(quadrantFor({ importance: '高', urgency: '高' }), '第一象限');
  assert.equal(quadrantFor({ importance: '高', urgency: '中' }), '第二象限');
  assert.equal(quadrantFor({ importance: '中', urgency: '高' }), '第三象限');
  assert.equal(quadrantFor({ importance: '低', urgency: '低' }), '第四象限');
});

test('模型没有提供截止时间时标记待确认', () => {
  const task = normalizeTask({
    name: '整理季度复盘材料',
    importance: '高',
    urgency: '低',
    source: '复盘',
    est: '约2h',
  });

  assert.equal(task.due, '待确认');
  assert.equal(task.status, 'pending');
  assert.equal(task.classificationSource, 'ai-extraction');
  assert.match(task.id, /^[0-9a-f-]{36}$/i);
});

test('手动任务未标注时保留空等级等待矩阵 AI 判定', () => {
  const task = normalizeTask({
    name: '准备临时会议材料',
    source: '临时',
    due: '2026-07-20',
    est: '约1h',
    classificationSource: 'unclassified',
  });

  assert.equal(task.importance, null);
  assert.equal(task.urgency, null);
  assert.equal(task.classificationSource, 'unclassified');
});

test('运行提示词声明正式任务、矩阵和报告契约', () => {
  const prompt = readFileSync(
    path.join(__dirname, '..', '..', 'prompts', 'system.md'),
    'utf8',
  );

  assert.match(prompt, /"due":"原文中的期限或待确认"/);
  assert.match(prompt, /只提取尚未完成的动作/);
  assert.match(prompt, /"taskId":""/);
  assert.match(prompt, /55、25、15、5/);
  assert.match(prompt, /"energyRules":\["",""\]/);
  assert.match(prompt, /"order":\[\{"taskId":"","reason":""\}\]/);
});
