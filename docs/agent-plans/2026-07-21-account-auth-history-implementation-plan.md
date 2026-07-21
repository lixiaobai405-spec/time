# Account Authentication and History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This project must be executed inline without sub-agents, exactly as requested by the project owner.

**Goal:** 为时间管理助手增加用户名密码注册、SQLite 登录会话、恢复码找回和按用户隔离的已完成历史，同时保持现有四步 AI 业务契约不变。

**Architecture:** Express 继续作为单进程 HTTP 边界，通过职责单一的 Database、Repository、Security、Auth、History 模块组合应用；`express-session` 只把签名后的随机 Session ID 放入 `time.sid` Cookie，SQLite 只保存 Session ID、CSRF token、密码和恢复码的哈希。原生前端在启动时恢复登录身份，报告生成后以稳定 `clientRunId` 幂等保存只读快照；所有测试使用临时 SQLite、假用户与假模型。

**Tech Stack:** CommonJS、Node.js 20.20.2、Express 5.2.1、`express-session` 1.19.0、`sqlite3` 6.0.1、`express-rate-limit` 8.6.0、Ajv 8.20.0、原生 JavaScript、Playwright 1.60.0、Node test runner

---

## 0. 执行边界与当前基线

- 本地运行必须显式使用 `D:\codex-pj\time\.conda\node.exe` 和 `.conda\npm.cmd`。每个新的 PowerShell 测试进程先执行 `$projectNodeBin = (Resolve-Path '.conda').Path; $env:PATH = "$projectNodeBin;$env:PATH"`，确保 npm scripts 中的 `node` 仍解析到项目 Node 20，而不是系统 Node。
- 不读取真实 `.env`；测试只注入假 `SESSION_SECRET`、临时数据库和假模型。
- 不修改 `prompts/system.md` 的四步业务语义。
- 不部署、不登录 ECS、不执行 `systemctl`、Nginx、防火墙或阿里云命令、不 push。
- 不使用 `git add .`、`git add -A`、`git clean`、`git reset --hard` 或 `git checkout --`。
- 用户已有且必须保护的未跟踪文件：
  - `docs/acceptance/2026-07-20-deployment-high-density-manual-test.md`
  - `docs/agent-plans/2026-07-21-account-auth-history-design.md`
  - `docs/superpowers/`
  - `tests/manual-test-input-template.md`
- `docs/agent-plans/部署文档.md` 当前也是未跟踪文件，但它被本任务明确列为需要适配的交付物；修改前已记录 SHA-256，修改时只追加/替换账号、数据库、备份、恢复和验收相关内容。
- 当前基线证据：Playwright `37 passed`；服务端 `113 passed / 1 failed`，唯一失败是 `tests/server/start-script.test.js` 中 `spawnSync(cmd.exe)` 的 3 秒硬超时 `ETIMEDOUT`。
- 官方包元数据兼容性：
  - `express-session@1.19.0`：Node `>=0.8.0`，MIT。
  - `sqlite3@6.0.1`：Node `>=20.17.0`，BSD-3-Clause，N-API 3/6。
  - `express-rate-limit@8.6.0`：Node `>=16`，MIT，提供 CommonJS `dist/index.cjs`。

每次提交前统一执行：

```powershell
git status --short
git --no-pager diff
git --no-pager diff --cached
git diff --cached --check
```

只显式暂存当前任务 `Files` 列出的路径；正常提交以触发全局 `pre-commit`，不得使用 `--no-verify`。

---

## Task 1：稳定基线并锁定 Node 20 兼容依赖

**Files:**

- Modify: `tests/server/start-script.test.js`
- Create: `tests/server/dependency-compatibility.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `docs/agent-plans/2026-07-21-account-auth-history-implementation-plan.md`

- [x] **Step 1: 保留现有 RED 证据并增加依赖失败测试**

`tests/server/dependency-compatibility.test.js` 必须验证 Node 版本、CommonJS 入口和 sqlite3 Database API：

```js
const test = require('node:test');
const assert = require('node:assert/strict');

