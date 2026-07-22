const test = require('node:test');
const assert = require('node:assert/strict');

const { MANUAL_FLAGS } = require('../../server/contracts/time-management');
const { extractTasks } = require('../../server/workflows/extract-tasks');
const { createTestAuthBoundary } = require('../helpers/test-auth-boundary');

function goals(overrides = {}) {
  return { 昨天: '', 今天: '', 明天: '', 后天: '', ...overrides };
}

function modelTask(overrides = {}) {
  return {
    name: '提交方案',
    importance: '中',
    urgency: '高',
    source: '今天',
    due: '今天18:00',
    est: '约1h',
    status: 'pending',
    ...overrides,
  };
}

function queuedModel(outputs) {
  const calls = [];
  return {
    calls,
    completeJson: async input => {
      calls.push(input);
      const next = outputs[Math.min(calls.length - 1, outputs.length - 1)];
      if (next instanceof Error) throw next;
      return next;
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

test('并列事项拆为两条独立任务并生成不同 UUID', async () => {
  const modelClient = queuedModel([{ tasks: [
    modelTask({ name: '校对方案' }),
    modelTask({ name: '跟进投诉', importance: '高' }),
  ] }]);
  const input = goals({ 今天: '①校对方案；②跟进投诉' });

  const result = await extractTasks({ goals: input, modelClient });
  assert.deepEqual(result.tasks.map(task => task.name), ['校对方案', '跟进投诉']);
  assert.notEqual(result.tasks[0].id, result.tasks[1].id);
  assert.equal(result.tasks[0].classificationSource, 'ai-extraction');
  assert.equal(modelClient.calls[0].maxAttempts, 1);
  assert.match(modelClient.calls[0].system, /任务拆解模块/);
  assert.deepEqual(JSON.parse(modelClient.calls[0].user), { goals: input });
});

test('同名任务不按名称去重并保持不同 ID', async () => {
  const result = await extractTasks({
    goals: goals({ 今天: '分别向两个对象提交方案' }),
    modelClient: queuedModel([{ tasks: [modelTask(), modelTask()] }]),
  });
  assert.equal(result.tasks.length, 2);
  assert.notEqual(result.tasks[0].id, result.tasks[1].id);
});

test('明天为空时不得出现短期目标来源', async () => {
  const invalid = { tasks: [modelTask({ source: '短期目标' })] };
  const modelClient = queuedModel([invalid, invalid]);
  await assert.rejects(
    extractTasks({ goals: goals({ 今天: '提交方案' }), modelClient }),
    error => error.code === 'MODEL_OUTPUT_INVALID',
  );
  assert.equal(modelClient.calls.length, 2);
});

test('已完成复盘事实且无后续动作时不生成待办', async () => {
  const invalid = { tasks: [modelTask({ name: '完成季度复盘', source: '复盘' })] };
  const modelClient = queuedModel([invalid, invalid]);
  await assert.rejects(
    extractTasks({ goals: goals({ 昨天: '已完成季度复盘' }), modelClient }),
    error => error.code === 'MODEL_OUTPUT_INVALID',
  );
  assert.equal(modelClient.calls.length, 2);

  assert.deepEqual(await extractTasks({
    goals: goals({ 昨天: '已完成季度复盘' }),
    modelClient: queuedModel([{ tasks: [] }]),
  }), { tasks: [] });
});

test('模型缺少截止时间时标准化为待确认', async () => {
  const taskWithoutDue = modelTask();
  delete taskWithoutDue.due;
  const result = await extractTasks({
    goals: goals({ 今天: '提交方案' }),
    modelClient: queuedModel([{ tasks: [taskWithoutDue] }]),
  });
  assert.equal(result.tasks[0].due, '待确认');
  assert.equal(result.tasks[0].status, 'pending');
  assert.match(result.tasks[0].id, /^[0-9a-f-]{36}$/i);
});

test('任务提取后按期限、来源和压力统一纠偏紧急度', async () => {
  const result = await extractTasks({
    goals: goals({
      昨天: '复盘改进截止待确认；另有本周五完成的协调事项',
      今天: '今天处理当前行动',
      明天: '明天提交短期方案',
      后天: '未来推进长期机制建设',
    }),
    now: () => new Date('2026-07-20T04:00:00.000Z'),
    modelClient: queuedModel([{ tasks: [
      modelTask({ name: '处理当前行动', source: '今天', due: '待确认', urgency: '低' }),
      modelTask({ name: '落实复盘改进', source: '复盘', due: '待确认', urgency: '高' }),
      modelTask({ name: '完成协调事项', source: '复盘', due: '本周五', urgency: '高' }),
      modelTask({ name: '提交短期方案', source: '短期目标', due: '明天', urgency: '低', acceptanceCriteria: ['方案已提交'] }),
      modelTask({ name: '建设长期机制', source: '中长期', due: '2026-09-30', urgency: '高', acceptanceCriteria: ['机制已试运行'] }),
    ] }]),
  });

  assert.deepEqual(result.tasks.map(item => item.urgency), [
    '高',
    '低',
    '中',
    '中',
    '低',
  ]);
});

test('任务提取用对应原始目标纠正未来高紧急度', async () => {
  const now = () => new Date('2026-07-20T04:00:00.000Z');
  const ordinary = await extractTasks({
    goals: goals({ 明天: '明天 09:00 提交发布准备清单' }),
    now,
    modelClient: queuedModel([{ tasks: [modelTask({
      name: '提交发布准备清单',
      source: '短期目标',
      due: '明天 09:00',
      urgency: '高',
      acceptanceCriteria: ['清单已提交'],
    })] }]),
  });
  assert.equal(ordinary.tasks[0].urgency, '中');

  const blocked = await extractTasks({
    goals: goals({ 明天: '发布准备已阻塞，明天 09:00 前必须尽快提交清单' }),
    now,
    modelClient: queuedModel([{ tasks: [modelTask({
      name: '提交发布准备清单',
      source: '短期目标',
      due: '明天 09:00',
      urgency: '高',
      acceptanceCriteria: ['清单已提交'],
    })] }]),
  });
  assert.equal(blocked.tasks[0].urgency, '高');
});

test('SMART 任务保留模块、模拟次数和评分验收标准', async () => {
  const criteria = ['形成 4 个模块', '完成 2 次模拟', '评分不低于 80 分'];
  const result = await extractTasks({
    goals: goals({ 明天: '2026-07-31 前形成 4 个模块，完成 2 次模拟，评分不低于 80 分' }),
    modelClient: queuedModel([{ tasks: [modelTask({
      name: '完成管理课程训练材料',
      source: '短期目标',
      due: '2026-07-31',
      acceptanceCriteria: criteria,
    })] }]),
  });
  assert.deepEqual(result.tasks[0].acceptanceCriteria, criteria);
});

test('中短期任务缺少验收标准时重试一次', async () => {
  const invalid = { tasks: [modelTask({ source: '短期目标' })] };
  const valid = { tasks: [modelTask({
    source: '短期目标',
    acceptanceCriteria: ['交付 1 份可评审方案'],
  })] };
  const modelClient = queuedModel([invalid, valid]);
  const result = await extractTasks({
    goals: goals({ 明天: '本月底前交付 1 份可评审方案' }),
    modelClient,
  });
  assert.deepEqual(result.tasks[0].acceptanceCriteria, ['交付 1 份可评审方案']);
  assert.equal(modelClient.calls.length, 2);
});

test('今天来源的 12h 大任务被拒绝并要求模型拆分', async () => {
  const invalid = { tasks: [modelTask({ est: '12h' })] };
  const modelClient = queuedModel([invalid, invalid]);
  await assert.rejects(
    extractTasks({ goals: goals({ 今天: '今天完成预计 12h 的发布工作' }), modelClient }),
    error => error.code === 'MODEL_OUTPUT_INVALID',
  );
  assert.equal(modelClient.calls.length, 2);
});

test('中长期 16h 里程碑有下一步时接受且无下一步时重试', async () => {
  const invalid = { tasks: [modelTask({
    source: '中长期',
    est: '16h',
    acceptanceCriteria: ['完成第一阶段里程碑'],
  })] };
  const valid = { tasks: [modelTask({
    source: '中长期',
    est: '16h',
    acceptanceCriteria: ['完成第一阶段里程碑'],
    nextAction: '今天先列出里程碑所需的 4 个模块',
  })] };
  const modelClient = queuedModel([invalid, valid]);
  const result = await extractTasks({
    goals: goals({ 后天: '推进长期项目第一阶段里程碑' }),
    modelClient,
  });
  assert.equal(result.tasks[0].nextAction, '今天先列出里程碑所需的 4 个模块');
  assert.equal(modelClient.calls.length, 2);
});

test('不可解析耗时原样保留且不猜测任务粒度', async () => {
  const result = await extractTasks({
    goals: goals({ 今天: '今天梳理需求，预计半天' }),
    modelClient: queuedModel([{ tasks: [modelTask({ est: '半天' })] }]),
  });
  assert.equal(result.tasks[0].est, '半天');
  assert.equal(result.tasks[0].nextAction, '');
});

test('超过 100 条任务时重试一次后拒绝', async () => {
  const invalid = { tasks: Array.from({ length: 101 }, (_, index) => (
    modelTask({ name: `任务${index}` })
  )) };
  const modelClient = queuedModel([invalid, invalid]);
  await assert.rejects(
    extractTasks({ goals: goals({ 今天: '很多事项' }), modelClient }),
    error => error.code === 'MODEL_OUTPUT_INVALID',
  );
  assert.equal(modelClient.calls.length, 2);
});

test('非法枚举会触发一次重试并接受第二次合法输出', async () => {
  const modelClient = queuedModel([
    { tasks: [modelTask({ importance: '非常高' })] },
    { tasks: [modelTask()] },
  ]);
  const result = await extractTasks({ goals: goals({ 今天: '提交方案' }), modelClient });
  assert.equal(result.tasks[0].importance, '中');
  assert.equal(modelClient.calls.length, 2);
});

test('空任务名连续两次出现时最终失败', async () => {
  const invalid = { tasks: [modelTask({ name: '   ' })] };
  const modelClient = queuedModel([invalid, invalid]);
  await assert.rejects(
    extractTasks({ goals: goals({ 今天: '提交方案' }), modelClient }),
    error => error.code === 'MODEL_OUTPUT_INVALID',
  );
  assert.equal(modelClient.calls.length, 2);
});

test('手动任务四种标注映射保留未标注 null/null', () => {
  assert.deepEqual(MANUAL_FLAGS, {
    imp: { importance: '高', urgency: '低', classificationSource: 'manual' },
    urg: { importance: '低', urgency: '高', classificationSource: 'manual' },
    both: { importance: '高', urgency: '高', classificationSource: 'manual' },
    unclassified: {
      importance: null,
      urgency: null,
      classificationSource: 'unclassified',
    },
  });
});

test('POST /api/time-management/tasks/extract 返回标准任务', async () => {
  const { createApp } = require('../../server/app');
  const app = createApp({
    authBoundary: createTestAuthBoundary(),
    modelClient: queuedModel([{ tasks: [modelTask()] }]),
  });
  const server = await listen(app);

  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/time-management/tasks/extract`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ goals: goals({ 今天: '提交方案' }) }),
      },
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.tasks[0].name, '提交方案');
    assert.equal(payload.tasks[0].classificationSource, 'ai-extraction');
  } finally {
    await close(server);
  }
});

test('提取 API 使用注入的服务端时钟且拒绝客户端 referenceDate', async () => {
  const { createApp } = require('../../server/app');
  const modelClient = queuedModel([{ tasks: [modelTask({
    due: '2026-07-20 17:00',
    urgency: '中',
  })] }]);
  const app = createApp({
    authBoundary: createTestAuthBoundary(),
    modelClient,
    now: () => new Date('2026-07-20T04:00:00.000Z'),
  });
  const server = await listen(app);

  try {
    const endpoint = `http://127.0.0.1:${server.address().port}/api/time-management/tasks/extract`;
    const accepted = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goals: goals({ 今天: '提交方案' }) }),
    });
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).tasks[0].urgency, '高');

    const rejected = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        goals: goals({ 今天: '提交方案' }),
        referenceDate: '2099-01-01',
      }),
    });
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json()).error.code, 'INPUT_INVALID');
    assert.equal(modelClient.calls.length, 1);
  } finally {
    await close(server);
  }
});
