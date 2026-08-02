const assert = require('node:assert/strict');
const test = require('node:test');

const { createModelClient } = require('../../server/model/model-client');
const { loadDeepSeekLiveConfig } = require('../helpers/deepseek-live-config');
const { runFullFlow } = require('../helpers/full-flow-runner');

test('DeepSeek 真实 API 完成认证、五步、历史与每日跟踪全流程', {
  timeout: 120_000,
}, async (t) => {
  const { config, environmentFile } = loadDeepSeekLiveConfig();
  t.diagnostic(`config=${environmentFile}; model=${config.modelName}; mode=${config.modelResponseFormatMode}`);

  const result = await runFullFlow(t, {
    modelClient: createModelClient(config),
    logger: entry => t.diagnostic(JSON.stringify(entry)),
    appConfig: {
      modelTimeoutMs: config.modelTimeoutMs,
      modelTaskRouteBudgetMs: config.modelTaskRouteBudgetMs,
      modelResponseFormatMode: config.modelResponseFormatMode,
      modelTaskMaxOutputTokens: config.modelTaskMaxOutputTokens,
      modelCoachMaxOutputTokens: config.modelCoachMaxOutputTokens,
    },
    usernamePrefix: 'ds',
  });

  assert.ok(result.decomposed.tasks.length >= 1);
  assert.equal(result.decomposed.decomposition.stages[0].prompt.version, '2.1.0');
  assert.equal(result.history.decomposition.stages.length, 2);
  assert.equal(result.daily.sourceSummary.historyCount, 1);
  t.diagnostic(
    `tasks=${result.decomposed.tasks.length}; minutes=${result.distribution.totalMinutes}; history=${result.history.id}`,
  );
});
