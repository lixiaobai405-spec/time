const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

function read(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('README 说明专用 Anaconda 环境、启动、测试和四个接口', () => {
  const source = read('README.md');
  assert.match(source, /Node\.js 20/);
  assert.match(source, /\.conda/);
  assert.match(source, /npm\.cmd ci/);
  assert.match(source, /MODEL_API_BASE_URL/);
  assert.match(source, /MODEL_API_KEY/);
  for (const endpoint of [
    '/api/time-management/goals/check',
    '/api/time-management/tasks/extract',
    '/api/time-management/matrix/classify',
    '/api/time-management/report/generate',
  ]) {
    assert.match(source, new RegExp(endpoint));
  }
  assert.match(source, /当前会话/);
  assert.match(source, /不包含账号/);
  assert.match(source, /不包含.*历史记录/s);
  assert.match(source, /不包含.*外部平台集成/s);
});

test('甲方验收清单包含 11 项正式交付口径和测试证据', () => {
  const source = read('docs/acceptance/time-management-v1.md');
  const expectations = [
    '四栏输入与 PDCA/SMART 检查',
    '未通过检查不能进入下一步',
    '用户输入真实生成任务',
    '手动新增/删除后下游重新计算',
    '手动任务允许未标注',
    '四象限任务守恒且比例合计 100',
    '报告只引用当前任务',
    '模型失败一次重试、二次失败可恢复',
    '无跨会话持久化、无敏感正文日志',
    '桌面与移动端无溢出或遮挡',
    '复制报告内容与当前页面一致',
  ];
  expectations.forEach((expectation, index) => {
    assert.match(source, new RegExp(`${index + 1}\\. .*${expectation}`));
  });
  assert.match(source, /tests\/server/);
  assert.match(source, /tests\/frontend\.spec\.js/);
});

test('对抗审查只用测试证据关闭阻断项并保留未验证风险', () => {
  const source = read('docs/adversarial-review.md');
  assert.match(source, /已解决（有测试证据）/);
  assert.match(source, /tests\/frontend\.spec\.js/);
  assert.match(source, /tests\/server\/security\.test\.js/);
  assert.match(source, /tests\/server\/prompt-contract\.test\.js/);
  assert.match(source, /仍未解决/);
  assert.match(source, /日期、工时和容量/);
  assert.match(source, /真实模型/);
});
