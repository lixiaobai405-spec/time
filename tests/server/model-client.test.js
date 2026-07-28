const test = require('node:test');
const assert = require('node:assert/strict');

function responseWith(content, options = {}) {
  const choice = {
    message: { content },
    finish_reason: options.finishReason ?? 'stop',
  };
  return {
    ok: options.ok !== false,
    status: options.status || 200,
    json: async () => ({ choices: [choice] }),
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

test('上游 HTTP body 不是可解析 JSON 时返回 MODEL_RESPONSE_ENVELOPE_INVALID', async () => {
  const { createModelClient } = require('../../server/model/model-client');
  let calls = 0;
  const marker = 'SENSITIVE-ENVELOPE-CONTENT';
  const client = createModelClient(clientOptions(async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError(marker); },
    };
  }));

  await assert.rejects(
    client.completeJson({ system: 'rules', user: '{}', maxAttempts: 1 }),
    error => error.code === 'MODEL_OUTPUT_INVALID'
      && error.diagnosticCode === 'MODEL_RESPONSE_ENVELOPE_INVALID'
      && !String(error.message).includes(marker),
  );
  assert.equal(calls, 1);
});

test('choices[0].message.content 不是合法 JSON 时返回细分诊断码', async () => {
  const { createModelClient } = require('../../server/model/model-client');
  let calls = 0;
  const marker = 'SENSITIVE-CONTENT-MARKER';
  const client = createModelClient(clientOptions(async () => {
    calls += 1;
    return responseWith(`{${marker}}`);
  }));

  await assert.rejects(
    client.completeJson({ system: 'rules', user: '{}', maxAttempts: 1 }),
    error => error.code === 'MODEL_OUTPUT_INVALID'
      && error.diagnosticCode === 'MODEL_JSON_PROPERTY_NAME_INVALID'
      && !String(error.message).includes(marker),
  );
  assert.equal(calls, 1);
});

test('正文超过 64 KiB 时返回 MODEL_OUTPUT_TOO_LARGE', async () => {
  const { createModelClient } = require('../../server/model/model-client');
  let calls = 0;
  const oversized = JSON.stringify({ text: 'x'.repeat(65 * 1024) });
  const client = createModelClient(clientOptions(async () => {
    calls += 1;
    return responseWith(oversized);
  }));

  await assert.rejects(
    client.completeJson({ system: 'rules', user: '{}', maxAttempts: 1 }),
    error => error.code === 'MODEL_OUTPUT_INVALID'
      && error.diagnosticCode === 'MODEL_OUTPUT_TOO_LARGE',
  );
  assert.equal(calls, 1);
});

test('模型客户端错误消息和序列化不包含模型原文', async () => {
  const { createModelClient } = require('../../server/model/model-client');
  const marker = 'PRIVATE-MODEL-OUTPUT-12345';
  const client = createModelClient(clientOptions(async () => {
    return responseWith(marker);
  }));

  try {
    await client.completeJson({ system: 'rules', user: '{}', maxAttempts: 1 });
    assert.fail('should have thrown');
  } catch (error) {
    assert.equal(error.code, 'MODEL_OUTPUT_INVALID');
    assert.doesNotMatch(error.message, new RegExp(marker));
    assert.doesNotMatch(JSON.stringify(error), new RegExp(marker));
  }
});

test('非法模型正文按固定无敏感信息原因分类', async t => {
  const { createModelClient } = require('../../server/model/model-client');
  const cases = [
    {
      name: 'missing content',
      content: undefined,
      finishReason: 'stop',
      expected: 'MODEL_CONTENT_MISSING',
    },
    {
      name: 'empty content',
      content: ' \r\n\t ',
      finishReason: 'stop',
      expected: 'MODEL_CONTENT_EMPTY',
    },
    {
      name: 'length truncation',
      content: '{"order":[',
      finishReason: 'length',
      expected: 'MODEL_JSON_TRUNCATED',
    },
    {
      name: 'content filter',
      content: '',
      finishReason: 'content_filter',
      expected: 'MODEL_CONTENT_FILTERED',
    },
    {
      name: 'markdown fence',
      content: '```json\n{"order":[]}\n```',
      finishReason: 'stop',
      expected: 'MODEL_JSON_CODE_FENCE',
    },
    {
      name: 'extra text',
      content: '以下是结果：\n{"order":[]}',
      finishReason: 'stop',
      expected: 'MODEL_JSON_EXTRA_TEXT',
    },
    {
      name: 'json syntax',
      content: '{"order":[,]}',
      finishReason: 'stop',
      expected: 'MODEL_JSON_SYNTAX_INVALID',
    },
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      const client = createModelClient(clientOptions(async () => (
        responseWith(item.content, { finishReason: item.finishReason })
      )));
      await assert.rejects(
        client.completeJson({ system: 'rules', user: '{}', maxAttempts: 1 }),
        error => error.code === 'MODEL_OUTPUT_INVALID'
          && error.diagnosticCode === item.expected
          && !Object.hasOwn(error, 'content')
          && !Object.hasOwn(error, 'payload')
          && !Object.hasOwn(error, 'finishReason'),
      );
    });
  }
});