test('认证与 SQLite 依赖支持固定 Node 20 CommonJS 运行时', () => {
  assert.equal(process.versions.node, '20.20.2');
  assert.equal(typeof require('express-session'), 'function');
  assert.equal(typeof require('express-rate-limit').rateLimit, 'function');
  assert.equal(typeof require('sqlite3').Database, 'function');
});
```

- [x] **Step 2: 运行 RED**

```powershell
& '.\.conda\node.exe' --test tests/server/dependency-compatibility.test.js tests/server/start-script.test.js
```

Expected: 依赖测试以 `MODULE_NOT_FOUND` 失败；启动脚本测试可能以当前已复现的 `ETIMEDOUT` 失败。

- [x] **Step 3: 安装精确版本并稳定 Windows 测试时限**

```powershell
& '.\.conda\npm.cmd' install --save-exact express-session@1.19.0 sqlite3@6.0.1 express-rate-limit@8.6.0
```

安装失败、`sqlite3` 无法加载或出现 Node ABI 不兼容时立即停止，不升级 Node、不换数据库、不使用 Docker。把 `start-script.test.js` 的 `spawnSync` 超时从 `3_000` 调整为 `15_000`，其余断言和 `server-started.txt` 到达证明不变。

- [x] **Step 4: 运行 GREEN 和基线回归**

```powershell
& '.\.conda\node.exe' --test tests/server/dependency-compatibility.test.js tests/server/start-script.test.js
& '.\.conda\npm.cmd' run test:server
& '.\.conda\npm.cmd' run test:e2e
```

Expected: 依赖测试、6 项启动脚本测试、全部服务端基线和 37 项 Playwright 基线通过。

- [x] **Step 5: 勾选 Task 1 并提交**

```powershell
git add -- package.json package-lock.json tests/server/dependency-compatibility.test.js tests/server/start-script.test.js docs/agent-plans/2026-07-21-account-auth-history-implementation-plan.md
git diff --cached --check
git commit -m "build: add authentication database dependencies"
```

---

## Task 2：SQLite 连接、PRAGMA 与事务迁移

**Files:**

- Create: `server/database/sqlite.js`
- Create: `server/database/migrations.js`
- Create: `server/database/migrations/001-auth-history.js`
- Create: `tests/helpers/test-database.js`
- Create: `tests/server/database.test.js`
- Modify: `server/config.js`
- Modify: `.env.example`
- Modify: `.gitignore`
- Modify: `tests/server/api.test.js`
- Modify: `tests/server/start-script.test.js`
- Modify: `docs/agent-plans/2026-07-21-account-auth-history-implementation-plan.md`

- [x] **Step 1: 写数据库 RED 测试**

覆盖：文件数据库启用 WAL、外键、5000ms busy timeout；`schema_migrations` 只按版本执行一次；坏 SQL 在事务中回滚且 `openDatabase()` 拒绝启动；`loadConfig()` 接受并校验 `DATABASE_PATH`、48 字节以上 `SESSION_SECRET`、布尔 Cookie 配置和 7 天毫秒数；启动脚本的假 `.env` 包含全部新增变量且不引用真实配置。

核心断言：

```js
assert.equal((await db.get('PRAGMA journal_mode')).journal_mode, 'wal');
assert.equal((await db.get('PRAGMA foreign_keys')).foreign_keys, 1);
assert.equal((await db.get('PRAGMA busy_timeout')).timeout, 5000);
assert.deepEqual(
  (await db.all('SELECT version FROM schema_migrations ORDER BY version')).map(row => row.version),
  [1],
);
```

- [x] **Step 2: 运行 RED**

```powershell
& '.\.conda\node.exe' --test tests/server/database.test.js tests/server/api.test.js tests/server/start-script.test.js
```

Expected: 因 `server/database/sqlite.js` 不存在和配置字段缺失而失败。

- [x] **Step 3: 实现串行数据库适配器和事务迁移**

`server/database/sqlite.js` 导出：

```js
async function openDatabase({ filename, migrations = MIGRATIONS })
```

返回冻结对象：

```js
{ run(sql, params), get(sql, params), all(sql, params), exec(sql), transaction(work), close() }
```

所有公共操作进入同一 Promise 队列；`transaction(work)` 在队列内执行 `BEGIN IMMEDIATE`，向 `work` 传入不再次排队的 transaction client，失败执行 `ROLLBACK` 后原样抛出。打开文件前创建父目录，依次执行：

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

迁移 1 创建 `schema_migrations`、`users`、`sessions`、`time_management_runs` 及设计文档规定的唯一索引、外键和时间索引。迁移失败必须关闭数据库并阻止返回连接。

同一任务更新 `.env.example` 的假 `DATABASE_PATH`、`SESSION_SECRET`、`SESSION_COOKIE_SECURE`、`SESSION_MAX_AGE_MS`，并让 `start-script.test.js` 写入同等假变量。先将 `data/`、`*.sqlite`、`*.sqlite-wal`、`*.sqlite-shm`、`*.sqlite-journal` 加入 `.gitignore`，避免本地验证产生可暂存数据库文件；保留 `.env.example` 可跟踪。

- [x] **Step 4: 运行 GREEN**

```powershell
& '.\.conda\node.exe' --test tests/server/database.test.js tests/server/api.test.js tests/server/start-script.test.js
```

Expected: 全部通过，测试数据库只存在于 `os.tmpdir()` 并由 `t.after()` 关闭删除。

- [x] **Step 5: 提交**

```powershell
git add -- server/database/sqlite.js server/database/migrations.js server/database/migrations/001-auth-history.js server/config.js .env.example .gitignore tests/helpers/test-database.js tests/server/database.test.js tests/server/api.test.js tests/server/start-script.test.js docs/agent-plans/2026-07-21-account-auth-history-implementation-plan.md
git diff --cached --check
git commit -m "feat: add SQLite migrations"
```

---

## Task 3：用户名规范化与用户 Repository

**Files:**

- Create: `server/auth/username.js`
- Create: `server/repositories/user-repository.js`
- Create: `tests/server/user-repository.test.js`
- Modify: `docs/agent-plans/2026-07-21-account-auth-history-implementation-plan.md`

- [x] **Step 1: 写 RED 测试**

覆盖 ASCII 字母/数字/下划线、3–32 字符、trim、大小写唯一性、显示值保留、按 ID 查询和参数化更新凭据。固定接口：

```js
normalizeUsername('  Manager_01  '); // 'manager_01'
validateUsername('Manager_01');
repository.createUser(tx, user);
repository.findByNormalizedUsername('manager_01');
repository.findById(userId);
repository.updateCredentials(tx, { userId, passwordHash, recoveryCodeHash });
```

- [x] **Step 2: 运行 RED**

```powershell
& '.\.conda\node.exe' --test tests/server/user-repository.test.js
```

Expected: 模块不存在。

- [x] **Step 3: 实现最小 Repository**

`validateUsername()` 对非法值抛出 `INPUT_INVALID`；唯一索引冲突转换为 `AUTH_USERNAME_TAKEN`，不把 SQL、路径或参数写入错误消息。所有 SQL 使用 `?` 参数，调用方不得传入或覆盖用户 ID 查询条件。

- [x] **Step 4: 运行 GREEN 并提交**

```powershell
& '.\.conda\node.exe' --test tests/server/user-repository.test.js
git add -- server/auth/username.js server/repositories/user-repository.js tests/server/user-repository.test.js docs/agent-plans/2026-07-21-account-auth-history-implementation-plan.md
git diff --cached --check
git commit -m "feat: add user repository"
```

---

## Task 4：scrypt 密码服务与并发限制

**Files:**

- Create: `server/security/password.js`
- Create: `server/security/semaphore.js`
- Create: `tests/server/password.test.js`
- Modify: `docs/agent-plans/2026-07-21-account-auth-history-implementation-plan.md`

- [x] **Step 1: 写 RED 测试**

覆盖 10–128 Unicode 字符、禁止与用户名大小写不敏感地相同、16 字节 salt、64 字节输出、版本化格式、正确/错误密码、损坏哈希安全返回 false、`crypto.timingSafeEqual()` 路径，以及最多两个并发 scrypt 工作。

预期格式：

```text
scrypt$v=1$N=32768$r=8$p=3$<salt-base64url>$<hash-base64url>
```

- [x] **Step 2: 运行 RED**

```powershell
& '.\.conda\node.exe' --test tests/server/password.test.js
```

- [x] **Step 3: 实现密码服务**

固定参数：

```js
const SCRYPT_OPTIONS = Object.freeze({ N: 32768, r: 8, p: 3, maxmem: 128 * 1024 * 1024 });
const SALT_BYTES = 16;
const KEY_BYTES = 64;
```

导出 `validatePassword(password, normalizedUsername)`、`hashPassword(password)`、`verifyPassword(password, encoded)` 和可注入 `scryptImpl` 的 `createPasswordService({ concurrency: 2 })`。比较只使用相同长度 Buffer 的 `timingSafeEqual()`。

- [x] **Step 4: 运行 GREEN 并提交**

```powershell
& '.\.conda\node.exe' --test tests/server/password.test.js
git add -- server/security/password.js server/security/semaphore.js tests/server/password.test.js docs/agent-plans/2026-07-21-account-auth-history-implementation-plan.md
git diff --cached --check
git commit -m "feat: add scrypt password service"
```

---

## Task 5：恢复码生成、哈希与轮换原语

**Files:**

- Create: `server/security/recovery-code.js`
- Create: `tests/server/recovery-code.test.js`
- Modify: `docs/agent-plans/2026-07-21-account-auth-history-implementation-plan.md`

- [x] **Step 1: 写 RED 测试**

验证每个恢复码来自 24 个随机字节、以 4 字符分组便于复制、数据库只保存 32 字节 SHA-256 的 base64url、分隔符规范化、错误码失败、轮换后旧码不再匹配且版本递增。

- [x] **Step 2: 运行 RED**

```powershell
& '.\.conda\node.exe' --test tests/server/recovery-code.test.js
```

- [x] **Step 3: 实现固定接口**

```js
generateRecoveryCode();
normalizeRecoveryCode(value);
hashRecoveryCode(value);
verifyRecoveryCode(value, storedHash);
```

明文只作为注册、重置或轮换成功响应的局部值存在，不进入 Repository、日志和错误对象。

- [x] **Step 4: 运行 GREEN 并提交**

```powershell
& '.\.conda\node.exe' --test tests/server/recovery-code.test.js
git add -- server/security/recovery-code.js tests/server/recovery-code.test.js docs/agent-plans/2026-07-21-account-auth-history-implementation-plan.md
git diff --cached --check
git commit -m "feat: add recovery code primitives"
```

---

## Task 6：SQLite Session Repository 与 express-session Store

**Files:**

- Create: `server/repositories/session-repository.js`
- Create: `server/session/sqlite-session-store.js`
- Create: `server/security/token-hash.js`
- Create: `tests/server/session-store.test.js`
- Modify: `docs/agent-plans/2026-07-21-account-auth-history-implementation-plan.md`

- [x] **Step 1: 写 RED 测试**

覆盖：Session ID 为 32 字节安全随机 base64url；数据库仅存在 SHA-256 `token_hash`；Store 的 `set/get/touch/destroy`；7 天到期；过期读取即删除；正常注销只删当前 Session；`destroyAllForUser(tx,userId)` 删除全部；用户 A 的注销不影响用户 B。

数据库断言必须证明原始 sid 不出现在任何列：

```js
const row = await db.get('SELECT token_hash, csrf_token_hash FROM sessions WHERE user_id = ?', [userId]);
assert.notEqual(row.token_hash, rawSessionId);
assert.equal(row.token_hash, hashToken(rawSessionId));
```

- [x] **Step 2: 运行 RED**

```powershell
& '.\.conda\node.exe' --test tests/server/session-store.test.js
```

- [x] **Step 3: 实现 Repository 和 Store**

Store 继承 `express-session.Store`，只实现所需的 `get`、`set`、`touch`、`destroy`。`get` 只重建 `{ userId, cookie }`，不把数据库哈希发给浏览器；`touch` 只更新 `last_seen_at`，不突破登录时确定的 `expires_at`。Repository 额外导出 `setCsrfHash`、`findByToken`、`destroyCurrent`、`destroyAllForUser`、`pruneExpired`。

- [x] **Step 4: 运行 GREEN 并提交**

```powershell
& '.\.conda\node.exe' --test tests/server/session-store.test.js
git add -- server/repositories/session-repository.js server/session/sqlite-session-store.js server/security/token-hash.js tests/server/session-store.test.js docs/agent-plans/2026-07-21-account-auth-history-implementation-plan.md
git diff --cached --check
git commit -m "feat: add SQLite session store"
```

---

## Task 7：Origin、CSRF 与认证限流边界

**Files:**

- Create: `server/security/csrf.js`
- Create: `server/security/origin.js`
- Create: `server/auth/rate-limiters.js`
- Create: `tests/server/auth-security.test.js`
- Modify: `docs/agent-plans/2026-07-21-account-auth-history-implementation-plan.md`

- [x] **Step 1: 写 RED 测试**

测试公开预登录 CSRF token 的 HMAC、10 分钟到期和篡改拒绝；登录后 CSRF token 由 HMAC(`SESSION_SECRET`, `csrf:<sid>`) 派生，数据库只保存 SHA-256；缺少/错误 `Origin`、Host 或 `X-CSRF-Token` 返回 `AUTH_CSRF_INVALID`；限流键同时包含 `ipKeyGenerator(req.ip)` 与规范化用户名；注册、登录、重置分别触发 429。

- [x] **Step 2: 运行 RED**

```powershell
& '.\.conda\node.exe' --test tests/server/auth-security.test.js
```

- [x] **Step 3: 实现边界**

增加辅助端点所需的 `createPreAuthCsrfToken()` 与 `verifyPreAuthCsrfToken()`；该 token 不含用户名，不写数据库。实现 `requireSameOrigin`、`requirePreAuthCsrf`、`requireSessionCsrf`。限流固定为 15 分钟窗口：注册 5 次、登录 10 次、恢复密码 5 次；handler 统一产生 `AUTH_RATE_LIMITED`。

- [x] **Step 4: 运行 GREEN 并提交**

```powershell
& '.\.conda\node.exe' --test tests/server/auth-security.test.js
git add -- server/security/csrf.js server/security/origin.js server/auth/rate-limiters.js tests/server/auth-security.test.js docs/agent-plans/2026-07-21-account-auth-history-implementation-plan.md
git diff --cached --check
git commit -m "feat: enforce auth CSRF and rate limits"
```

---

## Task 8：注册、登录、退出与当前用户 API

**Files:**

- Create: `server/auth/auth-service.js`
- Create: `server/auth/router.js`
- Create: `server/auth/middleware.js`
- Create: `server/runtime.js`
- Create: `tests/helpers/auth-client.js`
- Create: `tests/helpers/test-app.js`
- Create: `tests/helpers/test-auth-boundary.js`
- Create: `tests/server/auth-api.test.js`
- Modify: `playwright.config.js`
- Modify: `server/app.js`
- Modify: `server/index.js`
- Modify: `tests/server/api.test.js`
- Modify: `tests/server/security.test.js`
- Modify: `tests/server/check-goals.test.js`
- Modify: `tests/server/classify-matrix.test.js`
- Modify: `tests/server/extract-tasks.test.js`
- Modify: `tests/server/generate-report.test.js`
- Modify: `tests/server/start-script.test.js`
- Modify: `docs/agent-plans/2026-07-21-account-auth-history-implementation-plan.md`

- [x] **Step 1: 写 API RED**

覆盖：

```text
GET  /api/auth/csrf
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
```

断言注册只返回一次恢复码、不自动登录；重复用户名 409；未知用户和错误密码统一 `AUTH_INVALID_CREDENTIALS`；登录响应设置 `time.sid` 且登录前 sid 不被复用；Cookie 为 HttpOnly、SameSite=Strict、Path=/、Max-Age=604800、Secure=false；`me` 返回 `{user:{id,username},csrfToken}`；退出只销毁当前 Session。

- [x] **Step 2: 运行 RED**

```powershell
& '.\.conda\node.exe' --test tests/server/auth-api.test.js tests/server/api.test.js tests/server/security.test.js
```

- [x] **Step 3: 实现 Auth Service、Router 和运行时组合**

`createRuntime(config)` 打开数据库、运行迁移、创建 Repository/Service/Store 和 `express-session` middleware。固定 Session 配置：

```js
{
  name: 'time.sid',
  secret: config.sessionSecret,
  genid: () => randomBytes(32).toString('base64url'),
  resave: false,
  saveUninitialized: false,
  rolling: false,
  cookie: { httpOnly: true, secure: false, sameSite: 'strict', path: '/', maxAge: 604800000 },
}
```

`createApp()` 必须显式接收完整 `authBoundary`，缺失时抛出配置错误而不是默认为公开业务 API。`GET /api/health` 保持在认证 middleware 之前。登录使用 `req.session.regenerate()`，设置 `userId` 后显式保存。

- [x] **Step 4: 运行 GREEN 和安全回归**

```powershell
& '.\.conda\node.exe' --test tests/server/auth-api.test.js tests/server/api.test.js tests/server/security.test.js
```

- [x] **Step 5: 提交**

```powershell
git add -- playwright.config.js server/auth/auth-service.js server/auth/router.js server/auth/middleware.js server/runtime.js server/app.js server/index.js tests/helpers/auth-client.js tests/helpers/test-app.js tests/helpers/test-auth-boundary.js tests/server/auth-api.test.js tests/server/api.test.js tests/server/check-goals.test.js tests/server/classify-matrix.test.js tests/server/extract-tasks.test.js tests/server/generate-report.test.js tests/server/security.test.js tests/server/start-script.test.js docs/agent-plans/2026-07-21-account-auth-history-implementation-plan.md
git diff --cached --check
git commit -m "feat: add account authentication APIs"
```

---

## Task 9：恢复码重置密码与恢复码轮换

**Files:**

- Modify: `server/auth/auth-service.js`
- Modify: `server/auth/router.js`
- Modify: `server/repositories/user-repository.js`
- Modify: `server/runtime.js`
- Create: `tests/server/recovery-api.test.js`
- Modify: `docs/agent-plans/2026-07-21-account-auth-history-implementation-plan.md`

- [x] **Step 1: 写 RED 测试**

覆盖：

```text
POST /api/auth/password/reset-with-recovery
POST /api/auth/recovery-code/rotate
```

重置成功必须在同一事务中更新密码哈希、轮换恢复码和版本、删除该用户全部 Session；旧密码、旧恢复码和两个旧 Session 均失效；账号和历史行保持；数据库中途失败时全部回滚。轮换接口要求登录、CSRF 和当前密码，只返回一次新恢复码，不撤销其他有效 Session。

- [x] **Step 2: 运行 RED**

```powershell
& '.\.conda\node.exe' --test tests/server/recovery-api.test.js tests/server/auth-api.test.js
```

- [x] **Step 3: 实现事务服务**

固定服务接口：

```js
authService.resetWithRecovery({ username, recoveryCode, newPassword });
authService.rotateRecoveryCode({ userId, password });
```

用户名不存在、恢复码错误、登录密码错误均使用通用 `AUTH_INVALID_CREDENTIALS` 文案，不返回用户名存在性。事务提交后才把新明文恢复码返回 Router。

- [x] **Step 4: 运行 GREEN 并提交**

```powershell
& '.\.conda\node.exe' --test tests/server/recovery-api.test.js tests/server/auth-api.test.js
git add -- server/auth/auth-service.js server/auth/router.js server/repositories/user-repository.js server/runtime.js tests/server/recovery-api.test.js docs/agent-plans/2026-07-21-account-auth-history-implementation-plan.md
git diff --cached --check
git commit -m "feat: add recovery password reset"
```

---

## Task 10：保护现有四步 API 并保持业务契约

**Files:**

- Modify: `server/app.js`
- Modify: `server/runtime.js`
- Modify: `tests/helpers/test-auth-boundary.js`
- Create: `tests/server/workflow-auth.test.js`
- Modify: `docs/agent-plans/2026-07-21-account-auth-history-implementation-plan.md`

- [x] **Step 1: 写保护 RED**

未登录调用四条业务 API 均返回 401 `AUTH_REQUIRED`，没有模型调用；已登录但缺少/错误 CSRF 返回 403；有效 Session、同源 Origin 和 CSRF 时原请求/响应不增删字段。`GET /api/health` 始终公开。

- [x] **Step 2: 运行 RED**

```powershell
& '.\.conda\node.exe' --test tests/server/workflow-auth.test.js
```

- [x] **Step 3: 在路由层统一加认证和 CSRF**

路由顺序固定为：安全头/日志 → JSON → Session → 公开 health/auth → `/api/time-management` 的 `requireAuth` 和 unsafe-method CSRF → 历史及四步路由 → API 404 → 静态前端 → problem handler。旧工作流单元测试使用显式 `createTestAuthBoundary()`，生产代码不存在绕过开关。

- [x] **Step 4: 运行 GREEN 和全部既有工作流测试**

```powershell
& '.\.conda\node.exe' --test tests/server/workflow-auth.test.js tests/server/check-goals.test.js tests/server/classify-matrix.test.js tests/server/extract-tasks.test.js tests/server/generate-report.test.js tests/server/security.test.js
```

- [x] **Step 5: 提交**

```powershell
git add -- server/app.js server/runtime.js tests/helpers/test-auth-boundary.js tests/server/workflow-auth.test.js docs/agent-plans/2026-07-21-account-auth-history-implementation-plan.md
git diff --cached --check
git commit -m "feat: protect time management APIs"
```

---

## Task 11：历史快照契约与 user_id 强制 Repository

**Files:**

- Create: `server/history/contracts.js`
- Create: `server/history/cursor.js`
- Create: `server/repositories/history-repository.js`
- Create: `tests/helpers/history-fixture.js`
- Create: `tests/server/history-repository.test.js`
- Create: `tests/server/history-contracts.test.js`
- Modify: `docs/agent-plans/2026-07-21-account-auth-history-implementation-plan.md`

- [x] **Step 1: 写 RED 测试**

覆盖完整 `{clientRunId,title,goals,tasks,matrix,report}` Schema；稳定 UUID；任务守恒；只有“高”映射象限；55/25/15/5；报告只引用当前任务且无 UUID/8 位前缀泄漏；未知 schema version 拒绝。Repository 测试证明所有保存、列表、详情、删除都强制接收服务端 `userId`，A 不能读取/删除 B。

- [x] **Step 2: 运行 RED**

```powershell
& '.\.conda\node.exe' --test tests/server/history-contracts.test.js tests/server/history-repository.test.js
```

- [x] **Step 3: 实现快照验证、游标和 Repository**

保存使用唯一 `(user_id, client_run_id)`，重复 clientRunId 返回原记录且不覆盖正文。列表 SQL：

```sql
SELECT id, title, created_at, updated_at
FROM time_management_runs
WHERE user_id = ?
  AND (created_at < ? OR (created_at = ? AND id < ?))
