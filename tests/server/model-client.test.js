const test = require('node:test');
const assert = require('node:assert/strict');

function responseWith(content, options = {}) {
  return {
    ok: options.ok !== false,
    status: options.status || 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  };
}

function clientOptions(fetchImpl, overrides = {}) {
  return {
    modelApiBaseUrl: 'http://model.test/v1',
    modelApiKey: 'fake-key',
    modelName: 'fake-model',
    modelTimeoutMs: 1000,
    fetchImpl,
    ...overrides,
  };
}

test('第一次非 JSON、第二次合法时总共请求两次', async () => {
  const { createModelClient } = require('../../server/model/model-client');
  const replies = ['not-json', '{"overall":"pass"}'];
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return responseWith(replies[calls.length - 1]);
  };
  const client = createModelClient(clientOptions(fetchImpl));

  const result = await client.completeJson({
    system: 'system-rules',
    user: '{"goals":{}}',
    temperature: 0.2,
    maxAttempts: 2,
  });

  assert.deepEqual(result, { overall: 'pass' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'http://model.test/v1/chat/completions');
  const body = JSON.parse(calls[0].options.body);
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'system-rules' },
    { role: 'user', content: '{"goals":{}}' },
  ]);
  assert.equal(calls[0].options.headers.authorization, 'Bearer fake-key');
});

test('第一次返回合法 JSON 时只请求一次', async () => {
  const { createModelClient } = require('../../server/model/model-client');
  let calls = 0;
  const client = createModelClient(clientOptions(async () => {
    calls += 1;
    return responseWith('{"tasks":[]}');
  }));

  assert.deepEqual(await client.completeJson({
    system: 'rules',
    user: '{}',
    temperature: 0.2,
    maxAttempts: 2,
  }), { tasks: [] });
  assert.equal(calls, 1);
});

test('连续两次非 JSON 后返回稳定错误且不包含模型原文', async () => {
  const { createModelClient } = require('../../server/model/model-client');
  let calls = 0;
  const client = createModelClient(clientOptions(async () => {
    calls += 1;
    return responseWith('sensitive-model-output');
  }));

  await assert.rejects(
    client.completeJson({ system: 'rules', user: '{}', maxAttempts: 2 }),
    error => error.code === 'MODEL_OUTPUT_INVALID'
      && !String(error.message).includes('sensitive-model-output'),
  );
  assert.equal(calls, 2);
});

test('超过 64KB 的模型正文按格式错误处理', async () => {
  const { createModelClient } = require('../../server/model/model-client');
  let calls = 0;
  const oversized = JSON.stringify({ text: 'x'.repeat(65 * 1024) });
  const client = createModelClient(clientOptions(async () => {
    calls += 1;
    return responseWith(oversized);
  }));

  await assert.rejects(
    client.completeJson({ system: 'rules', user: '{}', maxAttempts: 2 }),
    error => error.code === 'MODEL_OUTPUT_INVALID',
  );
  assert.equal(calls, 2);
});

test('不结束的请求在超时后返回 MODEL_TIMEOUT 且不自动重试', async () => {
  const { createModelClient } = require('../../server/model/model-client');
  let calls = 0;
  const client = createModelClient(clientOptions(() => {
    calls += 1;
    return new Promise(() => {});
  }, { modelTimeoutMs: 20 }));

  await assert.rejects(
    client.completeJson({ system: 'rules', user: '{}', maxAttempts: 2 }),
    error => error.code === 'MODEL_TIMEOUT',
  );
  assert.equal(calls, 1);
});

test('上游 HTTP 失败返回稳定错误且不重试', async () => {
  const { createModelClient } = require('../../server/model/model-client');
  let calls = 0;
  const client = createModelClient(clientOptions(async () => {
    calls += 1;
    return responseWith('', { ok: false, status: 503 });
  }));

  await assert.rejects(
    client.completeJson({ system: 'rules', user: '{}', maxAttempts: 2 }),
    error => error.code === 'MODEL_UPSTREAM_ERROR',
  );
  assert.equal(calls, 1);
});

test('提示词加载器只返回指定步骤的唯一代码块', () => {
  const { loadStepPrompt } = require('../../server/prompts/load-step-prompt');
  const expectations = {
    'check-goals': ['目标梳理审查模块', '任务拆解模块'],
    'extract-tasks': ['任务拆解模块', '目标梳理审查模块'],
    'classify-matrix': ['重要-紧急矩阵分类模块', '时间管理报告生成模块'],
    'generate-report': ['时间管理报告生成模块', '重要-紧急矩阵分类模块'],
  };

  for (const [stepName, [included, excluded]] of Object.entries(expectations)) {
    const prompt = loadStepPrompt(stepName);
    assert.match(prompt, new RegExp(included));
    assert.doesNotMatch(prompt, new RegExp(excluded));
    assert.doesNotMatch(prompt, /```/);
  }
  assert.throws(
    () => loadStepPrompt('unknown-step'),
    error => error.code === 'PROMPT_INVALID',
  );
});
