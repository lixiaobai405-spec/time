const test = require('node:test');
const assert = require('node:assert/strict');

const { loadVersionedPrompt } = require('../../server/prompts/load-versioned-prompt');
const { decomposeTasks } = require('../../server/workflows/decompose-tasks');

function claim(text, evidenceIds = []) {
  return { text, evidenceIds };
}

function analysisFor(evidenceIds = []) {
  const supported = claim('基于原文证据形成当前判断。', evidenceIds);
  const unknown = claim('证据不足：当前输入未提供该维度信息。');
  return {
    yesterday_analysis: {
      key_problem: evidenceIds.length ? supported : unknown,
      gap: unknown,
      root_cause: unknown,
      management_insight: evidenceIds.length ? supported : unknown,
    },
    today_focus: {
      key_work: unknown,
      priority_reason: unknown,
      manager_action: unknown,
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
    overall_insight: evidenceIds.length ? supported : unknown,
  };
}

function yesterdayCoach({ status = 'unfinished', quote = '昨天未完成审核方案' } = {}) {
  return {
    evidence: [{
      id: 'E1',
      dimension: '昨天',
      quote,
      observation: status === 'completed' ? '审核方案已完成' : '审核方案尚未完成',
      kind: 'work',
      status,
      owner: '待确认',
      due: '待确认',
    }],
    coachingAnalysis: analysisFor(['E1']),
  };
}

function generatedTasks(tasks) {
  return { tasks };
}

function task(overrides = {}) {
  return {
    name: '审核方案',
    importance: '中',
    urgency: '高',
    source: '复盘',
    due: '待确认',
    est: '1h',
    owner: '待确认',
    acceptanceCriteria: [],
    nextAction: '',
    status: 'pending',
    evidenceIds: ['E1'],
    ...overrides,
  };
}

function queuedModel(outputs) {
  const calls = [];
  return {
    calls,
    async completeJson(input) {
      calls.push(input);
      const output = outputs[Math.min(calls.length - 1, outputs.length - 1)];
      return typeof output === 'function' ? output(input) : output;
    },
  };
}

test('昨天未完成事项必须拆为复盘任务并进入可追溯任务映射', async () => {
  const modelClient = queuedModel([
    yesterdayCoach(),
    generatedTasks([task()]),
  ]);
  const result = await decomposeTasks({
    entries: { 昨天: '昨天未完成审核方案', 今天: '', 明天: '', 后天: '' },
    modelClient,
    now: () => new Date('2026-07-28T04:00:00.000Z'),
  });

  assert.equal(modelClient.calls.length, 2);
  assert.equal(modelClient.calls[0].responseSchemaName, 'time_coach_analysis_v1');
  assert.doesNotMatch(modelClient.calls[0].system, /昨天未完成审核方案/);
  assert.match(modelClient.calls[0].user, /昨天未完成审核方案/);
  assert.equal(modelClient.calls[1].responseSchemaName, 'time_task_generation_v1');
  assert.equal(result.tasks[0].source, '复盘');
  assert.equal(result.tasks[0].name, '审核方案');
  assert.equal(result.decomposition.pipelineVersion, 'coach-decompose-v1');
  assert.deepEqual(result.decomposition.taskEvidence, [{
    taskId: result.tasks[0].id,
    evidenceIds: ['E1'],
  }]);
  assert.equal(result.decomposition.stages[0].output.evidence[0].quote, '昨天未完成审核方案');
});

test('任务生成遗漏昨天未完成证据时重试后拒绝', async () => {
  const modelClient = queuedModel([
    yesterdayCoach(),
    generatedTasks([]),
    generatedTasks([]),
  ]);

  await assert.rejects(
    decomposeTasks({
      entries: { 昨天: '昨天未完成审核方案', 今天: '', 明天: '', 后天: '' },
      modelClient,
    }),
    error => error.code === 'MODEL_OUTPUT_INVALID'
      && error.stage === 'task-generation'
      && error.failedRules.includes('UNFINISHED_YESTERDAY_NOT_COVERED'),
  );
  assert.equal(modelClient.calls.length, 3);
  assert.deepEqual(
    JSON.parse(modelClient.calls[2].user).retryFeedback.failedRules,
    ['UNFINISHED_YESTERDAY_NOT_COVERED'],
  );
});

test('证据 quote 不存在于对应原文时不得进入任务生成阶段', async () => {
  const invalid = yesterdayCoach({ quote: '原文不存在的内容' });
  const modelClient = queuedModel([invalid, invalid]);

  await assert.rejects(
    decomposeTasks({
      entries: { 昨天: '昨天未完成审核方案', 今天: '', 明天: '', 后天: '' },
      modelClient,
    }),
    error => error.code === 'MODEL_OUTPUT_INVALID'
      && error.stage === 'coach-analysis'
      && error.failedRules.includes('EVIDENCE_QUOTE_NOT_IN_SOURCE'),
  );
  assert.equal(modelClient.calls.length, 2);
});

test('versioned prompts expose stable identity, version and content hash', () => {
  const coach = loadVersionedPrompt('decomposition.coach-analysis');
  const tasks = loadVersionedPrompt('decomposition.task-generation');
  assert.equal(coach.id, 'decomposition.coach-analysis');
  assert.equal(tasks.id, 'decomposition.task-generation');
  assert.equal(coach.version, '1.0.0');
  assert.match(coach.sha256, /^[0-9a-f]{64}$/);
  assert.match(tasks.sha256, /^[0-9a-f]{64}$/);
  assert.match(coach.text, /evidence_protocol/);
  assert.match(tasks.text, /昨天的 unfinished 证据必须生成/);
  assert.strictEqual(loadVersionedPrompt('decomposition.coach-analysis'), coach);
  assert.throws(
    () => loadVersionedPrompt('decomposition.unknown'),
    error => error.code === 'PROMPT_INVALID',
  );
});

test('昨天已完成证据不得转成待办任务', async () => {
  const coach = {
    evidence: [
      yesterdayCoach({ status: 'completed', quote: '昨天已完成审核方案' }).evidence[0],
      {
        id: 'E2',
        dimension: '今天',
        quote: '今天提交汇总结果',
        observation: '提交汇总结果',
        kind: 'work',
        status: 'planned',
        owner: '待确认',
        due: '待确认',
      },
    ],
    coachingAnalysis: analysisFor(['E1', 'E2']),
  };
  const modelClient = queuedModel([
    coach,
    generatedTasks([task({
      name: '提交汇总结果',
      source: '今天',
      evidenceIds: ['E2'],
    })]),
  ]);
  const result = await decomposeTasks({
    entries: {
      昨天: '昨天已完成审核方案',
      今天: '今天提交汇总结果',
      明天: '',
      后天: '',
    },
    modelClient,
  });

  assert.deepEqual(result.tasks.map(item => item.name), ['提交汇总结果']);
  assert.deepEqual(result.decomposition.taskEvidence[0].evidenceIds, ['E2']);
});
