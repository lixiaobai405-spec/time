const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  buildReplayCoachResponse,
  buildReplayTaskResponse,
  loadJsonl,
  runEvaluation,
} = require('../../server/evals/decomposition-evaluator');

const DATASET = path.join(__dirname, '..', 'evals', 'decomposition-cases.jsonl');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('16个模拟业务案例的黄金回放全部通过并输出核心指标', async () => {
  const cases = loadJsonl(DATASET);
  assert.equal(cases.length, 16);

  const report = await runEvaluation({ cases, mode: 'replay' });
  assert.equal(report.summary.cases, 16);
  assert.equal(report.summary.passed, 16);
  assert.equal(report.summary.failed, 0);
  assert.equal(report.summary.tasks.precision, 1);
  assert.equal(report.summary.tasks.recall, 1);
  assert.equal(report.summary.evidence.statusCorrect, report.summary.evidence.expected);
  assert.equal(report.summary.yesterday.covered, report.summary.yesterday.expectedUnfinished);
  assert.equal(report.summary.safety.completedLeakage, 0);
  assert.equal(report.summary.safety.ownerHallucinations, 0);
  assert.equal(report.summary.safety.dueHallucinations, 0);
});

test('模拟模型多生成一条合法任务时评测器报告精确率下降和意外任务', async () => {
  const base = loadJsonl(DATASET).find(item => item.id === 'D001');
  const coach = buildReplayCoachResponse(base);
  const taskResponse = buildReplayTaskResponse(base);
  taskResponse.tasks.push({
    ...clone(taskResponse.tasks[0]),
    name: '重复处理客户投诉复盘',
    est: '30分钟',
  });
  const modelClient = {
    async completeJson(input) {
      if (input.responseSchemaName === 'time_coach_analysis_v1') return clone(coach);
      return clone(taskResponse);
    },
  };

  const report = await runEvaluation({
    cases: [base],
    mode: 'live',
    liveModelClient: modelClient,
  });
  assert.equal(report.summary.failed, 1);
  assert.equal(report.summary.tasks.expected, 1);
  assert.equal(report.summary.tasks.actual, 2);
  assert.equal(report.summary.tasks.matched, 1);
  assert.equal(report.summary.tasks.precision, 0.5);
  assert.deepEqual(report.summary.failures[0].failures, ['UNEXPECTED_TASKS']);
});

test('模拟模型编造证据原文时流水线拒绝且评测器记录非预期模型错误', async () => {
  const base = loadJsonl(DATASET).find(item => item.id === 'D001');
  const coach = buildReplayCoachResponse(base);
  coach.evidence[0].quote = '原文中不存在的客户投诉事实';
  const modelClient = {
    async completeJson(input) {
      if (input.responseSchemaName === 'time_coach_analysis_v1') return clone(coach);
      return buildReplayTaskResponse(base);
    },
  };

  const report = await runEvaluation({
    cases: [base],
    mode: 'live',
    liveModelClient: modelClient,
  });
  assert.equal(report.summary.failed, 1);
  assert.match(report.summary.failures[0].failures[0], /UNEXPECTED_MODEL_OUTPUT_INVALID/);
});

test('JSONL加载器对损坏行提供文件与行号', () => {
  assert.throws(
    () => loadJsonl(__filename),
    error => /Invalid JSONL/.test(error.message) && /decomposition-evaluator\.test\.js:1/.test(error.message),
  );
});