ORDER BY created_at DESC, id DESC
LIMIT ?
```

无 cursor 时省略游标条件，读取 `limit + 1` 生成 base64url JSON `{createdAt,id}` 游标；默认 20，最大 50。详情 JSON 解析或 schema version 异常转换为稳定安全错误，不返回部分正文。

- [x] **Step 4: 运行 GREEN 并提交**

```powershell
& '.\.conda\node.exe' --test tests/server/history-contracts.test.js tests/server/history-repository.test.js
git add -- server/history/contracts.js server/history/cursor.js server/repositories/history-repository.js tests/helpers/history-fixture.js tests/server/history-contracts.test.js tests/server/history-repository.test.js docs/agent-plans/2026-07-21-account-auth-history-implementation-plan.md
git diff --cached --check
git commit -m "feat: add isolated history repository"
```

---

## Task 12：历史保存、列表、详情和删除 API

**Files:**

- Create: `server/history/router.js`
- Modify: `server/runtime.js`
- Modify: `server/app.js`
- Create: `tests/server/history-api.test.js`
- Modify: `tests/server/security.test.js`
- Modify: `docs/agent-plans/2026-07-21-account-auth-history-implementation-plan.md`

- [x] **Step 1: 写 API RED**

覆盖：

```text
POST   /api/time-management/history
GET    /api/time-management/history?cursor=&limit=
GET    /api/time-management/history/:id
DELETE /api/time-management/history/:id
```

断言保存首次 201、同一 clientRunId 重试 200 且 ID 相同；列表默认 20、最大 50、游标无重复；详情只读；A 对 B 和不存在 ID 均得到相同 404 `HISTORY_NOT_FOUND`；删除需要 CSRF；请求体中的 `user_id`/`userId` 被 Schema 拒绝；数据库错误不泄漏 SQL、路径、正文或参数。

- [x] **Step 2: 运行 RED**

```powershell
& '.\.conda\node.exe' --test tests/server/history-api.test.js tests/server/security.test.js
```

- [x] **Step 3: 实现 Router**

Router 只从 `request.auth.userId` 取用户 ID，所有输入先经过 Ajv 和语义验证。统一错误：`HISTORY_NOT_FOUND` 404、`HISTORY_SAVE_FAILED` 500、`DATABASE_UNAVAILABLE` 503；problem handler 不返回原始 SQLite error。

- [x] **Step 4: 运行 GREEN 并提交**

```powershell
& '.\.conda\node.exe' --test tests/server/history-api.test.js tests/server/security.test.js
git add -- server/history/router.js server/runtime.js server/app.js tests/server/history-api.test.js tests/server/security.test.js docs/agent-plans/2026-07-21-account-auth-history-implementation-plan.md
git diff --cached --check
git commit -m "feat: add history APIs"
```

---

## Task 13：前端身份恢复、注册登录与恢复码页面

**Files:**

- Modify: `frontend/api.js`
- Modify: `frontend/state.js`
- Modify: `frontend/app.js`
- Modify: `frontend/index.html`
- Create: `frontend/auth-ui.js`
- Create: `tests/auth-history.spec.js`
- Modify: `playwright.config.js`
- Modify: `tests/frontend.spec.js`
- Modify: `docs/agent-plans/2026-07-21-account-auth-history-implementation-plan.md`

- [x] **Step 1: 写 Playwright RED**

新增测试：未登录显示登录页且不能进入工作区；注册验证确认密码；注册成功只显示一次恢复码并要求“已保存”；登录后刷新通过 `/api/auth/me` 恢复身份但不恢复草稿；退出回登录页；密码和恢复码不进入 URL、localStorage、sessionStorage 或 DOM 隐藏字段。

- [x] **Step 2: 运行 RED**

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH='0'
& '.\.conda\npx.cmd' playwright test tests/auth-history.spec.js --grep "注册|登录|刷新|退出"
```

