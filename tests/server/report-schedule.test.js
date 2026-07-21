const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildReportScheduleContext,
  hasScheduleConflict,
  parseEstimatedRangeMinutes,
} = require('../../server/policies/report-schedule');

const SHANGHAI_NOON = () => new Date('2026-07-20T04:00:00.000Z');

function task(id, overrides = {}) {
  return {
    id,
    name: `任务 ${id}`,
    source: '今天',
    due: '2026-07-20 18:00',
    est: '约1h',
    ...overrides,
  };
}

function report(overrides = {}) {
  return {
    energyRules: ['先处理第一象限任务'],
    adjustments: ['每周复盘一次'],
    ...overrides,
  };
}

test('只解析明确的小时、分钟和小时区间', () => {
  assert.deepEqual(parseEstimatedRangeMinutes('约1h'), { min: 60, max: 60 });
  assert.deepEqual(parseEstimatedRangeMinutes('0.5-1h'), { min: 30, max: 60 });
  assert.deepEqual(parseEstimatedRangeMinutes('1–2小时'), { min: 60, max: 120 });
  assert.deepEqual(parseEstimatedRangeMinutes('30分钟'), { min: 30, max: 30 });
  assert.equal(parseEstimatedRangeMinutes('半天'), null);
  assert.equal(parseEstimatedRangeMinutes(''), null);
});

test('当天明确时间生成截止点和保守保护窗口且不改变输入', () => {
  const tasks = [
    task('review', { name: '审核方案', due: '今天17:00', est: '1-2h' }),
    task('meeting', { name: '召开风险会议', due: '2026-07-20 18:00', est: '30分钟' }),
    task('unknown', { name: '提交说明', due: '今日 19:00', est: '半天' }),
    task('future', { name: '准备明日材料', due: '明天 09:00', est: '1h' }),
  ];
  const snapshot = structuredClone(tasks);

  assert.deepEqual(buildReportScheduleContext({
    tasks,
    now: SHANGHAI_NOON,
    timeZone: 'Asia/Shanghai',
  }), {
    fixedPoints: [
      { taskId: 'review', taskName: '审核方案', time: '17:00', minute: 1020 },
      { taskId: 'meeting', taskName: '召开风险会议', time: '18:00', minute: 1080 },
      { taskId: 'unknown', taskName: '提交说明', time: '19:00', minute: 1140 },
    ],
    protectedWindows: [
      {
        taskId: 'review', taskName: '审核方案', startMinute: 900, endMinute: 1020,
        due: '17:00',
      },
      {
        taskId: 'meeting', taskName: '召开风险会议', startMinute: 1050, endMinute: 1080,
        due: '18:00',
      },
    ],
  });
  assert.deepEqual(tasks, snapshot);
});

test('明确建议时段撞上其他任务窗口或截止点时判定冲突', () => {
  const scheduleContext = buildReportScheduleContext({
    tasks: [
      task('review', { name: '审核方案', due: '今天17:00', est: '1h' }),
      task('meeting', { name: '召开风险会议', due: '今天18:00', est: '30分钟' }),
    ],
    now: SHANGHAI_NOON,
    timeZone: 'Asia/Shanghai',
  });

  assert.equal(hasScheduleConflict(report({
    energyRules: ['建议17:00-18:30集中推进实施方案'],
  }), scheduleContext), true);
  assert.equal(hasScheduleConflict(report({
    adjustments: ['建议16:30至17:30集中推进实施方案'],
  }), scheduleContext), true);
});

test('安排被保护任务本身、非重叠时段和截止说明不误判', () => {
  const scheduleContext = buildReportScheduleContext({
    tasks: [task('meeting', {
      name: '召开风险会议',
      due: '今天18:00',
      est: '30分钟',
    })],
    now: SHANGHAI_NOON,
    timeZone: 'Asia/Shanghai',
  });

  assert.equal(hasScheduleConflict(report({
    adjustments: ['17:30-18:00召开风险会议'],
  }), scheduleContext), false);
  assert.equal(hasScheduleConflict(report({
    adjustments: ['19:00—20:00集中推进实施方案'],
  }), scheduleContext), false);
  assert.equal(hasScheduleConflict(report({
    adjustments: ['召开风险会议需在18:00前完成'],
  }), scheduleContext), false);
});
