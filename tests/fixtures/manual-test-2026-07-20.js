const REFERENCE_DATE = '2026-07-20';
const REFERENCE_NOW = '2026-07-20T04:00:00.000Z';
const TIME_ZONE = 'Asia/Shanghai';

const goals = Object.freeze({
  昨天: '原定 7 月 19 日完成第二季度经营复盘，实际已完成数据汇总但未完成原因分析，因为销售渠道数据到达较晚；下一步在 2026-07-20 15:00 前补齐原因分析并记录三条改进措施。',
  今天: '今天完成以下事项：2026-07-20 16:00 前提交经营数据核对表；2026-07-20 17:00 前确认客户投诉处理方案；2026-07-20 18:00 前发送项目会议纪要；2026-07-21 10:00 前更新下周排期；整理知识库标签，期限待确认。',
  明天: '2026-07-31 前完成管理课程训练材料：形成 4 个模块，组织 2 次模拟，结业评分不低于 80 分。',
  后天: '2026-09-30 前搭建团队培养体系，完成岗位能力图谱和培养路径；培养路径预计 16h，第一步先整理当前岗位清单。',
});

const expectedTasks = Object.freeze([
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: '补齐经营复盘原因分析',
    importance: '高', urgency: '中', source: '复盘', due: '2026-07-20 15:00', est: '约2h',
    acceptanceCriteria: ['记录三条改进措施'], nextAction: '',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: '提交经营数据核对表',
    importance: '高', urgency: '中', source: '今天', due: '2026-07-20 16:00', est: '约1h',
    acceptanceCriteria: [], nextAction: '',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    name: '确认客户投诉处理方案',
    importance: '高', urgency: '中', source: '今天', due: '2026-07-20 17:00', est: '约1h',
    acceptanceCriteria: [], nextAction: '',
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    name: '发送项目会议纪要',
    importance: '低', urgency: '低', source: '今天', due: '2026-07-20 18:00', est: '约0.5h',
    acceptanceCriteria: [], nextAction: '',
  },
  {
    id: '55555555-5555-4555-8555-555555555555',
    name: '更新下周排期',
    importance: '高', urgency: '低', source: '今天', due: '2026-07-21 10:00', est: '约1h',
    acceptanceCriteria: [], nextAction: '',
  },
  {
    id: '66666666-6666-4666-8666-666666666666',
    name: '整理知识库标签',
    importance: '低', urgency: '低', source: '今天', due: '待确认', est: '约1h',
    acceptanceCriteria: [], nextAction: '',
  },
  {
    id: '77777777-7777-4777-8777-777777777777',
    name: '编写课程模块一和二',
    importance: '高', urgency: '中', source: '短期目标', due: '2026-07-24', est: '约4h',
    acceptanceCriteria: ['完成 2 个可评审模块'], nextAction: '',
  },
  {
    id: '88888888-8888-4888-8888-888888888888',
    name: '编写课程模块三和四',
    importance: '高', urgency: '中', source: '短期目标', due: '2026-07-26', est: '约4h',
    acceptanceCriteria: ['累计形成 4 个可评审模块'], nextAction: '',
  },
  {
    id: '99999999-9999-4999-8999-999999999999',
    name: '组织第一次课程模拟',
    importance: '高', urgency: '中', source: '短期目标', due: '2026-07-28', est: '约2h',
    acceptanceCriteria: ['完成第 1 次模拟并记录反馈'], nextAction: '',
  },
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: '组织第二次课程模拟并评分',
    importance: '高', urgency: '中', source: '短期目标', due: '2026-07-31', est: '约3h',
    acceptanceCriteria: ['累计完成 2 次模拟', '结业评分不低于 80 分'], nextAction: '',
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    name: '完成岗位能力图谱',
    importance: '高', urgency: '低', source: '中长期', due: '2026-09-15', est: '约8h',
    acceptanceCriteria: ['覆盖当前全部岗位'], nextAction: '',
  },
  {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    name: '搭建团队培养路径',
    importance: '高', urgency: '低', source: '中长期', due: '2026-09-30', est: '约16h',
    acceptanceCriteria: ['形成可评审的培养路径'], nextAction: '整理当前岗位清单',
  },
]);

module.exports = Object.freeze({
  REFERENCE_DATE,
  REFERENCE_NOW,
  TIME_ZONE,
  goals,
  expectedTasks,
});