- [x] **Step 3: 实现前端认证状态与页面**

`frontend/api.js` 增加 `getJson`、`deleteJson`、`setCsrfToken`；所有 unsafe 请求自动带当前 `X-CSRF-Token`，不保存 Cookie/token。`state.js` 增加：

```js
authReady: false,
user: null,
csrfToken: null,
screen: 'boot',
recoveryCode: null,
```

`auth-ui.js` 导出登录、注册、找回、一次性恢复码页面的纯渲染函数；所有错误使用 `textContent`。应用启动先调用 `/api/auth/me`，401 时获取 `/api/auth/csrf` 后显示登录页。登录后再次调用 `/api/auth/me` 获取 Session CSRF token。

`playwright.config.js` 为测试服务器显式注入假 `SESSION_SECRET`、`SESSION_COOKIE_SECURE=false`、7 天有效期和位于测试临时目录的 `DATABASE_PATH`；测试前后删除该临时数据库及 WAL/SHM，不读取项目 `.env`。

- [x] **Step 4: 运行 GREEN 与旧前端回归**

```powershell
& '.\.conda\npx.cmd' playwright test tests/auth-history.spec.js --grep "注册|登录|刷新|退出"
& '.\.conda\npm.cmd' run test:e2e
```

Expected: 新认证流程通过；旧 37 项通过显式认证 mock，不被默认绕过。

