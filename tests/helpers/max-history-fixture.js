const CATEGORY_KEYS = ['昨天', '今天', '明天', '后天'];
const SOURCE_BY_DIMENSION = {
  昨天: '复盘',
  今天: '今天',
  明天: '短期目标',
  后天: '中长期',
};

function maxText(length) {
  // NUL is legal schema text and expands to six bytes as "\\u0000" in JSON.
  return String.fromCharCode(0).repeat(length);
}

function uuid(index) {
  return `${index.toString(16).padStart(8, '0')}-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

function claim(text, evidenceIds) {
  return { text, evidenceIds };
}

function maxCoachingAnalysis(evidenceIds) {
  const value = () => claim(maxText(240), [...evidenceIds]);
  return {
    yesterday_analysis: {
      key_problem: value(), gap: value(), root_cause: value(), management_insight: value(),
    },
    today_focus: {
      key_work: value(), priority_reason: value(), manager_action: value(), possible_delegation: value(),
    },
    tomorrow_optimization: {
      management_improvement: value(), system_building: value(), capability_upgrade: value(),
    },
    future_direction: {
      long_term_goal: value(), organization_capability: value(), future_focus: value(),
    },
    connection_analysis: {
      problem_to_action: value(), action_to_optimization: value(), optimization_to_future: value(),
    },
    coaching_suggestions: Array.from({ length: 3 }, () => ({
      issue: value(),
      suggestion: value(),
      coaching_question: maxText(240),
    })),
    overall_insight: value(),
  };
}

function maxHistorySnapshot() {
  const goalLineFillers = [1330, 1330, 1329];
  const goalLines = Object.fromEntries(CATEGORY_KEYS.map(dimension => [
    dimension,
    goalLineFillers.map((length, index) => (
      `${dimension}${index + 1}共同事项${maxText(length - 4)}`
    )).join('\n'),
  ]));
  const evidence = [];
  for (const dimension of CATEGORY_KEYS) {
    for (let sourceLineIndex = 0; sourceLineIndex < 3; sourceLineIndex += 1) {
      evidence.push({
        id: `E${evidence.length + 1}`,
        dimension,
        sourceLineIndex,
        quote: goalLines[dimension].split('\n')[sourceLineIndex].slice(0, 120),
        observation: maxText(120),
        kind: 'work',
        status: 'planned',
        owner: '待确认',
        due: '待确认',
      });
    }
  }
  const tasks = Array.from({ length: 100 }, (_, index) => ({
    id: uuid(index + 1),
    name: maxText(200),
    importance: '高',
    urgency: '高',
    source: '今天',
    due: maxText(80),
    est: maxText(40),
    owner: maxText(100),
    acceptanceCriteria: Array.from({ length: 5 }, () => maxText(200)),
    nextAction: maxText(200),
    status: 'pending',
    classificationSource: 'manual',
  }));
  const candidates = evidence.map((item, index) => ({
    name: maxText(120),
    importance: '高',
    urgency: '高',
    source: SOURCE_BY_DIMENSION[item.dimension],
    due: '待确认',
    est: maxText(20),
    owner: '待确认',
    acceptanceCriteria: Array.from({ length: 3 }, () => maxText(120)),
    nextAction: maxText(120),
    status: 'pending',
    evidenceIds: evidence.map((_, offset) => (
      evidence[(index + offset) % evidence.length].id
    )),
  }));
  const evidenceIds = evidence.map(item => item.id);
  const decompositionId = uuid(1001);
  const analysisId = uuid(1002);
  const decomposition = {
    pipelineVersion: 'task-first-v2',
    decompositionId,
    businessDate: '2026-07-30',
    stages: [
      {
        name: 'evidence-task-generation',
        status: 'succeeded',
        prompt: {
          id: 'decomposition.evidence-task-generation',
          version: '2.1.0',
          sha256: 'a'.repeat(64),
        },
        correctionPrompt: {
          id: 'decomposition.task-generation',
          version: '1.1.0',
          sha256: 'c'.repeat(64),
        },
        attempts: 3,
        durationMs: Number.MAX_SAFE_INTEGER,
        responseFormat: 'json_schema',
        fallbackUsed: true,
        output: { evidence, tasks: candidates },
      },
      {
        name: 'coaching-analysis',
        analysisId,
        status: 'succeeded',
        prompt: {
          id: 'decomposition.coaching-analysis',
          version: '2.0.0',
          sha256: 'b'.repeat(64),
        },
        attempts: 3,
        durationMs: Number.MAX_SAFE_INTEGER,
        responseFormat: 'json_schema',
        fallbackUsed: true,
        output: { coachingAnalysis: maxCoachingAnalysis(evidenceIds) },
      },
    ],
    taskEvidence: candidates.map((candidate, index) => ({
      taskId: tasks[index].id,
      evidenceIds: candidate.evidenceIds,
    })),
  };
  return {
    clientRunId: uuid(2001),
    title: maxText(100),
    goals: goalLines,
    decomposition,
    tasks,
    distribution: {
      totalMinutes: 400,
      totalHours: 400 / 60,
      validTaskCount: 0,
      invalidTasks: tasks.map(task => ({
        taskId: task.id,
        name: maxText(200),
        est: maxText(40),
      })),
      categories: CATEGORY_KEYS.map(key => ({
        key,
        minutes: 100,
        hours: 100 / 60,
        percent: 25,
        target: { min: 0, max: 100, label: maxText(20) },
        status: 'ok',
      })),
      percentages: { 昨天: 25, 今天: 25, 明天: 25, 后天: 25 },
      diagnosis: Array.from({ length: 10 }, () => maxText(4000)),
      recommendations: Array.from({ length: 10 }, () => maxText(4000)),
    },
    matrix: {
      classifications: tasks.map(task => ({
        taskId: task.id,
        importance: task.importance,
        urgency: task.urgency,
        classificationSource: task.classificationSource,
      })),
      quadrants: [
        { name: '第一象限', priority: 1, action: '立即做', energyPercent: 55, taskIds: tasks.map(task => task.id) },
        { name: '第二象限', priority: 2, action: '计划做', energyPercent: 25, taskIds: [] },
        { name: '第三象限', priority: 3, action: '授权做', energyPercent: 15, taskIds: [] },
        { name: '第四象限', priority: 4, action: '减少做', energyPercent: 5, taskIds: [] },
      ],
      note: maxText(4000),
    },
    report: {
      order: tasks.slice(0, 5).map(task => ({
        taskId: task.id,
        reason: maxText(4000),
      })),
      energyRules: Array.from({ length: 3 }, () => maxText(4000)),
      adjustments: Array.from({ length: 3 }, () => maxText(4000)),
    },
  };
}

module.exports = { maxHistorySnapshot };
