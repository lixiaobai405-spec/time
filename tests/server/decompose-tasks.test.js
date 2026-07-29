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

function todayCoach({
  quote = '今天11:30前提交方案',
  due = '今天11:30',
} = {}) {
  return {
    evidence: [{
      id: 'E1',
      dimension: '今天',
      quote,
      observation: '提交方案',
      kind: 'work',
      status: 'planned',
      owner: '待确认',
      due,
    }],
    coachingAnalysis: analysisFor(['E1']),
  };
}

function repeatedOwnerCoach() {
  return {
    evidence: [
      {
        id: 'E1',
        dimension: '昨天',
        quote: '复盘报告已经完成并发送给团队',
        observation: '复盘报告已经完成并发送',
        kind: 'result',
        status: 'completed',
        owner: '待确认',
        due: '待确认',
      },
      {
        id: 'E2',
        dimension: '昨天',
        quote: '目前还有2项措施没有明确负责人',
        observation: '仍有2项措施未明确负责人',
        kind: 'problem',
        status: 'unfinished',
        owner: '待确认',
        due: '待确认',
      },
      {
        id: 'E3',
        dimension: '昨天',
        quote: '今天上午先向团队收集负责人意向，并在今天11:30前完成2项措施的责任人确认',
        observation: '今天完成剩余责任人确认',
        kind: 'work',
        status: 'planned',
        owner: '待确认',
        due: '今天11:30前',
      },
      {
        id: 'E4',
        dimension: '今天',
        quote: '今天11:30前确认复盘报告中剩余2项改进措施的负责人，并在团队任务表中完成登记',
        observation: '确认剩余负责人并登记',
        kind: 'work',
        status: 'planned',
        owner: '待确认',
        due: '今天11:30前',
      },
    ],
    coachingAnalysis: analysisFor(['E1', 'E2', 'E3', 'E4']),
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
  assert.equal(coach.version, '1.1.0');
  assert.equal(tasks.version, '1.1.0');
  assert.match(coach.sha256, /^[0-9a-f]{64}$/);
  assert.match(tasks.sha256, /^[0-9a-f]{64}$/);
  assert.match(coach.text, /owner.*due.*不得.*作为.*unfinished.*判断依据/s);
  assert.match(coach.text, /planned.*今天.*明天.*以后/s);
  assert.doesNotMatch(
    coach.text,
    /unfinished.*昨天.*可执行事项没有任何完成标记/s,
  );
  assert.match(tasks.text, /同一事项.*只生成一条任务/s);
  assert.match(tasks.text, /直接相关.*直接解决.*辅助证据/s);
  assert.match(
    tasks.text,
    /今天、明天、后天中 status=planned 的可执行事项应生成任务/,
  );
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

test('任务截止时间由主要 evidence 决定并由服务端统一标准化', async () => {
  const modelClient = queuedModel([
    todayCoach(),
    generatedTasks([task({
      name: '提交方案',
      source: '今天',
      due: '2026-07-29 11:30',
    })]),
  ]);

  const result = await decomposeTasks({
    entries: {
      昨天: '',
      今天: '今天11:30前提交方案',
      明天: '',
      后天: '',
    },
    modelClient,
    now: () => new Date('2026-07-29T04:00:00.000Z'),
  });

  assert.equal(modelClient.calls.length, 2);
  assert.equal(result.tasks[0].due, '2026-07-29');
  assert.equal(
    result.decomposition.stages[1].output.tasks[0].due,
    '今天11:30',
  );
});

test('主要 evidence 未提供截止时间时忽略模型虚构日期', async () => {
  const modelClient = queuedModel([
    todayCoach({
      quote: '提交项目方案',
      due: '待确认',
    }),
    generatedTasks([task({
      name: '提交项目方案',
      source: '今天',
      due: '2030-01-01',
    })]),
  ]);

  const result = await decomposeTasks({
    entries: {
      昨天: '',
      今天: '提交项目方案',
      明天: '',
      后天: '',
    },
    modelClient,
    now: () => new Date('2026-07-29T04:00:00.000Z'),
  });

  assert.equal(modelClient.calls.length, 2);
  assert.equal(result.tasks[0].due, '待确认');
  assert.equal(
    result.decomposition.stages[1].output.tasks[0].due,
    '待确认',
  );
});

test('今天行动作为主要证据时可直接覆盖相关的昨天未完成差距', async () => {
  const modelClient = queuedModel([
    repeatedOwnerCoach(),
    generatedTasks([task({
      name: '确认剩余2项改进措施负责人',
      source: '今天',
      due: '今天11:30前',
      est: '30分钟',
      evidenceIds: ['E4', 'E2', 'E3'],
    })]),
  ]);

  const result = await decomposeTasks({
    entries: {
      昨天: [
        '复盘报告已经完成并发送给团队。',
        '目前还有2项措施没有明确负责人。',
        '今天上午先向团队收集负责人意向，并在今天11:30前完成2项措施的责任人确认。',
      ].join(''),
      今天: '今天11:30前确认复盘报告中剩余2项改进措施的负责人，并在团队任务表中完成登记。',
      明天: '',
      后天: '',
    },
    modelClient,
    now: () => new Date('2026-07-29T04:00:00.000Z'),
  });

  assert.equal(modelClient.calls.length, 2);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].source, '今天');
  assert.equal(result.tasks[0].due, '2026-07-29');
  assert.deepEqual(
    result.decomposition.taskEvidence[0].evidenceIds,
    ['E4', 'E2', 'E3'],
  );
});

test('昨天已完成证据仍不得成为任务主要证据', async () => {
  const completed = yesterdayCoach({
    status: 'completed',
    quote: '昨天已完成审核方案',
  });
  const modelClient = queuedModel([
    completed,
    generatedTasks([task()]),
    generatedTasks([task()]),
  ]);

  await assert.rejects(
    decomposeTasks({
      entries: {
        昨天: '昨天已完成审核方案',
        今天: '',
        明天: '',
        后天: '',
      },
      modelClient,
    }),
    error => error.code === 'MODEL_OUTPUT_INVALID'
      && error.stage === 'task-generation'
      && error.failedRules.includes('NON_ACTIONABLE_EVIDENCE_USED'),
  );
});
