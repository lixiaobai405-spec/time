const test = require('node:test');
const assert = require('node:assert/strict');

const { generateReport } = require('../../server/workflows/generate-report');

function task(id, overrides = {}) {
  return { id, name: `任务 ${id}`, source: '今天', ...overrides };
}

function matrixFor(tasks) {
  return { quadrants: [{ q: '第一象限', taskIds: tasks.map(item => item.id) }] };
}

function reportFor(tasks, overrides = {}) {
  return {
    order: tasks.slice(0, 5).map(item => ({
      taskId: item.id,
      reason: '该任务重要且紧急',
    })),
    energyRules: ['先完成第一象限任务', '为第二象限预留整块时间'],
    adjustments: ['每周固定一次复盘'],
    ...overrides,
  };
}

function queuedModel(outputs) {
  const calls = [];
  return {
    calls,
    completeJson: async input => {
      calls.push(input);
      return outputs[Math.min(calls.length - 1, outputs.length - 1)];
    },
  };
}

async function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()));
  });
}

test('报告只引用当前任务并保留三段结构', async () => {
  const tasks = [task('task-a', { name: '提交复盘', source: '复盘' })];
  const matrix = matrixFor(tasks);
  const expected = reportFor(tasks);
  const modelClient = queuedModel([expected]);
  const goals = { 昨天: '复盘不足', 后天: '' };

  const result = await generateReport({ tasks, matrix, goals, modelClient });
  assert.deepEqual(result, expected);
  assert.equal(modelClient.calls.length, 1);
  assert.equal(modelClient.calls[0].maxAttempts, 1);
  assert.match(modelClient.calls[0].system, /时间管理报告生成模块/);
  assert.deepEqual(JSON.parse(modelClient.calls[0].user), { tasks, matrix, goals });
});

test('任务不少于 3 条时 order 长度必须为 3–5', async () => {
  const tasks = Array.from({ length: 6 }, (_, index) => task(`task-${index}`));
  const invalid = reportFor(tasks, { order: reportFor(tasks).order.slice(0, 2) });
  const valid = reportFor(tasks);
  const modelClient = queuedModel([invalid, valid]);

  const result = await generateReport({
    tasks,
    matrix: matrixFor(tasks),
    goals: { 昨天: '', 后天: '' },
    modelClient,
  });
  assert.equal(result.order.length, 5);
  assert.equal(modelClient.calls.length, 2);
});

test('任务不足 3 条时 order 不得超过当前任务数', async () => {
  const tasks = [task('task-a')];
  const invalid = reportFor(tasks, {
    order: [
      { taskId: 'task-a', reason: '先做' },
      { taskId: 'task-b', reason: '再做' },
    ],
  });
  const modelClient = queuedModel([invalid, reportFor(tasks)]);

  const result = await generateReport({
    tasks,
    matrix: matrixFor(tasks),
    goals: { 昨天: '', 后天: '' },
    modelClient,
  });
  assert.equal(result.order.length, 1);
  assert.equal(modelClient.calls.length, 2);
});

test('不存在或已删除的 taskId 触发重试', async () => {
  const tasks = [task('current')];
  const invalid = reportFor(tasks, {
    order: [{ taskId: 'deleted', reason: '旧任务' }],
  });
  const modelClient = queuedModel([invalid, reportFor(tasks)]);

  const result = await generateReport({
    tasks,
    matrix: matrixFor(tasks),
    goals: { 昨天: '', 后天: '' },
    modelClient,
  });
  assert.equal(result.order[0].taskId, 'current');
  assert.equal(modelClient.calls.length, 2);
});

test('中长期目标的建议必须包含指标或时间节点', async () => {
  const tasks = [task('task-a')];
  const invalid = reportFor(tasks, { adjustments: ['继续努力推进长期目标'] });
  const valid = reportFor(tasks, { adjustments: ['12 月 31 日前完成 3 个里程碑'] });
  const modelClient = queuedModel([invalid, valid]);

  const result = await generateReport({
    tasks,
    matrix: matrixFor(tasks),
    goals: { 昨天: '', 后天: '完成年度能力提升计划' },
    modelClient,
  });
  assert.match(result.adjustments[0], /12|3/);
  assert.equal(modelClient.calls.length, 2);
});

test('单任务不能虚构第二个任务', async () => {
  const tasks = [task('only')];
  const invalid = reportFor(tasks, {
    order: [
      { taskId: 'only', reason: '当前任务' },
      { taskId: 'invented', reason: '虚构任务' },
    ],
  });
  const modelClient = queuedModel([invalid, invalid]);
  await assert.rejects(
    generateReport({
      tasks,
      matrix: matrixFor(tasks),
      goals: { 昨天: '', 后天: '' },
      modelClient,
    }),
    error => error.code === 'MODEL_OUTPUT_INVALID',
  );
  assert.equal(modelClient.calls.length, 2);
});

test('含原始 HTML 的字符串不在服务端转换', async () => {
  const tasks = [task('task-a')];
  const expected = reportFor(tasks, {
    energyRules: ['<img src=x onerror=alert(1)>', '**保留 Markdown**'],
  });
  const result = await generateReport({
    tasks,
    matrix: matrixFor(tasks),
    goals: { 昨天: '', 后天: '' },
    modelClient: queuedModel([expected]),
  });
  assert.equal(result.energyRules[0], '<img src=x onerror=alert(1)>');
});

test('POST /api/time-management/report/generate 返回结构化报告', async () => {
  const { createApp } = require('../../server/app');
  const tasks = [task('task-a')];
  const matrix = matrixFor(tasks);
  const expected = reportFor(tasks);
  const app = createApp({ modelClient: queuedModel([expected]) });
  const server = await listen(app);

  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/time-management/report/generate`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tasks, matrix, goals: { 昨天: '', 后天: '' } }),
      },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expected);
  } finally {
    await close(server);
  }
});
