const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const { checkGoals } = require('../../server/workflows/check-goals');
const { classifyMatrix } = require('../../server/workflows/classify-matrix');
const { extractTasks } = require('../../server/workflows/extract-tasks');
const { generateReport } = require('../../server/workflows/generate-report');

const KEYS = ['昨天', '今天', '明天', '后天'];

function model(outputs) {
  const calls = [];
  return {
    calls,
    completeJson: async input => {
      calls.push(input);
      return outputs[Math.min(calls.length - 1, outputs.length - 1)];
    },
  };
}

function review(overrides = {}) {
  const statuses = overrides.statuses || {};
  return {
    fields: KEYS.map(key => ({
      key,
      status: statuses[key] || 'ok',
      issue: statuses[key] === 'warn' ? overrides.issue : '',
      suggestion: statuses[key] === 'warn' ? overrides.suggestion : '',
    })),
    overall: Object.values(statuses).includes('warn') ? 'need_fix' : 'pass',
  };
}

test('空输入通过假模型返回四个字段级 warn', async () => {
  const goals = Object.fromEntries(KEYS.map(key => [key, '']));
  const output = {
    fields: KEYS.map(key => ({
      key,
      status: 'warn',
      issue: '示范，请按实际修改:尚未填写',
      suggestion: '请按实际情况补充',
    })),
    overall: 'need_fix',
  };
  const result = await checkGoals({ goals, modelClient: model([output]) });
  assert.equal(result.fields.filter(item => item.status === 'warn').length, 4);
  assert.equal(result.overall, 'need_fix');
  assert.equal('questions' in result, false);
});

test('PDCA 缺环和 SMART 缺指标时保留模型的字段级判定', async () => {
  const goals = {
    昨天: '获客完成 80%',
    今天: '提交方案',
    明天: '提升业绩',
    后天: '年底完成年度规划',
  };
  const output = review({
    statuses: { 昨天: 'warn', 明天: 'warn' },
    issue: '缺少原因、改进或可衡量指标与时限',
    suggestion: '补充差距原因并写明指标和截止时间',
  });
  const result = await checkGoals({ goals, modelClient: model([output]) });
  assert.equal(result.fields.find(item => item.key === '昨天').status, 'warn');
  assert.equal(result.fields.find(item => item.key === '明天').status, 'warn');
  assert.equal(result.overall, 'need_fix');
});

test('并列事项拆为稳定 ID 不同的两条任务', async () => {
  const goals = { 昨天: '', 今天: '① 校对方案 ② 跟进投诉', 明天: '', 后天: '' };
  const output = {
    tasks: [
      { name: '校对方案', importance: '中', urgency: '高', source: '今天', due: '待确认', est: '约 1h', status: 'pending' },
      { name: '跟进投诉', importance: '高', urgency: '高', source: '今天', due: '待确认', est: '约 1h', status: 'pending' },
    ],
  };
  const result = await extractTasks({ goals, modelClient: model([output]) });
  assert.deepEqual(result.tasks.map(item => item.name), ['校对方案', '跟进投诉']);
  assert.notEqual(result.tasks[0].id, result.tasks[1].id);
});

test('空维度伪造的任务在两次假模型输出后被拒绝', async () => {
  const goals = { 昨天: '', 今天: '提交方案', 明天: '', 后天: '' };
  const invalid = {
    tasks: [{ name: '虚构短期任务', importance: '高', urgency: '低', source: '短期目标', due: '待确认', est: '约 1h', status: 'pending' }],
  };
  const modelClient = model([invalid, invalid]);
  await assert.rejects(
    extractTasks({ goals, modelClient }),
    error => error.code === 'MODEL_OUTPUT_INVALID',
  );
  assert.equal(modelClient.calls.length, 2);
});