- [x] **Step 5: 提交**

```powershell
git add -- frontend/api.js frontend/state.js frontend/app.js frontend/index.html frontend/auth-ui.js tests/auth-history.spec.js tests/frontend.spec.js playwright.config.js docs/agent-plans/2026-07-21-account-auth-history-implementation-plan.md
git diff --cached --check
git commit -m "feat: add account authentication UI"
```

---

## Task 14：前端自动保存、历史列表、详情、删除和恢复流程

**Files:**

- Create: `frontend/history-ui.js`
- Modify: `frontend/app.js`
- Modify: `frontend/state.js`
- Modify: `frontend/index.html`
- Modify: `tests/auth-history.spec.js`
- Modify: `tests/frontend.spec.js`
- Modify: `docs/agent-plans/2026-07-21-account-auth-history-implementation-plan.md`

- [x] **Step 1: 写 Playwright RED**

覆盖：注册→保存恢复码→登录→四步→报告立即显示→自动保存历史→列表→详情；保存失败时报告保留并显示重试；同一 `clientRunId` 重试不重复；两个 browser context 用户隔离；删除二次确认；恢复码重置后旧 Session 失效、新恢复码只显示一次、新密码登录且原历史保留；历史详情/复制不显示任务 UUID 或 8 位前缀。

