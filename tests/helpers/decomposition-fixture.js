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

module.exports = { decompositionFixture };