test('单任务矩阵不重复且其他象限为空', async () => {
  const tasks = [{
    id: 'task-one',
    name: '提交复盘',
    importance: '高',
    urgency: '高',
    classificationSource: 'ai-extraction',
  }];
  const result = await classifyMatrix({
    tasks,
    modelClient: model([{
      classifications: [{ taskId: 'task-one', importance: '高', urgency: '高' }],
      note: '',
    }]),
  });
  assert.deepEqual(result.quadrants.map(item => item.taskIds), [['task-one'], [], [], []]);
});

test('五条第一象限任务由服务端补充过载提示', async () => {
  const tasks = Array.from({ length: 5 }, (_, index) => ({
    id: `task-${index}`,
    name: `重要任务 ${index}`,
    importance: '高',
    urgency: '高',
    classificationSource: 'ai-extraction',
  }));
  const result = await classifyMatrix({
    tasks,
    modelClient: model([{
      classifications: tasks.map(item => ({
        taskId: item.id,
        importance: '高',
        urgency: '高',
      })),
      note: '',
    }]),
  });
  assert.match(result.note, /二次筛选|授权/);
});

test('报告不得引用当前列表之外的任务', async () => {
  const tasks = [{ id: 'current', name: '当前任务', source: '今天' }];
  const matrix = { quadrants: [{ q: '第一象限', taskIds: ['current'] }] };
  const goals = { 昨天: '', 后天: '' };
  const invalid = {
    order: [{ taskId: 'invented', reason: '虚构任务' }],
    energyRules: ['保留重要时间'],
    adjustments: ['每周复盘'],
  };
  const modelClient = model([invalid, invalid]);
  await assert.rejects(
    generateReport({ tasks, matrix, goals, modelClient }),
    error => error.code === 'MODEL_OUTPUT_INVALID',
  );
  assert.equal(modelClient.calls.length, 2);
});

test('提示词用例文档分开自动化覆盖与人工模型评测', () => {
  const source = readFileSync(path.join(__dirname, '..', 'prompt-cases.md'), 'utf8');
  assert.match(source, /## 自动化与人工评测/);
  assert.match(source, /tests\/server\/prompt-contract\.test\.js/);
  assert.match(source, /人工\/模型评测/);
  assert.match(source, /模型名.*日期.*通过项.*失败样例/s);
});

test('人工业务回归文档记录评测元数据和五类语义问题', () => {
  const source = readFileSync(path.join(__dirname, '..', 'prompt-cases.md'), 'utf8');
  assert.match(source, /## 2026-07-20 人工业务回归/);
  assert.match(source, /模型名.*评测日期.*参考时区.*通过项.*失败样例/s);
  for (const finding of [
    '当天截止紧急度',
    '报告排序',
    '禁止延后',
    '任务粒度',
    'SMART 验收条件',
  ]) {
    assert.match(source, new RegExp(finding));
  }
});

test('人工业务回归文档记录十二任务的假模型端到端证据', () => {
  const source = readFileSync(path.join(__dirname, '..', 'prompt-cases.md'), 'utf8');
  assert.match(source, /12 条任务.*任务卡.*矩阵.*报告/s);
  assert.match(source, /55\/25\/15\/5/);
  assert.match(source, /UUID.*8 位前缀/s);
  assert.match(source, /假模型/);
});

test('报告提示词声明确定性顺序和到期任务保护规则', () => {
  const source = readFileSync(
    path.join(__dirname, '..', '..', 'prompts', 'system.md'),
    'utf8',
  );
  assert.match(source, /recommendedTaskIds.*完全同序/s);
  assert.match(source, /protectedTaskIds.*推迟.*延后.*取消.*暂缓.*搁置/s);
  assert.match(source, /remainingProtectedTaskIds/);
  assert.match(source, /第三象限.*授权.*委派.*交办/s);
  assert.match(source, /第四象限.*无明确期限.*推迟.*取消/s);
  assert.match(source, /taskId.*只.*结构化.*taskId.*字段/s);
  assert.match(source, /用户可见.*完整.*ID.*前缀/s);
});
