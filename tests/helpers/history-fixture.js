const CLIENT_RUN_ID = '99999999-9999-4999-8999-999999999999';
const TASK_ONE_ID = '11111111-1111-4111-8111-111111111111';
const TASK_TWO_ID = '22222222-2222-4222-8222-222222222222';

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
  TASK_ONE_ID,
  TASK_TWO_ID,
  historySnapshot,
};