- [x] **Step 2: 运行 RED**

```powershell
& '.\.conda\npx.cmd' playwright test tests/auth-history.spec.js
```

- [x] **Step 3: 实现历史状态与 UI**

每次 `resetState()` 生成新的 `clientRunId=crypto.randomUUID()`；报告校验并写入 `state.report` 后立即渲染，再异步 POST 历史。保存状态固定为：

```js
historySave: { status: 'idle|saving|saved|failed', id: null, message: '' },
historyItems: [],
historyCursor: null,
historyDetail: null,
```

历史详情用当前安全 Markdown renderer 渲染报告，目标/任务字段用 `textContent`；删除按钮先调用 `window.confirm()`，确认后 DELETE。恢复密码成功清空本地用户与 CSRF，展示新恢复码，确认保存后回登录页。

- [x] **Step 4: 运行 GREEN 和完整 Playwright**

```powershell
& '.\.conda\npx.cmd' playwright test tests/auth-history.spec.js
& '.\.conda\npm.cmd' run test:e2e
```

- [x] **Step 5: 提交**

```powershell
git add -- frontend/history-ui.js frontend/app.js frontend/state.js frontend/index.html tests/auth-history.spec.js tests/frontend.spec.js docs/agent-plans/2026-07-21-account-auth-history-implementation-plan.md
git diff --cached --check
git commit -m "feat: add history user interface"
```

