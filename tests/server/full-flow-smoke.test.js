const assert = require('node:assert/strict');
const test = require('node:test');

const { FULL_FLOW_ENTRIES, runFullFlow } = require('../helpers/full-flow-runner');

function claim(text, evidenceIds = []) {
  return { text, evidenceIds };
}

function coachingAnalysis() {
  const supported = claim('今天需要按时提交接口联调结果。', ['E1']);
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
      possible_delegation: supported,
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
      problem_to_action: supported,
      action_to_optimization: unknown,
      optimization_to_future: unknown,
    },
    coaching_suggestions: [],
    overall_insight: supported,
  };
}

function decompositionOutput() {
  return {
    evidence: [{
      id: 'E1',
      dimension: '今天',
      sourceLineIndex: 0,
      quote: FULL_FLOW_ENTRIES.今天,
      observation: '提交接口联调结果',
      kind: 'work',
      status: 'planned',
      owner: '张三',
      due: '今天17:00前',
    }],
    tasks: [{
      name: '提交接口联调结果',
      importance: '高',
      urgency: '高',
      source: '今天',
      est: '1h',
      acceptanceCriteria: [],
      nextAction: '',
      status: 'pending',
      evidenceIds: ['E1'],
    }],
  };
}

test('全流程冒烟：认证、五步、历史和每日跟踪全部串联', async (t) => {
  const calls = [];
  const modelClient = {
    async completeJson(input) {
      calls.push(input);
      if (calls.length === 1) {
        assert.equal(input.responseSchemaName, 'time_evidence_task_generation_v2');
        return decompositionOutput();
      }
      if (calls.length === 2) {
        assert.equal(input.responseSchemaName, 'time_coaching_analysis_v2');
        return { coachingAnalysis: coachingAnalysis() };
      }
      const body = JSON.parse(input.user);
      if (calls.length === 3) {
        return {
          classifications: body.tasks.map(task => ({
            taskId: task.id,
            importance: task.importance,
            urgency: task.urgency,
          })),
          note: '单任务直接进入第一象限。',
        };
      }
      assert.equal(calls.length, 4);
      return {
        order: body.priorityContext.recommendedTaskIds.map(taskId => ({
          taskId,
          reason: '该任务今天到期，应优先完成。',
        })),
        energyRules: ['先完成今天到期的第一象限任务。'],
        adjustments: ['完成后立即登记接口联调结果。'],
      };
    },
  };

  const result = await runFullFlow(t, {
    modelClient,
    now: () => new Date('2026-08-02T04:00:00.000Z'),
    usernamePrefix: 'smoke',
  });

  assert.equal(calls.length, 4);
  assert.equal(result.decomposed.tasks.length, 1);
  assert.equal(result.decomposed.tasks[0].owner, '张三');
  assert.equal(result.decomposed.tasks[0].due, '2026-08-02');
  assert.equal(result.distribution.totalMinutes, 60);
  assert.equal(result.history.decomposition.stages.length, 2);
});
