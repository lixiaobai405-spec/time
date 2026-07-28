const test = require('node:test');
const assert = require('node:assert/strict');

const { AuthClient } = require('../helpers/auth-client');
const { createAuthTestApp } = require('../helpers/test-app');

async function authenticatedClient(t, modelClient) {
  const { baseUrl } = await createAuthTestApp(t, { modelClient });
  const client = new AuthClient(baseUrl);
  const username = `五步用户_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const password = '123456';
  assert.equal((await client.register(username, password)).status, 201);
  assert.equal((await client.login(username, password)).status, 200);
  assert.equal((await client.me()).status, 200);
  return client;
}

const entries = {
  昨天: '',
  今天: '完成时间管理新版接口联调',
  明天: '',
  后天: '',
};

function directTasks(taskOverridesArray) {
  return {
    tasks: taskOverridesArray.map((overrides) => ({
      name: '完成时间管理新版接口联调',
      importance: '高',
      urgency: '高',
      source: '今天',
      due: '待确认',
      est: '1h',
      owner: '待确认',
      acceptanceCriteria: [],
      nextAction: '',
      status: 'pending',
      ...overrides,
    })),
  };
}

test('新版五步接口要求登录和会话 CSRF', async (t) => {
  const { baseUrl } = await createAuthTestApp(t);
  const response = await fetch(`${baseUrl}/api/time-management/intake/check`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ entries }),
  });
  assert.equal(response.status, 401);
});

test('四栏校验、任务拆解、SMART 和时间分布通过正式 API 串联', async (t) => {
  let modelCalls = 0;
  const client = await authenticatedClient(t, {
    completeJson: async () => {
      modelCalls += 1;
      return directTasks([{}]);
    },
  });
  const request = (path, body) => client.request(path, {
    method: 'POST',
    csrfToken: client.sessionCsrfToken,
    body,
  });

  const intakeResponse = await request('/api/time-management/intake/check', { entries });
  assert.equal(intakeResponse.status, 200);
  const intake = await intakeResponse.json();
  assert.equal(intake.totalLines, 1);
  assert.deepEqual(intake.lineCounts, { 昨天: 0, 今天: 1, 明天: 0, 后天: 0 });

  const decomposeResponse = await request('/api/time-management/tasks/decompose', { entries });
  assert.equal(decomposeResponse.status, 200);
  const decomposed = await decomposeResponse.json();
  assert.equal(modelCalls, 1);
  assert.equal(decomposed.tasks.length, 1);
  assert.equal(decomposed.tasks[0].name, '完成时间管理新版接口联调');
  // 响应键为 intake、tasks、smart；不存在 warnings 和 analysisVersion
  assert.deepEqual(Object.keys(decomposed).sort(), ['intake', 'smart', 'tasks']);
  assert.equal('warnings' in decomposed, false);
  assert.equal('analysisVersion' in decomposed, false);
  assert.equal(decomposed.smart.overall, 'pass');

  const smartResponse = await request('/api/time-management/tasks/smart-check', {
    tasks: decomposed.tasks,
  });
  assert.equal(smartResponse.status, 200);
  assert.equal((await smartResponse.json()).overall, 'pass');

  const distributionResponse = await request('/api/time-management/distribution/diagnose', {
    tasks: decomposed.tasks,
  });
  assert.equal(distributionResponse.status, 200);
  const distribution = await distributionResponse.json();
  assert.equal(distribution.totalMinutes, 60);
  assert.deepEqual(distribution.percentages, { 昨天: 0, 今天: 100, 明天: 0, 后天: 0 });
});

test('零任务返回 422 NO_ACTIONABLE_TASKS', async (t) => {
  const client = await authenticatedClient(t, {
    completeJson: async () => directTasks([]),
  });
  const response = await client.request('/api/time-management/tasks/decompose', {
    method: 'POST',
    csrfToken: client.sessionCsrfToken,
    body: { entries },
  });

  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, 'NO_ACTIONABLE_TASKS');
});