---

## Task 15：一致性备份脚本、忽略规则与部署文档适配

**Files:**

- Create: `scripts/migrate.js`
- Create: `scripts/backup-database.js`
- Create: `tests/server/operations.test.js`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `.gitignore`
- Modify: `README.md`
- Modify: `docs/agent-plans/部署文档.md`
- Create: `docs/acceptance/account-auth-history-v1.md`
- Modify: `docs/adversarial-review.md`
- Modify: `tests/server/delivery-docs.test.js`
- Modify: `tests/server/start-script.test.js`
- Modify: `docs/agent-plans/2026-07-21-account-auth-history-implementation-plan.md`

- [x] **Step 1: 写运维与文档 RED**

测试 migration CLI 对失败返回非零；backup 使用 sqlite3 Backup API 创建同目录临时文件、执行 `PRAGMA integrity_check`，成功后原子替换唯一备份，失败不覆盖旧备份；`.gitignore` 覆盖 `data/`、`backups/`、`.sqlite`、WAL、SHM、journal、`.env.*` 并保留 `.env.example`；文档包含新接口、目录、环境变量、备份阻断、恢复和已接受风险。

- [x] **Step 2: 运行 RED**

```powershell
& '.\.conda\node.exe' --test tests/server/operations.test.js tests/server/delivery-docs.test.js tests/server/start-script.test.js
```

- [x] **Step 3: 实现脚本与配置文档**

增加 npm scripts：

```json
"migrate": "node scripts/migrate.js",
"backup:database": "node scripts/backup-database.js"
```

`.env.example` 只使用假值：

```env
DATABASE_PATH=./data/time-management.sqlite
SESSION_SECRET=fake-session-secret-change-me-48-bytes-minimum-000000
SESSION_COOKIE_SECURE=false
SESSION_MAX_AGE_MS=604800000
```

部署文档必须把 `/var/lib/time`、`/var/backups/time` 权限、首次迁移、更新前一致性备份、失败停止、恢复步骤、登录/历史验收写入现有 Task 结构；明确 HTTP、root、同盘单份备份风险仍由用户接受，绝不描述为已消除；安全组仍固定 `/32`，不出现 `0.0.0.0/0` 建议。

- [x] **Step 4: 运行 GREEN 和文档检查**

```powershell
& '.\.conda\node.exe' --test tests/server/operations.test.js tests/server/delivery-docs.test.js tests/server/start-script.test.js
git diff --check
```

- [x] **Step 5: 提交**

