function claim(text, evidenceIds = []) {
  return { text, evidenceIds };
}

function coachingAnalysis(evidenceIds) {
  const supported = claim('基于原文证据形成判断。', evidenceIds);
  const unknown = claim('证据不足：当前输入未提供该维度信息。');
  return {
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
  };
}

function decompositionFixture(snapshot) {
  const quote = snapshot.goals.今天;
  const evidence = snapshot.tasks.map((task, index) => ({
    id: `E${index + 1}`,
    dimension: '今天',
    quote,
    observation: task.name,
    kind: 'work',
    status: 'planned',
    owner: task.owner,
    due: task.due,
  }));
  const candidates = snapshot.tasks.map((task, index) => ({
    name: task.name,
    importance: task.importance,
    urgency: task.urgency,
    source: task.source,
    due: task.due,
    est: task.est,
    owner: task.owner,
    acceptanceCriteria: task.acceptanceCriteria,
    nextAction: task.nextAction,
    status: task.status,
    evidenceIds: [`E${index + 1}`],
  }));
  return {
    pipelineVersion: 'coach-decompose-v1',
    businessDate: '2026-07-21',
    stages: [
      {
        name: 'coach-analysis',
        prompt: {
          id: 'decomposition.coach-analysis',
          version: '1.0.0',
          sha256: 'a'.repeat(64),
        },
        output: {
          evidence,
          coachingAnalysis: coachingAnalysis(evidence.map(item => item.id)),
        },
      },
      {
        name: 'task-generation',
        prompt: {
          id: 'decomposition.task-generation',
          version: '1.0.0',
          sha256: 'b'.repeat(64),
        },
        output: { tasks: candidates },
      },
    ],
    taskEvidence: snapshot.tasks.map((task, index) => ({
      taskId: task.id,
      evidenceIds: [`E${index + 1}`],
    })),
  };
}

function taskFirstDecompositionFixture(snapshot, { withCoaching = false } = {}) {
  const generatedTask = snapshot.tasks[0];
  const evidence = [{
    id: 'E1',
    dimension: '今天',
    sourceLineIndex: 0,
    quote: snapshot.goals.今天,
    observation: generatedTask.name,
    kind: 'work',
    status: 'planned',
    owner: generatedTask.owner,
    due: generatedTask.due,
  }];
  const candidate = {
    name: generatedTask.name,
    importance: generatedTask.importance,
    urgency: generatedTask.urgency,
    source: generatedTask.source,
    due: generatedTask.due,
    est: generatedTask.est,
    owner: generatedTask.owner,
    acceptanceCriteria: generatedTask.acceptanceCriteria,
    nextAction: generatedTask.nextAction,
    status: generatedTask.status,
    evidenceIds: ['E1'],
  };
  const stages = [{
    name: 'evidence-task-generation',
    status: 'succeeded',
    prompt: {
      id: 'decomposition.evidence-task-generation',
      version: '2.0.0',
      sha256: 'c'.repeat(64),
    },
    attempts: 1,
    durationMs: 100,
    responseFormat: 'json_object',
    fallbackUsed: false,
    output: { evidence, tasks: [candidate] },
  }];
  if (withCoaching) {
    const analysisId = '33333333-3333-4333-8333-333333333333';
    stages.push({
      name: 'coaching-analysis',
      analysisId,
      status: 'succeeded',
      prompt: {
        id: 'decomposition.coaching-analysis',
        version: '2.0.0',
        sha256: 'd'.repeat(64),
      },
      attempts: 1,
      durationMs: 80,
      responseFormat: 'json_object',
      fallbackUsed: false,
      output: { coachingAnalysis: coachingAnalysis(['E1']) },
    });
  }
  return {
    pipelineVersion: 'task-first-v2',
    decompositionId: '44444444-4444-4444-8444-444444444444',
    businessDate: '2026-07-21',
    stages,
    taskEvidence: [{ taskId: generatedTask.id, evidenceIds: ['E1'] }],
  };
}

module.exports = { decompositionFixture, taskFirstDecompositionFixture };