test('未知 finish_reason 不进入错误或序列化日志元数据', async () => {
  const { createModelClient } = require('../../server/model/model-client');
  const marker = 'PRIVATE-PROVIDER-FINISH-REASON';
  const client = createModelClient(clientOptions(async () => (
    responseWith('not-json', { finishReason: marker })
  )));

  try {
    await client.completeJson({ system: 'rules', user: '{}', maxAttempts: 1 });
    assert.fail('should have thrown');
  } catch (error) {
    assert.equal(error.diagnosticCode, 'MODEL_JSON_EXTRA_TEXT');
    assert.doesNotMatch(error.message, new RegExp(marker));
    assert.doesNotMatch(JSON.stringify(error), new RegExp(marker));
  }
});

test('Node 20 JSON.parse 语法错误映射为固定子类', async t => {
  const { createModelClient } = require('../../server/model/model-client');
  const rawNewline = `{"value":"line 1${String.fromCharCode(10)}line 2"}`;
  const cases = [
    {
      name: 'raw control character',
      content: rawNewline,
      expected: 'MODEL_JSON_CONTROL_CHARACTER_INVALID',
    },
    {
      name: 'bad escape',
      content: '{"value":"\\q"}',
      expected: 'MODEL_JSON_ESCAPE_INVALID',
    },
    {
      name: 'trailing comma',
      content: '{"value":1,}',
      expected: 'MODEL_JSON_PROPERTY_NAME_INVALID',
    },
    {
      name: 'unquoted property',
      content: '{value:1}',
      expected: 'MODEL_JSON_PROPERTY_NAME_INVALID',
    },
    {
      name: 'missing object comma',
      content: '{"a":1 "b":2}',
      expected: 'MODEL_JSON_SEPARATOR_INVALID',
    },
    {
      name: 'bad array separator',
      content: '{"items":[1 2]}',
      expected: 'MODEL_JSON_SEPARATOR_INVALID',
    },
    {
      name: 'multiple objects',
      content: '{"a":1}{"b":2}',
      expected: 'MODEL_JSON_TRAILING_CONTENT',
    },
    {
      name: 'unterminated string',
      content: '{"value":"text}',
      expected: 'MODEL_JSON_UNTERMINATED_STRING',
    },
    {
      name: 'fallback syntax',
      content: '{"value":NaN}',
      expected: 'MODEL_JSON_SYNTAX_INVALID',
    },
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      const client = createModelClient(clientOptions(async () => (
        responseWith(item.content, { finishReason: 'stop' })
      )));
      await assert.rejects(
        client.completeJson({ system: 'rules', user: '{}', maxAttempts: 1 }),
        error => error.code === 'MODEL_OUTPUT_INVALID'
          && error.diagnosticCode === item.expected
          && !Object.hasOwn(error, 'parseError')
          && !Object.hasOwn(error, 'position')
          && !Object.hasOwn(error, 'content'),
      );
    });
  }
});

test('JSON.parse 原始错误位置和正文 marker 不进入错误对象', async () => {
  const { createModelClient } = require('../../server/model/model-client');
  const marker = 'PRIVATE-JSON-SYNTAX-MARKER';
  const content = `{"value":"${marker}${String.fromCharCode(10)}next"}`;
  const client = createModelClient(clientOptions(async () => responseWith(content)));

  try {
    await client.completeJson({ system: 'rules', user: '{}', maxAttempts: 1 });
    assert.fail('should have thrown');
  } catch (error) {
    assert.equal(error.diagnosticCode, 'MODEL_JSON_CONTROL_CHARACTER_INVALID');
    assert.equal(error.message, 'model output is invalid');
    assert.doesNotMatch(JSON.stringify(error), new RegExp(marker));
    assert.doesNotMatch(JSON.stringify(error), /position|control character/i);
  }
});
