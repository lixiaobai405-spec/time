const test = require('node:test');
const assert = require('node:assert/strict');

const { checkGoals } = require('../../server/workflows/check-goals');

const KEYS = ['昨天', '今天', '明天', '后天'];

function goals(overrides = {}) {
  return {
    昨天: '',
    今天: '',
    明天: '',
    后天: '',
    ...overrides,
  };
}

function completeGoals(overrides = {}) {
  return goals({
    昨天: '原定完成复盘，实际完成，差距源于数据不足，下一步补齐数据',
    今天: '今天下班前提交方案',
    明天: '本周五前完成一份计划',
    后天: '年底前完成年度目标',
    ...overrides,
  });
}

function field(key, status, issue = '', suggestion = '') {
  return { key, status, issue, suggestion };
}

function passingOutput() {
  return {
    fields: KEYS.map(key => field(key, 'ok')),
    overall: 'pass',
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

test('四栏为空时返回四个 warn 且 overall 为 need_fix', async () => {
  const output = {
    fields: KEYS.map(key => field(
      key,
      'warn',
      '信息为空；以下为示范，请按实际修改',
      '请补充实际内容',
    )),
    overall: 'need_fix',
  };
  const modelClient = queuedModel([output]);

  assert.deepEqual(await checkGoals({ goals: goals(), modelClient }), output);
  assert.equal(modelClient.calls.length, 1);
  assert.equal(modelClient.calls[0].maxAttempts, 1);
  assert.match(modelClient.calls[0].system, /目标梳理审查模块/);
  assert.deepEqual(JSON.parse(modelClient.calls[0].user), { goals: goals() });
});

test('昨天只有结果时保留 PDCA 缩写缺项', async () => {
  const output = {
    fields: [
      field('昨天', 'warn', '缺少原定目标、差距原因和下一步改进', '请补齐复盘四环'),
      field('今天', 'ok'),
      field('明天', 'ok'),
      field('后天', 'ok'),
    ],
    overall: 'need_fix',
  };

  const result = await checkGoals({
    goals: completeGoals({ 昨天: '获客完成80%' }),
    modelClient: queuedModel([output]),
  });
  assert.match(result.fields[0].issue, /目标/);
  assert.match(result.fields[0].issue, /原因/);
  assert.match(result.fields[0].issue, /改进/);
});

test('明天目标笼统时保留 SMART 指标和时限缺项', async () => {
  const output = {
    fields: [
      field('昨天', 'ok'),
      field('今天', 'ok'),
      field('明天', 'warn', '缺少可衡量指标和明确时限', '请补充指标与截止时间'),
      field('后天', 'ok'),
    ],
    overall: 'need_fix',
  };

  const result = await checkGoals({
    goals: completeGoals({ 明天: '提升业绩' }),
    modelClient: queuedModel([output]),
  });
  assert.match(result.fields[2].issue, /指标/);
  assert.match(result.fields[2].issue, /时限/);
});

test('四栏完整时允许 overall 为 pass', async () => {
  const input = completeGoals();
  assert.deepEqual(await checkGoals({
    goals: input,
    modelClient: queuedModel([passingOutput()]),
  }), passingOutput());
});

test('任一目标超过 4000 字时在模型调用前拒绝', async () => {
  const modelClient = queuedModel([passingOutput()]);
  await assert.rejects(
    checkGoals({ goals: goals({ 今天: 'x'.repeat(4001) }), modelClient }),
    error => error.code === 'INPUT_INVALID' && error.status === 400,
  );
  assert.equal(modelClient.calls.length, 0);
});

test('空栏反馈没有示范提示时重试一次后拒绝', async () => {
  const invalid = {
    fields: KEYS.map(key => field(key, 'warn', '信息为空', '请补充')),
    overall: 'need_fix',
  };
  const modelClient = queuedModel([invalid, invalid]);

  await assert.rejects(
    checkGoals({ goals: goals(), modelClient }),
    error => error.code === 'MODEL_OUTPUT_INVALID' && error.status === 502,
  );
  assert.equal(modelClient.calls.length, 2);
});

test('Schema 或 overall 语义非法时在总计两次内恢复', async () => {
  const invalid = { ...passingOutput(), questions: ['请继续说明'] };
  const modelClient = queuedModel([invalid, passingOutput()]);
  assert.deepEqual(await checkGoals({
    goals: completeGoals(),
    modelClient,
  }), passingOutput());
  assert.equal(modelClient.calls.length, 2);

  const inconsistent = { ...passingOutput(), overall: 'need_fix' };
  await assert.rejects(
    checkGoals({
      goals: completeGoals(),
      modelClient: queuedModel([inconsistent, inconsistent]),
    }),
    error => error.code === 'MODEL_OUTPUT_INVALID',
  );
});

test('POST /api/time-management/goals/check 返回工作流结果', async () => {
  const { createApp } = require('../../server/app');
  const app = createApp({ modelClient: queuedModel([passingOutput()]) });
  const server = await listen(app);

  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/time-management/goals/check`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ goals: completeGoals() }),
      },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), passingOutput());
  } finally {
    await close(server);
  }
});
