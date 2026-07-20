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
  assert.deepEqual(JSON.parse(modelClient.calls[0].user), {
    tasks,
    matrix,
    goals,
    priorityContext: {
      recommendedTaskIds: ['task-a'],
      protectedTaskIds: [],
      remainingProtectedTaskIds: [],
      actionByTaskId: { 'task-a': '立即处理' },
    },
  });
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

test('报告顺序与服务端候选顺序不一致时重试一次', async () => {
  const tasks = [
    task('later', { due: '2026-07-20 17:00' }),
    task('earlier', { due: '2026-07-20 16:00' }),
  ];
  const invalid = reportFor(tasks);
  const valid = reportFor(tasks, {
    order: [
      { taskId: 'earlier', reason: '16:00 截止，先完成' },
      { taskId: 'later', reason: '17:00 截止，随后完成' },
    ],
  });
  const modelClient = queuedModel([invalid, valid]);

  const result = await generateReport({
    tasks,
    matrix: matrixFor(tasks),
    goals: { 昨天: '', 后天: '' },
    modelClient,
    now: () => new Date('2026-07-20T04:00:00.000Z'),
  });

  assert.deepEqual(result.order.map(item => item.taskId), ['earlier', 'later']);
  assert.equal(modelClient.calls.length, 2);
});

test('当天到期任务被建议延后时拒绝并重试', async () => {
  const tasks = [task('due-today', {
    name: '发送项目会议纪要',
    due: '2026-07-20 18:00',
  })];
  const invalid = reportFor(tasks, {
    order: [{ taskId: 'due-today', reason: '建议延后发送项目会议纪要' }],
  });
  const valid = reportFor(tasks, {
    order: [{ taskId: 'due-today', reason: '18:00 前完成发送项目会议纪要' }],
  });
  const modelClient = queuedModel([invalid, valid]);

  const result = await generateReport({
    tasks,
    matrix: matrixFor(tasks),
    goals: { 昨天: '', 后天: '' },
    modelClient,
    now: () => new Date('2026-07-20T04:00:00.000Z'),
  });

  assert.match(result.order[0].reason, /18:00/);
  assert.equal(modelClient.calls.length, 2);
});

test('无明确期限的第四象限任务仍可建议推迟或取消', async () => {
  const tasks = [task('optional', { name: '整理旧标签', due: '待确认' })];
  const expected = reportFor(tasks, {
    order: [{ taskId: 'optional', reason: '可推迟或取消整理旧标签' }],
  });
  const result = await generateReport({
    tasks,
    matrix: { quadrants: [{ name: '第四象限', taskIds: ['optional'] }] },
    goals: { 昨天: '', 后天: '' },
    modelClient: queuedModel([expected]),
    now: () => new Date('2026-07-20T04:00:00.000Z'),
  });
  assert.equal(result.order[0].reason, '可推迟或取消整理旧标签');
});

test('报告入口接受任务验收标准并保持外部响应结构', async () => {
  const tasks = [task('smart', {
    source: '短期目标',
    acceptanceCriteria: ['形成 4 个模块', '完成 2 次模拟', '评分不低于 80 分'],
  })];
  const expected = reportFor(tasks);
  const result = await generateReport({
    tasks,
    matrix: matrixFor(tasks),
    goals: { 昨天: '', 后天: '' },
    modelClient: queuedModel([expected]),
  });
  assert.deepEqual(result, expected);
});

test('当天第三象限任务缺少授权语义时重试', async () => {
  const tasks = [task('delegate', {
    name: '发送项目会议纪要',
    due: '2026-07-20 18:00',
  })];
  const invalid = reportFor(tasks, {
    order: [{ taskId: 'delegate', reason: '今天尽快处理发送项目会议纪要' }],
  });
  const valid = reportFor(tasks, {
    order: [{ taskId: 'delegate', reason: '立即委派他人发送项目会议纪要' }],
  });
  const modelClient = queuedModel([invalid, valid]);
  const result = await generateReport({
    tasks,
    matrix: { quadrants: [{ name: '第三象限', taskIds: ['delegate'] }] },
    goals: { 昨天: '', 后天: '' },
    modelClient,
    now: () => new Date('2026-07-20T04:00:00.000Z'),
  });
  assert.match(result.order[0].reason, /委派/);
  assert.equal(modelClient.calls.length, 2);
});

test('超过五条当天任务时调整建议必须覆盖剩余任务', async () => {
  const tasks = Array.from({ length: 6 }, (_, index) => task(`due-${index + 1}`, {
    due: `2026-07-20 ${String(13 + index).padStart(2, '0')}:00`,
  }));
  const invalid = reportFor(tasks);
  const valid = reportFor(tasks, {
    adjustments: ['任务 due-6 安排在 18:30 完成'],
  });
  const modelClient = queuedModel([invalid, valid]);
  const result = await generateReport({
    tasks,
    matrix: matrixFor(tasks),
    goals: { 昨天: '', 后天: '' },
    modelClient,
    now: () => new Date('2026-07-20T04:00:00.000Z'),
  });
  assert.match(result.adjustments[0], /任务 due-6.*18:30/);
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
