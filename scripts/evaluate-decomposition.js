const path = require('node:path');

const { createModelClient } = require('../server/model/model-client');
const {
  loadJsonl,
  runEvaluation,
} = require('../server/evals/decomposition-evaluator');

function parseArgs(argv) {
  const options = {
    mode: 'replay',
    dataset: path.join(__dirname, '..', 'tests', 'evals', 'decomposition-cases.jsonl'),
    json: false,
    failOnRegression: false,
    caseIds: [],
  };
  for (const argument of argv) {
    if (argument === '--json') options.json = true;
    else if (argument === '--fail-on-regression') options.failOnRegression = true;
    else if (argument.startsWith('--mode=')) options.mode = argument.slice('--mode='.length);
    else if (argument.startsWith('--dataset=')) {
      options.dataset = path.resolve(argument.slice('--dataset='.length));
    } else if (argument.startsWith('--case=')) {
      options.caseIds.push(argument.slice('--case='.length));
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function loadLocalEnv() {
  const filename = path.join(__dirname, '..', '.env');
  if (typeof process.loadEnvFile !== 'function') return;
  try {
    process.loadEnvFile(filename);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function requireEnvironment(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing required environment variable for live evaluation: ${name}`);
  return value;
}

function createLiveModelClient() {
  loadLocalEnv();
  const timeout = Number(process.env.MODEL_TIMEOUT_MS || 30_000);
  if (!Number.isInteger(timeout) || timeout < 1) {
    throw new Error('MODEL_TIMEOUT_MS must be a positive integer');
  }
  return createModelClient({
    modelApiBaseUrl: requireEnvironment('MODEL_API_BASE_URL'),
    modelApiKey: requireEnvironment('MODEL_API_KEY'),
    modelName: requireEnvironment('MODEL_NAME'),
    modelTimeoutMs: timeout,
  });
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function ratio(correct, total) {
  return total ? `${correct}/${total} (${percent(correct / total)})` : '0/0';
}

function printHumanReport(report, options) {
  const { summary } = report;
  process.stdout.write(`\n拆解流水线模拟评测\n`);
  process.stdout.write(`模式: ${summary.mode}\n`);
  process.stdout.write(`数据集: ${options.dataset}\n`);
  process.stdout.write(`案例: ${summary.passed}/${summary.cases} 通过 (${percent(summary.passRate)})\n`);
  process.stdout.write(`任务: precision=${percent(summary.tasks.precision)} recall=${percent(summary.tasks.recall)} F1=${percent(summary.tasks.f1)}\n`);
  process.stdout.write(`证据状态: ${ratio(summary.evidence.statusCorrect, summary.evidence.expected)}\n`);
  process.stdout.write(`昨天可执行证据覆盖: ${ratio(summary.yesterday.covered, summary.yesterday.expectedActionable)}\n`);
  process.stdout.write(`根因证据不足标记: ${ratio(summary.rootCause.correctlyMarkedInsufficient, summary.rootCause.requiredInsufficient)}\n`);
  process.stdout.write(`安全错误: 完成事项泄漏=${summary.safety.completedLeakage} 责任人幻觉=${summary.safety.ownerHallucinations} 期限幻觉=${summary.safety.dueHallucinations}\n`);

  if (summary.failures.length) {
    process.stdout.write('\n失败案例:\n');
    for (const failure of summary.failures) {
      process.stdout.write(`- ${failure.id} ${failure.description}: ${failure.failures.join(', ')}\n`);
    }
  }
  process.stdout.write('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let cases = loadJsonl(options.dataset);
  if (options.caseIds.length) {
    const selected = new Set(options.caseIds);
    cases = cases.filter(item => selected.has(item.id));
    const missing = options.caseIds.filter(id => !cases.some(item => item.id === id));
    if (missing.length) throw new Error(`Unknown case IDs: ${missing.join(', ')}`);
  }

  const liveModelClient = options.mode === 'live' ? createLiveModelClient() : null;
  if (options.mode === 'live' && !options.json) {
    process.stdout.write('注意：live 模式会调用当前配置的真实模型供应商并产生实际请求。\n');
  }
  const report = await runEvaluation({
    cases,
    mode: options.mode,
    liveModelClient,
  });

  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else printHumanReport(report, options);

  if (options.failOnRegression && report.summary.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`Decomposition evaluation failed: ${error.message}\n`);
  process.exitCode = 1;
});
