const CLIENT_RUN_ID = '99999999-9999-4999-8999-999999999999';
const TASK_ONE_ID = '11111111-1111-4111-8111-111111111111';
const TASK_TWO_ID = '22222222-2222-4222-8222-222222222222';

const DISTRIBUTION_FIXTURE = Object.freeze({
  totalMinutes: 90,
  totalHours: 1.5,
  validTaskCount: 2,
  invalidTasks: [],
  categories: [
    { key: '昨天', minutes: 0, hours: 0, percent: 0, target: { min: 0, max: 2, label: '→0%' }, status: 'ok' },
    { key: '今天', minutes: 90, hours: 1.5, percent: 100, target: { min: 70, max: 80, label: '70–80%' }, status: 'over' },
    { key: '明天', minutes: 0, hours: 0, percent: 0, target: { min: 10, max: 20, label: '10–20%' }, status: 'under' },
    { key: '后天', minutes: 0, hours: 0, percent: 0, target: { min: 3, max: 100, label: '5%' }, status: 'under' },
  ],
  percentages: { 昨天: 0, 今天: 100, 明天: 0, 后天: 0 },
  diagnosis: [
    '"昨天"投入已趋近 0%，遗留事项控制良好。',
    '"今天"占 100%：日常事务占比过高。',
    '"明天"占 0%：机制、流程或人才能力建设投入不足',
    '"后天"占 0%：缺少未来规划和提前布局。',
  ],
  recommendations: [
    '合并低价值日常事务，减少上下文切换和重复沟通。',
    '为"明天"类机制、流程和带人工作设置不可挤占时段。',
    '将"后天"目标拆成可检查的里程碑，并安排固定复盘。',
  ],
});

function historySnapshot(overrides = {}) {
  const tasks = [
    {
      id: TASK_ONE_ID,
      name: '提交方案',
      importance: '高',
      urgency: '高',
      source: '今天',
      due: '今天18:00',
      est: '约1h',
      owner: '待确认',
      acceptanceCriteria: ['方案已提交'],
      nextAction: '',
      status: 'pending',
      classificationSource: 'ai-extraction',
    },
    {
      id: TASK_TWO_ID,
      name: '整理资料',
      importance: '中',
      urgency: '低',
      source: '临时',
      due: '待确认',
      est: '30分钟',
      owner: '待确认',
      acceptanceCriteria: [],
      nextAction: '',
      status: 'pending',
      classificationSource: 'manual',
    },
  ];
  return {
    clientRunId: CLIENT_RUN_ID,
    title: '2026-07-21 时间管理报告',
    goals: {
      昨天: '完成复盘并记录改进',
      今天: '今天18:00前提交方案',
      明天: '本周五前完成验收清单',
      后天: '年底前完成年度目标',
    },
    tasks,
    distribution: DISTRIBUTION_FIXTURE,
    matrix: {
      classifications: [
        {
          taskId: TASK_ONE_ID,
          importance: '高',
          urgency: '高',
          classificationSource: 'ai-extraction',
        },
        {
          taskId: TASK_TWO_ID,
          importance: '中',
          urgency: '低',
          classificationSource: 'manual',
        },
      ],
      quadrants: [
        {
          name: '第一象限',
          priority: 1,
          action: '立即做',
          energyPercent: 55,
          taskIds: [TASK_ONE_ID],
        },
        {
          name: '第二象限',
          priority: 2,
          action: '计划做',
          energyPercent: 25,
          taskIds: [],
        },
        {
          name: '第三象限',
          priority: 3,
          action: '授权做',
          energyPercent: 15,
          taskIds: [],
        },
        {
          name: '第四象限',
          priority: 4,
          action: '减少做',
          energyPercent: 5,
          taskIds: [TASK_TWO_ID],
        },
      ],
      note: '',
    },
    report: {
      order: [
        { taskId: TASK_ONE_ID, reason: '先完成今天到期的方案' },
        { taskId: TASK_TWO_ID, reason: '随后整理所需资料' },
      ],
      energyRules: ['先处理第一象限，再为重要事项预留整块时间'],
      adjustments: ['每周固定复盘一次'],
    },
    ...overrides,
  };
}

module.exports = {
  CLIENT_RUN_ID,
  DISTRIBUTION_FIXTURE,
  TASK_ONE_ID,
  TASK_TWO_ID,
  historySnapshot,
};
