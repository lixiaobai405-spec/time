# 时间管理助手账号与历史 v1 验收清单

验收日期：2026-07-21

验收范围：用户名密码认证、恢复码、SQLite Session、已完成历史和运维脚本。全部自动化使用假用户、临时 SQLite 和假模型。

## 验收项

1. **注册、登录、退出和当前用户**
   - 重复用户名被拒绝；登录成功换发 Session；退出只撤销当前 Session。
   - 证据：`tests/server/auth-api.test.js`、`tests/auth-history.spec.js`。

2. **密码与恢复码**
   - 密码使用异步 scrypt；恢复码只展示一次并仅以哈希落库。重置后旧密码、旧恢复码和全部旧 Session 失效，账号和历史保留。
   - 证据：`tests/server/password.test.js`、`tests/server/recovery-code.test.js`、`tests/server/recovery-api.test.js`。

3. **CSRF、同源校验与限流**
   - 改变状态的认证和业务请求验证 Origin、Host 和 CSRF token；注册、登录和找回密码分别限流。
   - 证据：`tests/server/auth-security.test.js`、`tests/server/workflow-auth.test.js`。

4. **用户数据隔离**
   - `user_id` 只来自服务端 Session。用户 A 无法查看或删除用户 B 的历史，跨用户与不存在记录统一为 404。
   - 证据：`tests/server/history-repository.test.js`、`tests/server/history-api.test.js`、`tests/auth-history.spec.js`。

5. **幂等保存与游标分页**
   - `(user_id, client_run_id)` 保证重试不重复；列表默认 20 条、最大 50 条，按游标翻页不重复。
   - 证据：`tests/server/history-repository.test.js`、`tests/server/history-api.test.js`。

6. **报告自动保存与只读历史**
   - 报告先显示再异步保存；失败保留报告且可使用同一 `clientRunId` 重试。详情不可编辑或继续执行，删除需二次确认。
   - 证据：`tests/auth-history.spec.js`。

7. **原有业务契约不回退**
   - `overall=need_fix` 阻断、稳定任务 ID、“待确认”、只有“高”映射、55/25/15/5、已完成事实不生成待办和 UUID 防泄漏保持不变。
   - 证据：`tests/server`、`tests/frontend.spec.js`、`tests/auth-history.spec.js`。

8. **SQLite 迁移与备份**
   - migration 按版本在事务中执行，失败阻止启动；备份使用 SQLite Backup API，通过完整性检查后原子替换唯一备份，失败保留原备份。
   - 证据：`tests/server/database.test.js`、`tests/server/operations.test.js`。

## 已接受风险

- HTTP 没有传输加密，固定 IP `/32` 白名单不能替代 HTTPS。
- systemd 继续使用 `User=root`，应用或依赖漏洞的权限影响会被放大。
- 同盘只保留一份最新备份，不能防止整盘故障、实例丢失或入侵者同时删除。

## 执行边界

- 本轮未部署、未登录 ECS、未修改 systemd/Nginx/防火墙/安全组。
- 未调用真实或付费模型；所有自动化均使用假模型和虚构数据。
