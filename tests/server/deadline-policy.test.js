const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyDeadlineUrgency,
  parseExplicitDue,
  referenceDateInTimeZone,
} = require('../../server/policies/deadline');

const SHANGHAI_NOON = () => new Date('2026-07-20T04:00:00.000Z');

function task(overrides = {}) {
  return {
    id: 'task-a',
    name: '提交方案',
    importance: '高',
    urgency: '中',
    classificationSource: 'ai-extraction',
    due: '2026-07-20 17:00',
    est: '约1h',
    ...overrides,
  };
}

test('明确的 ISO 日期和时间才会被解析', () => {
  assert.deepEqual(parseExplicitDue('2026-07-20'), {
    date: '2026-07-20',
    time: null,
    sortKey: '2026-07-20T23:59',
  });
  assert.deepEqual(parseExplicitDue('2026-07-20 16:30'), {
    date: '2026-07-20',
    time: '16:30',
    sortKey: '2026-07-20T16:30',
  });
  assert.deepEqual(parseExplicitDue('2026-07-20T08:05'), {
    date: '2026-07-20',
    time: '08:05',
    sortKey: '2026-07-20T08:05',
  });
  for (const value of [
    '',
    '待确认',
    '今天 16:00',
    '本周五',
    '2026/07/20',
    '2026-02-30',
    '2026-07-20 24:00',
  ]) {
    assert.equal(parseExplicitDue(value), null);
  }
});

test('Asia/Shanghai 参考日期由注入时钟计算并正确跨日', () => {
  assert.equal(
    referenceDateInTimeZone(() => new Date('2026-07-19T15:59:59.000Z'), 'Asia/Shanghai'),
    '2026-07-19',
  );
  assert.equal(
    referenceDateInTimeZone(() => new Date('2026-07-19T16:00:00.000Z'), 'Asia/Shanghai'),
    '2026-07-20',
  );
});

test('当天有时间、当天仅日期和已逾期任务统一为高紧急度', () => {
  const context = { now: SHANGHAI_NOON, timeZone: 'Asia/Shanghai' };
  for (const due of ['2026-07-20 17:00', '2026-07-20', '2026-07-19 23:59']) {
    assert.equal(applyDeadlineUrgency(task({ due }), context).urgency, '高');
  }
});

test('未来日期、待确认和不可解析期限保持原紧急度', () => {
  const context = { now: SHANGHAI_NOON, timeZone: 'Asia/Shanghai' };
  for (const due of ['2026-07-21', '待确认', '', '今天 18:00', '本周五']) {
    assert.equal(applyDeadlineUrgency(task({ due, urgency: '低' }), context).urgency, '低');
  }
});

test('日期纠偏返回新对象且不改变其他任务字段或原输入', () => {
  const input = task({ due: '2026-07-20 16:00', urgency: '中' });
  const snapshot = structuredClone(input);
  const result = applyDeadlineUrgency(input, {
    now: SHANGHAI_NOON,
    timeZone: 'Asia/Shanghai',
  });

  assert.notEqual(result, input);
  assert.deepEqual(input, snapshot);
  assert.deepEqual(result, { ...snapshot, urgency: '高' });
});
