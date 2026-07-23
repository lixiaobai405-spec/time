const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyDeadlineUrgency,
  normalizeDue,
  parseDue,
  parseExplicitDue,
  referenceDateInTimeZone,
} = require('../../server/policies/deadline');

const SHANGHAI_NOON = () => new Date('2026-07-20T04:00:00.000Z');

function task(overrides = {}) {
  return {
    id: 'task-a',
    name: '提交方案',
    source: '今天',
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

test('中文相对日期按 Asia/Shanghai 参考日解析', () => {
  const context = { now: SHANGHAI_NOON, timeZone: 'Asia/Shanghai' };
  assert.deepEqual(parseDue('今天18:00', context), {
    date: '2026-07-20',
    time: '18:00',
    sortKey: '2026-07-20T18:00',
  });
  assert.deepEqual(parseDue('今日', context), {
    date: '2026-07-20',
    time: null,
    sortKey: '2026-07-20T23:59',
  });
  assert.deepEqual(parseDue('明天 09:30', context), {
    date: '2026-07-21',
    time: '09:30',
    sortKey: '2026-07-21T09:30',
  });
  assert.deepEqual(parseDue('今天 11:30 前', context), {
    date: '2026-07-20',
    time: '11:30',
    sortKey: '2026-07-20T11:30',
  });
  assert.deepEqual(parseDue('后天 08:05', context), {
    date: '2026-07-22',
    time: '08:05',
    sortKey: '2026-07-22T08:05',
  });
});

test('可确定截止时间标准化为具体上海日期', () => {
  const context = { now: SHANGHAI_NOON, timeZone: 'Asia/Shanghai' };
  assert.equal(normalizeDue('今天', context), '2026-07-20');
  assert.equal(normalizeDue('今日 8:05 前', context), '2026-07-20 08:05');
  assert.equal(normalizeDue('明天 09:30', context), '2026-07-21 09:30');
  assert.equal(normalizeDue('后天', context), '2026-07-22');
  assert.equal(normalizeDue('2026-07-31T16:00', context), '2026-07-31 16:00');
});

test('相对日期标准化正确跨月和跨年', () => {
  assert.equal(normalizeDue('明天', {
    now: () => new Date('2026-07-31T04:00:00.000Z'),
    timeZone: 'Asia/Shanghai',
  }), '2026-08-01');
  assert.equal(normalizeDue('后天', {
    now: () => new Date('2026-12-30T04:00:00.000Z'),
    timeZone: 'Asia/Shanghai',
  }), '2027-01-01');
});

test('无法唯一确定或无效的截止时间统一为待确认', () => {
  const context = { now: SHANGHAI_NOON, timeZone: 'Asia/Shanghai' };
  for (const value of ['', '待确认', '尽快', '月底', '近期', '本周五', '2026-02-30']) {
    assert.equal(normalizeDue(value, context), '待确认', value);
  }
});

test('紧急度纠偏同时回写标准截止日期且不丢失原始紧迫信号', () => {
  const context = { now: SHANGHAI_NOON, timeZone: 'Asia/Shanghai' };
  assert.deepEqual(
    applyDeadlineUrgency(task({ due: '明天 09:00', urgency: '高' }), context),
    {
      ...task({ due: '明天 09:00', urgency: '高' }),
      due: '2026-07-21 09:00',
      urgency: '中',
    },
  );
  assert.equal(
    applyDeadlineUrgency(task({ due: '尽快', urgency: '低' }), context).urgency,
    '高',
  );
  assert.equal(
    applyDeadlineUrgency(task({ due: '尽快', urgency: '低' }), context).due,
    '待确认',
  );
});

test('期限、来源和明确压力按统一规则确定紧急度', () => {
  const context = { now: SHANGHAI_NOON, timeZone: 'Asia/Shanghai' };
  const cases = [
    { name: '当天', input: { source: '复盘', due: '2026-07-20', urgency: '低' }, expected: '高' },
    { name: '逾期', input: { source: '复盘', due: '2026-07-19', urgency: '低' }, expected: '高' },
    { name: '明天', input: { source: '短期目标', due: '2026-07-21', urgency: '低' }, expected: '中' },
    { name: '七天内', input: { source: '短期目标', due: '2026-07-27', urgency: '低' }, expected: '中' },
    { name: '超过七天', input: { source: '短期目标', due: '2026-07-28', urgency: '高' }, expected: '低' },
    { name: '复盘待确认', input: { source: '复盘', due: '待确认', urgency: '高' }, expected: '低' },
    { name: '中长期待确认', input: { source: '中长期', due: '待确认', urgency: '高' }, expected: '低' },
    { name: '今天栏待确认', input: { source: '今天', due: '待确认', urgency: '低' }, expected: '高' },
    { name: '不可解析自然期限', input: { source: '复盘', due: '本周五', urgency: '高' }, expected: '低' },
    { name: '未来但明确阻塞', input: { source: '短期目标', name: '立即处理发布阻塞', due: '2026-07-28', urgency: '低' }, expected: '高' },
  ];

  for (const item of cases) {
    assert.equal(
      applyDeadlineUrgency(task(item.input), context).urgency,
      item.expected,
      item.name,
    );
  }
});

test('任务或对应原始目标含明确紧迫信号时允许未来高紧急度', () => {
  const context = { now: SHANGHAI_NOON, timeZone: 'Asia/Shanghai' };
  assert.equal(applyDeadlineUrgency(task({
    name: '立即处理发布阻塞',
    due: '明天 09:00',
    urgency: '高',
  }), context).urgency, '高');
  assert.equal(applyDeadlineUrgency(task({
    name: '处理发布准备',
    due: '明天 09:00',
    urgency: '高',
  }), {
    ...context,
    goalText: '该事项影响当天交付，必须尽快完成',
  }).urgency, '高');
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
