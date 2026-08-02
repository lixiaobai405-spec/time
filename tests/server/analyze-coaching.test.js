const test = require('node:test');
const assert = require('node:assert/strict');

const { analyzeCoaching } = require('../../server/workflows/analyze-coaching');

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

function request() {
  return {
    decompositionId: '11111111-1111-4111-8111-111111111111',
    attemptId: '22222222-2222-4222-8222-222222222222',
    businessDate: '2026-07-30',
    entries: {
      昨天: '昨天未完成审核方案',
      今天: '',
      明天: '',
      后天: '',
    },
    evidence: [{
      id: 'E1',
      dimension: '昨天',
      sourceLineIndex: 0,
      quote: '昨天未完成审核方案',
      observation: '审核方案尚未完成',
      kind: 'work',
      status: 'unfinished',
      owner: '待确认',
      due: '待确认',
    }],
  };
}

function queuedModel(outputs) {
  const calls = [];
  return {
    calls,
    async completeJson(input) {
      calls.push(input);
      return outputs[Math.min(calls.length - 1, outputs.length - 1)];
    },
  };
}

test('独立 coaching 只生成诊断 stage', async () => {
  const modelClient = queuedModel([{ coachingAnalysis: analysisFor(['E1']) }]);
  const result = await analyzeCoaching({
    ...request(),
    modelClient,
  });

  assert.equal(modelClient.calls.length, 1);
  assert.equal(modelClient.calls[0].responseSchemaName, 'time_coaching_analysis_v2');
  assert.equal(result.decompositionId, request().decompositionId);
  assert.equal(result.attemptId, request().attemptId);
  assert.equal(result.stage.analysisId, result.analysisId);
  assert.equal(result.stage.name, 'coaching-analysis');
  assert.equal(result.stage.prompt.id, 'decomposition.coaching-analysis');
  assert.deepEqual(Object.keys(result).sort(), [
    'analysisId',
    'attemptId',
    'decompositionId',
    'stage',
  ]);
});

test('coaching claim 不得引用未知 evidence', async () => {
  const invalid = analysisFor(['E999']);
  const modelClient = queuedModel([
    { coachingAnalysis: invalid },
    { coachingAnalysis: invalid },
  ]);

  await assert.rejects(
    analyzeCoaching({ ...request(), modelClient }),
    error => error.code === 'MODEL_OUTPUT_INVALID'
      && error.failedRules.includes('CLAIM_EVIDENCE_NOT_FOUND'),
  );
  assert.equal(modelClient.calls.length, 3);
});

test('无 evidence 的 claim 必须明确标记证据不足', async () => {
  const invalid = analysisFor(['E1']);
  invalid.today_focus.key_work = claim('今天应优先完成方案。');
  const modelClient = queuedModel([
    { coachingAnalysis: invalid },
    { coachingAnalysis: invalid },
  ]);

  await assert.rejects(
    analyzeCoaching({ ...request(), modelClient }),
    error => error.failedRules.includes('UNSUPPORTED_CLAIM_NOT_MARKED'),
  );
});

test('空 evidenceIds 的错误文案通过精确重试指令纠正', async () => {
  const invalid = analysisFor(['E1']);
  invalid.today_focus.key_work = claim('暂无足够信息判断今天重点。');
  const valid = analysisFor(['E1']);
  const modelClient = queuedModel([
    { coachingAnalysis: invalid },
    { coachingAnalysis: valid },
  ]);

  const result = await analyzeCoaching({ ...request(), modelClient });

  assert.equal(modelClient.calls.length, 2);
  const retry = JSON.parse(modelClient.calls[1].user).retryFeedback;
  assert.deepEqual(retry.failedRules, ['UNSUPPORTED_CLAIM_NOT_MARKED']);
  assert.match(retry.correction, /严格以“证据不足”四个字开头/);
  assert.match(retry.correction, /禁止使用“信息不足”“暂无证据”/);
  assert.equal(result.stage.attempts, 2);
});

test('语义纠正后遇到 JSON 格式错误时第三轮仍可恢复', async () => {
  const invalid = analysisFor(['E1']);
  invalid.today_focus.key_work = claim('暂无足够信息判断今天重点。');
  const calls = [];
  const modelClient = {
    calls,
    async completeJson(input) {
      calls.push(input);
      if (calls.length === 1) return { coachingAnalysis: invalid };
      if (calls.length === 2) {
        throw Object.assign(new Error('invalid model JSON'), {
          code: 'MODEL_OUTPUT_INVALID',
          diagnosticCode: 'MODEL_JSON_SEPARATOR_INVALID',
        });
      }
      return { coachingAnalysis: analysisFor(['E1']) };
    },
  };

  const result = await analyzeCoaching({ ...request(), modelClient });

  assert.equal(calls.length, 3);
  assert.equal(result.stage.attempts, 3);
  const thirdRetry = JSON.parse(calls[2].user).retryFeedback;
  assert.deepEqual(thirdRetry.failedRules, ['MODEL_JSON_SEPARATOR_INVALID']);
  assert.match(thirdRetry.correction, /重新生成完整 coachingAnalysis JSON/);
});

test('coaching 请求拒绝未知字段和篡改 evidence', async () => {
  const modelClient = queuedModel([{ coachingAnalysis: analysisFor(['E1']) }]);
  await assert.rejects(
    analyzeCoaching({ ...request(), unexpected: true, modelClient }),
    error => error.code === 'INPUT_INVALID' && error.status === 400,
  );

  const badEvidence = request();
  badEvidence.evidence[0].quote = '不存在';
  await assert.rejects(
    analyzeCoaching({ ...badEvidence, modelClient }),
    error => error.code === 'MODEL_OUTPUT_INVALID'
      && error.failedRules.includes('EVIDENCE_QUOTE_NOT_IN_SOURCE_LINE'),
  );
  assert.equal(modelClient.calls.length, 0);
});
