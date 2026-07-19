# 时间管理助手 v1 · 甲方验收清单

验收日期：2026-07-19

验收范围：会话内时间管理助手，不含部署、真实付费模型调用和范围外平台集成。

测试数据：全部为虚构数据，自动化使用假模型。

## 验收项

1. **四栏输入与 PDCA/SMART 检查**
   - 结果：已通过自动化验证。
   - 证据：`tests/server/check-goals.test.js`、`tests/server/prompt-contract.test.js`。

2. **未通过检查不能进入下一步**
   - 结果：`overall=need_fix` 时停留在目标页；修改或采纳建议后必须重新检查。
   - 证据：`tests/frontend.spec.js` 中“overall=need_fix 时阻止提取”和“目标修改后必须重新检查”。

3. **用户输入真实生成任务**
   - 结果：提取请求体包含用户当前四栏内容，任务列表只使用 API 响应。
   - 证据：`tests/frontend.spec.js` 中“四个 API 请求使用用户当前输入”和“用户输入会真实贯穿任务、矩阵和报告”。

4. **手动新增/删除后下游重新计算**
   - 结果：任何增删都会清除旧矩阵与报告，旧步骤结果不能直接复用。
   - 证据：`tests/frontend.spec.js` 中“新增或删除任务后必须重新判定矩阵”。

5. **手动任务允许未标注，矩阵判定时由 AI 补齐并显示“AI 判定”**
   - 结果：未标注任务保存为 `null/null` 和 `unclassified`，判定后成为 `ai-matrix`。
   - 证据：`tests/server/contracts.test.js`、`tests/server/classify-matrix.test.js`、`tests/frontend.spec.js`。

6. **四象限任务守恒且比例合计 100**
   - 结果：每个 taskId 恰好出现一次；比例固定 55/25/15/5。
   - 证据：`tests/server/classify-matrix.test.js`、`tests/server/prompt-contract.test.js`。

7. **报告只引用当前任务**
   - 结果：未知、已删除或重复 taskId 会触发重试/重新生成，不渲染混合旧数据。
   - 证据：`tests/server/generate-report.test.js`、`tests/frontend.spec.js`。

8. **模型失败一次重试、二次失败可恢复**
   - 结果：只对模型格式/语义错误自动重试一次；超时、上游失败和二次失败返回稳定错误，当前步骤可重试。
   - 证据：`tests/server/model-client.test.js` 及四个工作流测试、`tests/frontend.spec.js` 错误恢复用例。

9. **无跨会话持久化、无敏感正文日志**
   - 结果：状态只存在当前浏览器内存；日志仅含 requestId、路径、状态和耗时。
   - 证据：`tests/server/security.test.js`、`tests/frontend.spec.js` 的重新梳理与隐私提示用例。

10. **桌面与移动端无溢出或遮挡**
    - 结果：Playwright 窄屏回归已通过；Task 12 人工桌面/窄屏主流程结果在下方记录。
    - 证据：`tests/frontend.spec.js` 中窄屏代码块、报告和矩阵方向用例。

11. **复制报告内容与当前页面一致**
    - 结果：复制来源为当前报告状态渲染出的页面正文，不使用固定模板。
    - 证据：`tests/frontend.spec.js` 中“复制报告会把当前报告正文写入剪贴板”。

## 最终验证记录

- `npm.cmd test`：通过，Node/API 71 项、Playwright 31 项，全部使用假模型。
- `git diff --check`：通过，无空白错误。
- 全局 Git pre-commit hook：通过。
- 桌面主流程：通过，1280×800；验证加载禁用、错误重试、任务增删、矩阵、Markdown 和复制。
- 窄屏主流程：通过，375×812；页面无横向溢出，新步骤标题回到可视区，成功重试后无旧错误提示遮挡。

## 已知范围与风险

- 未调用真实模型；自然语言质量需按 `tests/prompt-cases.md` 做人工/模型评测。
- 未实现日期、时区、工作日历、分钟容量或自动排期。
- 未实现账号、数据库、历史记录、跨会话记忆、外部平台集成或部署。
- 生产供应商隐私治理、账号权限、完整无障碍和压力测试仍待后续评审。
