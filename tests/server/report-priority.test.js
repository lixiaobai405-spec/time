const test = require('node:test');
const assert = require('node:assert/strict');

const { buildReportPriorityContext } = require('../../server/policies/report-priority');

const NOW = () => new Date('2026-07-20T04:00:00.000Z');

function task(id, due) {
  return { id, name: `任务 ${id}`, due };
}

function matrix(groups = {}) {
  return {
    quadrants: [
      { name: '第一象限', taskIds: groups.q1 || [] },
      { name: '第二象限', taskIds: groups.q2 || [] },
      { name: '第三象限', taskIds: groups.q3 || [] },
      { name: '第四象限', taskIds: groups.q4 || [] },
    ],
  };
}

function context(tasks, groups) {
  return buildReportPriorityContext({
    tasks,
    matrix: matrix(groups),
    now: NOW,
    timeZone: 'Asia/Shanghai',
  });
}

test('第一象限按明确截止时间排序且 16:00 早于 17:00', () => {
  const tasks = [
    task('later', '2026-07-20 17:00'),
    task('earlier', '2026-07-20 16:00'),
    task('unknown', '待确认'),
  ];
  const result = context(tasks, { q1: ['later', 'unknown', 'earlier'] });
  assert.deepEqual(result.recommendedTaskIds, ['earlier', 'later', 'unknown']);
});

test('当天第三象限紧随第一象限并早于未来第二象限', () => {
  const tasks = [
    task('q2-future', '2026-07-21 09:00'),
    task('q3-today', '2026-07-20 18:00'),
    task('q1', '2026-07-20 17:00'),
  ];
  const result = context(tasks, {
    q1: ['q1'],
    q2: ['q2-future'],
    q3: ['q3-today'],
  });

  assert.deepEqual(result.recommendedTaskIds, ['q1', 'q3-today', 'q2-future']);
  assert.equal(result.actionByTaskId['q3-today'], '立即授权');
});

test('同象限未知期限靠后且同期限保持原任务输入顺序', () => {
  const tasks = [
    task('same-first', '2026-07-22 10:00'),
    task('unknown', '本周五'),
    task('same-second', '2026-07-22 10:00'),
  ];
  const result = context(tasks, { q2: ['same-second', 'unknown', 'same-first'] });
  assert.deepEqual(result.recommendedTaskIds, ['same-first', 'same-second', 'unknown']);
});

test('象限组按第一、当天第三、第二、其余第三、第四依次排列', () => {
  const tasks = [
    task('q4', '2026-07-20 08:00'),
    task('q3-future', '2026-07-21 08:00'),
    task('q2', '待确认'),
    task('q3-today', '2026-07-20 20:00'),
    task('q1', '待确认'),
  ];
  const result = context(tasks, {
    q1: ['q1'], q2: ['q2'], q3: ['q3-future', 'q3-today'], q4: ['q4'],
  });
  assert.deepEqual(result.recommendedTaskIds, [
    'q1', 'q3-today', 'q2', 'q3-future', 'q4',
  ]);
  assert.deepEqual(result.actionByTaskId, {
    q1: '立即处理',
    'q3-today': '立即授权',
    q2: '计划处理',
    'q3-future': '授权处理',
    q4: '减少处理',
  });
});

test('任务不足五条全部进入推荐顺序', () => {
  const tasks = [task('a', '待确认'), task('b', '待确认')];
  const result = context(tasks, { q4: ['a', 'b'] });
  assert.deepEqual(result.recommendedTaskIds, ['a', 'b']);
  assert.deepEqual(result.remainingProtectedTaskIds, []);
});

test('超过五条时保留全部到期任务并列出未进入前五的任务', () => {
  const tasks = Array.from({ length: 7 }, (_, index) => (
    task(`due-${index + 1}`, `2026-07-${String(14 + index).padStart(2, '0')} 09:00`)
  ));
  const ids = tasks.map(item => item.id);
  const result = context(tasks, { q1: ids });

  assert.deepEqual(result.recommendedTaskIds, ids.slice(0, 5));
  assert.deepEqual(result.protectedTaskIds, ids);
  assert.deepEqual(result.remainingProtectedTaskIds, ids.slice(5));
});
