const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

function read(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('README documents authenticated SQLite history and operator commands', () => {
  const source = read('README.md');
  assert.match(source, /Node\.js 20/);
  assert.match(source, /\.conda/);
  assert.match(source, /npm\.cmd ci/);
  assert.match(source, /npm\.cmd run migrate/);
  assert.match(source, /npm\.cmd run backup:database/);
  assert.match(source, /MODEL_API_BASE_URL/);
  assert.match(source, /MODEL_API_KEY/);
  assert.match(source, /DATABASE_PATH/);
  assert.match(source, /SESSION_SECRET/);
  assert.match(source, /SESSION_COOKIE_SECURE/);
  assert.match(source, /SESSION_MAX_AGE_MS/);
  for (const endpoint of [
    '/api/auth/register',
    '/api/auth/login',
    '/api/auth/logout',
    '/api/auth/me',
    '/api/auth/password/reset-with-recovery',
    '/api/auth/recovery-code/rotate',
    '/api/time-management/intake/check',
    '/api/time-management/tasks/decompose',
    '/api/time-management/tasks/smart-check',
    '/api/time-management/distribution/diagnose',
    '/api/time-management/matrix/classify',
    '/api/time-management/report/generate',
    '/api/time-management/history',
  ]) {
    assert.match(source, new RegExp(endpoint));
  }
  assert.match(source, /恢复码.*只展示一次/s);
  assert.match(source, /丢失密码和恢复码.*无法.*找回/s);
  assert.match(source, /报告.*自动保存.*历史/s);
  assert.match(source, /草稿.*只存在浏览器内存/s);
  assert.match(source, /不包含.*外部平台集成/s);
  assert.doesNotMatch(source, /不包含账号/);
  assert.doesNotMatch(source, /项目不建立数据库/);
  assert.doesNotMatch(source, /不保存历史记录/);
});

test('.env.example and .gitignore cover local authentication database safety', () => {
  const example = read('.env.example');
  assert.match(example, /^DATABASE_PATH=\.\/data\/time-management\.sqlite$/m);
  assert.match(example, /^SESSION_SECRET=fake-session-secret-change-me-48-bytes-minimum-000000$/m);
  assert.match(example, /^SESSION_COOKIE_SECURE=false$/m);
  assert.match(example, /^SESSION_MAX_AGE_MS=604800000$/m);

  const ignore = read('.gitignore');
  for (const pattern of [
    'data/',
    'backups/',
    '.env.*',
    '!.env.example',
    '!.env.*.example',
    '*.sqlite',
    '*.sqlite-wal',
    '*.sqlite-shm',
    '*.sqlite-journal',
  ]) {
    assert.match(ignore, new RegExp(`^${escapeRegExp(pattern)}$`, 'm'));
  }
});

test('deployment plan requires protected data directories, backup gate, migration and recovery', () => {
  const source = read('docs/agent-plans/部署文档.md');
  for (const expectation of [
    '/var/lib/time/time-management.sqlite',
    '/var/backups/time/time-management-latest.sqlite',
    'DATABASE_PATH',
    'SESSION_SECRET',
    'SESSION_COOKIE_SECURE=false',
    'SESSION_MAX_AGE_MS=604800000',
    'npm run backup:database',
    'npm run migrate',
    'PRAGMA integrity_check',
    '备份失败',
    '停止 time.service',
    '保留故障数据库',
    '注册',
    '登录',
    '历史记录',
  ]) {
    assert.match(source, new RegExp(escapeRegExp(expectation)));
  }
  assert.match(source, /备份失败[^\n]*停止更新/);
  assert.match(source, /HTTP[^\n]*(未加密|明文|传输加密)/);
  assert.match(source, /User=root|root 运行/);
  assert.match(source, /(同盘|单份备份)[^\n]*(无法|不能)/);
  assert.match(source, /固定公网 IP[^\n]*\/32/);
  assert.match(source, /(不得|禁止)[^\n]*0\.0\.0\.0\/0/);
  assert.match(source, /proxy_set_header Host \$http_host;/);
  assert.doesNotMatch(source, /proxy_set_header Host \$host;/);
  assert.doesNotMatch(source, /数据：没有数据库/);
  assert.doesNotMatch(source, /项目无数据库/);
});

test('account authentication and history acceptance document records evidence and accepted risks', () => {
  const source = read('docs/acceptance/account-auth-history-v1.md');
  for (const expectation of [
    '注册',
    '登录',
    '恢复码',
    'CSRF',
    '限流',
    '用户数据隔离',
    '幂等',
    '游标分页',
    '自动保存',
    'tests/server',
    'tests/auth-history.spec.js',
    'HTTP',
    'root',
    '同盘',
    '未部署',
    '假模型',
  ]) {
    assert.match(source, new RegExp(expectation));
  }
});

test('security documentation fixes the log and browser-memory privacy boundary', () => {
  const readme = read('README.md');
  const review = read('docs/adversarial-review.md');
  assert.match(readme, /请求日志只记录 requestId、路径、状态和耗时/);
  assert.match(readme, /不记录用户名、凭据、Cookie、目标或历史正文/);
  assert.match(readme, /五步草稿、任务编辑、完成勾选和本次会话每日记录仍只存在浏览器内存/);
  assert.match(review, /不记录用户名、密码、恢复码、Cookie、Session token、目标正文或历史正文/);
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
  assert.match(source, /已解决（历史与现行测试证据）/);
  assert.match(source, /tests\/reference-five-step\.spec\.js/);
  assert.match(source, /tests\/server\/security\.test\.js/);
  assert.match(source, /tests\/server\/prompt-contract\.test\.js/);
  assert.match(source, /仍未解决/);
  assert.match(source, /日期、工时和容量/);
  assert.match(source, /真实模型/);
  assert.match(source, /账号.*历史.*已解决/s);
  assert.match(source, /tests\/server\/auth-api\.test\.js/);
  assert.match(source, /tests\/server\/history-api\.test\.js/);
  assert.match(source, /tests\/reference-auth-history\.spec\.js/);
  assert.match(source, /HTTP[^\n]*(未加密|明文|传输加密)/);
  assert.match(source, /root/);
  assert.match(source, /同盘.*备份/);
});
