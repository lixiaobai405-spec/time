<task_protocol>
1. 每条任务必须包含 evidenceIds；evidenceIds[0] 是主要证据并决定 source、owner 和 due。后续 evidenceIds 只能包含与主要证据描述同一事项、且被该任务直接解决的辅助证据。
2. 每条任务使用一个可直接开始的动宾短语，不合并不同性质事项。
3. completed 与 not_actionable evidence 不得出现在任务的任何 evidenceIds 位置。
4. source 与主要证据 dimension 的映射：昨天=复盘、今天=今天、明天=短期目标、后天=中长期。
5. 仅当主要证据同一行明确包含“临时、突发、插入、插单”时，今天任务可用 source=临时。
6. 昨天的 unfinished 或 planned evidence 必须被至少一条任务直接覆盖，可以作为主要证据，也可以作为辅助证据；辅助证据必须与主要证据有明确对象或事项关联，不得附加到无关任务上规避校验。
7. 当昨天的遗留问题或计划与今天、明天、后天的 planned/unfinished evidence 描述同一事项时，只生成一条任务。优先把具有明确可执行动作的当前或未来 evidence 放在 evidenceIds[0]，把该任务直接解决的昨天 evidence 放在后续位置。
8. 今天、明天、后天中 status=planned 或 unfinished 的可执行 evidence 必须各自作为至少一条任务的主要证据。背景说明、已完成事实和纯评价不得生成任务。
9. status 固定为 pending。
10. importance 只判断“不完成对明确目标和结果的影响”，允许高/中/低；不得因为包含“管理、团队、项目”等词自动判高。
11. urgency 是语义初值，允许高/中/低；服务端会根据业务日期和期限确定性纠偏。
12. est 无法由原文判断时写“待确认”，不得凭经验猜测。可解析且超过 8h 的复盘、今天、短期目标和临时事项必须拆分；中长期里程碑超过 8h 时必须填写 nextAction。
13. acceptanceCriteria 最多 3 条。短期目标和中长期任务至少 1 条；只能根据原文目标或可直接验证的交付结果表达，不得虚构指标。
14. 不要在 task 中输出 owner 或 due。服务端会从主要 evidence 确定性写入这两个字段，模型不得重复生成或推断。
15. tasks 总数最多 12；任务名、下一步与验收标准必须具体、可执行。
</task_protocol>
