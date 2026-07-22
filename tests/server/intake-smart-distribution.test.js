const test = require('node:test');
const assert = require('node:assert/strict');

const { checkIntake } = require('../../server/workflows/check-intake');
const { checkTaskSmart } = require('../../server/workflows/check-task-smart');
const {
  allocateTenths,
  diagnoseDistribution,
} = require('../../server/workflows/diagnose-distribution');

function task(overrides = {}) {
  return {
    id: overrides.id || 'task-1',
    name: overrides.name || '完成方案终稿校对',
    source: overrides.source || '今天',
    due: overrides.due || '2026-07-22',
    est: overrides.est || '1h',
    importance: Object.hasOwn(overrides, 'importance') ? overrides.importance : '高',
    urgency: Object.hasOwn(overrides, 'urgency') ? overrides.urgency : '高',
    status: 'pending',
    classificationSource: overrides.classificationSource || 'ai-extraction',
    acceptanceCriteria: [],
    nextAction: '',
  };
}

test('四栏事务校验按行计数且允许部分栏位为空', () => {
  const result = checkIntake({
    entries: {
      昨天: '清理遗留事项\n补交周报',
      今天: '完成方案终稿',
      明天: '',
      后天: '',
    },
  });

  assert.equal(result.status, 'pass');
  assert.equal(result.totalLines, 3);
  assert.deepEqual(result.lineCounts, { 昨天: 2, 今天: 1, 明天: 0, 后天: 0 });
  assert.deepEqual(result.warnings.map(item => item.key), ['明天', '后天']);
});

test('四栏全部为空时拒绝进入拆解', () => {
  assert.throws(() => checkIntake({
    entries: { 昨天: '', 今天: '', 明天: '', 后天: '' },
  }), error => error.code === 'INPUT_EMPTY' && error.status === 400);
});

test('SMART 校验返回逐字段可修正问题', () => {
  const result = checkTaskSmart({ tasks: [task({
    name: '开会',
    due: '待确认',
    est: '半天',
    importance: null,
    urgency: null,
    classificationSource: 'unclassified',
  })] });

  assert.equal(result.overall, 'need_fix');
  assert.equal(result.summary.needFix, 1);
  assert.deepEqual(
    result.results[0].issues.map(item => item.field),
    ['name', 'due', 'est', 'priority'],
  );
});

test('SMART 完整任务通过校验', () => {
  const result = checkTaskSmart({ tasks: [task()] });
  assert.equal(result.overall, 'pass');
  assert.deepEqual(result.summary, { total: 1, pass: 1, needFix: 0 });
});

test('最大余数法把四类占比稳定舍入为 100.0%', () => {
  const result = allocateTenths({ 昨天: 1, 今天: 1, 明天: 1, 后天: 0 }, 3);
  assert.deepEqual(result, { 昨天: 33.4, 今天: 33.3, 明天: 33.3, 后天: 0 });
  assert.equal(
    Math.round(Object.values(result).reduce((sum, value) => sum + value, 0) * 10) / 10,
    100,
  );
});

test('时间分布按服务端工时计算并返回未参与任务', () => {
  const result = diagnoseDistribution({
    tasks: [
      task({ id: 'y', source: '复盘', est: '1h' }),
      task({ id: 't', source: '今天', est: '7h' }),
      task({ id: 'm', source: '短期目标', est: '1.5h' }),
      task({ id: 'f', source: '中长期', est: '30分钟' }),
      task({ id: 'bad', source: '临时', est: '半天' }),
    ],
  });

  assert.equal(result.totalMinutes, 600);
  assert.equal(result.totalHours, 10);
  assert.equal(result.validTaskCount, 4);
  assert.deepEqual(result.percentages, { 昨天: 10, 今天: 70, 明天: 15, 后天: 5 });
  assert.equal(result.invalidTasks[0].taskId, 'bad');
  assert.equal(result.categories.find(item => item.key === '今天').status, 'ok');
  assert.equal(result.categories.find(item => item.key === '昨天').status, 'over');
});
