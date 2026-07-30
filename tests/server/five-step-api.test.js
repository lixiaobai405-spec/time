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

function claim(text, evidenceIds = []) {
  return { text, evidenceIds };
}

function coachOutput() {
  const supported = claim('当前需要完成时间管理新版接口联调。', ['E1']);
  const unknown = claim('证据不足：当前输入未提供该维度信息。');
  return {
    evidence: [{
      id: 'E1',
      dimension: '今天',
      sourceLineIndex: 0,
      quote: entries.今天,
      observation: '完成时间管理新版接口联调',
      kind: 'work',
      status: 'planned',
      owner: '待确认',
      due: '待确认',
    }],
    coachingAnalysis: {
      yesterday_analysis: {
        key_problem: unknown,
        gap: unknown,
        root_cause: unknown,
        management_insight: unknown,
      },
      today_focus: {
        key_work: supported,
        priority_reason: supported,
        manager_action: supported,
        possible_delegation: unknown,
      },
      tomorrow_optimization: {
        management_improvement: unknown,
        system_building: unknown,
        capability_upgrade: unknown,
      },
      future_direction: {
        long_term_goal: unknown,
        organization_capability: unknown,
        future_focus: unknown,
      },
      connection_analysis: {
        problem_to_action: unknown,
        action_to_optimization: unknown,
        optimization_to_future: unknown,
      },
      coaching_suggestions: [],
      overall_insight: supported,
    },
  };
}

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
      evidenceIds: ['E1'],
      ...overrides,
    })),
  };
}

function taskFirstOutput(taskOverridesArray, evidenceOverrides = {}) {
  return {
    evidence: [{ ...coachOutput().evidence[0], ...evidenceOverrides }],
    ...directTasks(taskOverridesArray),
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
    completeJson: async ({ responseSchemaName }) => {
      modelCalls += 1;
      assert.equal(responseSchemaName, 'time_evidence_task_generation_v2');
      return taskFirstOutput([{}]);
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
  assert.deepEqual(
    Object.keys(decomposed).sort(),
    ['decomposition', 'intake', 'smart', 'tasks'],
  );
  assert.equal(decomposed.decomposition.pipelineVersion, 'task-first-v2');
  assert.equal(decomposed.decomposition.stages.length, 1);
  assert.equal(decomposed.decomposition.taskEvidence[0].taskId, decomposed.tasks[0].id);
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

test('任务返回后可独立请求 coaching analysis', async (t) => {
  const client = await authenticatedClient(t, {
    completeJson: async ({ responseSchemaName }) => {
      if (responseSchemaName === 'time_evidence_task_generation_v2') {
        return taskFirstOutput([{}]);
      }
      assert.equal(responseSchemaName, 'time_coaching_analysis_v2');
      return { coachingAnalysis: coachOutput().coachingAnalysis };
    },
  });
  const decomposeResponse = await client.request(
    '/api/time-management/tasks/decompose',
    {
      method: 'POST',
      csrfToken: client.sessionCsrfToken,
      body: { entries },
    },
  );
  const decomposed = await decomposeResponse.json();
  const coachingResponse = await client.request(
    '/api/time-management/tasks/coaching-analysis',
    {
      method: 'POST',
      csrfToken: client.sessionCsrfToken,
      body: {
        decompositionId: decomposed.decomposition.decompositionId,
        attemptId: '22222222-2222-4222-8222-222222222222',
        businessDate: decomposed.decomposition.businessDate,
        entries,
        evidence: decomposed.decomposition.stages[0].output.evidence,
      },
    },
  );

  assert.equal(coachingResponse.status, 200);
  const coaching = await coachingResponse.json();
  assert.equal(coaching.decompositionId, decomposed.decomposition.decompositionId);
  assert.equal(coaching.stage.name, 'coaching-analysis');
  assert.equal(coaching.stage.analysisId, coaching.analysisId);
});

test('零任务返回 422 NO_ACTIONABLE_TASKS', async (t) => {
  const client = await authenticatedClient(t, {
    completeJson: async () => taskFirstOutput([], { status: 'completed' }),
  });
  const response = await client.request('/api/time-management/tasks/decompose', {
    method: 'POST',
    csrfToken: client.sessionCsrfToken,
    body: { entries },
  });

  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, 'NO_ACTIONABLE_TASKS');
});