```powershell
git add -- scripts/migrate.js scripts/backup-database.js tests/server/operations.test.js package.json .env.example .gitignore README.md docs/agent-plans/部署文档.md docs/acceptance/account-auth-history-v1.md docs/adversarial-review.md tests/server/delivery-docs.test.js tests/server/start-script.test.js docs/agent-plans/2026-07-21-account-auth-history-implementation-plan.md
git diff --cached --check
git commit -m "docs: add authenticated SQLite operations"
```

---

## Task 16：完整安全回归、泄漏审计与完成状态

**Files:**

- Modify: `tests/server/security.test.js`
- Modify: `tests/server/delivery-docs.test.js`
- Modify: `tests/auth-history.spec.js`
- Modify: `docs/agent-plans/2026-07-21-account-auth-history-implementation-plan.md`

- [x] **Step 1: 补齐最终 RED 安全断言**

扫描服务端日志记录对象和前端存储；注入带标记的用户名、密码、恢复码、Cookie、Session token、目标正文、历史正文和 SQL 错误，断言响应与日志均无标记。直接查询临时 SQLite，断言密码、恢复码和 raw sid 不存在，历史只能由所属 user_id 查询。

- [x] **Step 2: 运行新增断言并保留 RED 证据**

```powershell
& '.\.conda\node.exe' --test tests/server/security.test.js tests/server/delivery-docs.test.js
& '.\.conda\npx.cmd' playwright test tests/auth-history.spec.js
```

Expected: 如果已有实现完全满足断言则直接通过；若任一断言失败，记录失败测试名称和不含敏感值的差异，先做最小安全修复。允许修复的范围仅限 `server/app.js`、`server/auth/`、`server/history/`、`server/repositories/`、`server/security/`、`frontend/` 与对应测试，不增加新功能或依赖。

- [x] **Step 3: 运行定向 GREEN**

```powershell
& '.\.conda\node.exe' --test tests/server/password.test.js tests/server/recovery-code.test.js tests/server/session-store.test.js tests/server/auth-security.test.js tests/server/auth-api.test.js tests/server/recovery-api.test.js tests/server/workflow-auth.test.js tests/server/history-contracts.test.js tests/server/history-repository.test.js tests/server/history-api.test.js tests/server/operations.test.js tests/server/security.test.js
& '.\.conda\npx.cmd' playwright test tests/auth-history.spec.js
```

- [x] **Step 4: 运行所有正式验证**

```powershell
& '.\.conda\npm.cmd' run test:server
& '.\.conda\npm.cmd' run test:e2e
& '.\.conda\npm.cmd' test
git diff --check
git diff --cached --check
git config --get core.hooksPath
git status --short --branch
git log --oneline --decorate -20
```

Expected: 所有 Node/API、Playwright 和完整 npm 测试通过；全局 Git hook 在正常提交中通过；无 `.sqlite`、`-wal`、`-shm`、备份、缓存、日志或真实 secret 出现在状态/提交。

- [x] **Step 5: 核对用户文件保护哈希**

除明确要求修改的 `docs/agent-plans/部署文档.md` 外，重新计算以下文件 SHA-256 并与 Task 0 基线一致：设计文档、高密度部署人工测试、`docs/superpowers/` 两个文件、`tests/manual-test-input-template.md`。

- [x] **Step 6: 勾选全部计划并提交最终测试证据**

```powershell
git add -- tests/server/security.test.js tests/server/delivery-docs.test.js tests/auth-history.spec.js docs/agent-plans/2026-07-21-account-auth-history-implementation-plan.md
git diff --cached --check
git commit -m "test: verify authenticated history workflow"
```

若 Step 2 产生最小实现修复，提交前根据 `git status --short` 将实际改动的实现文件逐个写出完整相对路径追加暂存；禁止暂存整个目录、使用通配符或扩大到未改动文件。

- [x] **Step 7: 最终审计**

```powershell
git diff --check
git diff --cached --check
git status --short --branch
git log --oneline --decorate -20
```

不部署、不 push、不调用真实模型。最终汇报逐项列出功能、文件、依赖、数据库/API、RED/GREEN、完整测试、Hooks、风险、Git 状态和英文提交记录。

---

## Self-review

- [x] **Spec coverage:** Task 2–12 覆盖 SQLite/migrations、用户、scrypt、恢复码、Session、CSRF、限流、六个正式认证接口及一个预登录 CSRF 辅助接口、四步登录保护、四个历史接口、幂等/分页/隔离；Task 13–14 覆盖全部前端和 Playwright 流程；Task 15 覆盖 README、环境、忽略、备份、迁移、恢复和部署风险；Task 16 覆盖最终安全与回归。
- [x] **Interface consistency:** `userId` 只由 `request.auth.userId` 产生；数据库列统一为 snake_case，JavaScript 对象统一为 camelCase；Session Cookie 始终为 `time.sid`；历史请求始终使用 `clientRunId`，数据库始终使用 `client_run_id`。
- [x] **Security consistency:** 密码=scrypt；恢复码/Session/CSRF=SHA-256 或 HMAC 后再持久化；所有 unsafe 认证/业务/历史请求同时校验同源与 CSRF；测试和日志禁止真实正文与凭据。
- [x] **Scope consistency:** CommonJS、SQLite、Node 20.20.2、HTTP 8011→4174、root systemd、固定 IP `/32`、无 Docker/HTTPS/外部认证/邮箱/管理员/草稿恢复；不改 Prompt 业务契约。
- [x] **Placeholder scan:** 已扫描常见的未完成占位语句，未发现命中；计划中的文件、接口、命令、错误码、版本、Cookie 属性、SQL 排序、测试入口和提交信息均已明确。
