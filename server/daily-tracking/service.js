const { shanghaiBusinessDay } = require('./business-date');
const { validateDailyWrite } = require('./contracts');

function dateChangedError() {
  return Object.assign(new Error('日期已变化，请重新进入今日跟踪。'), {
    code: 'DAILY_TRACKING_DATE_CHANGED',
    status: 409,
    expose: true,
  });
}

function mergeDailyTracking({ saved, sourceTasks }) {
  const value = saved || {
    tasks: [],
    tracking: {},
    removedTaskIds: [],
    revision: 0,
    updatedAt: null,
  };
  const removed = new Set(value.removedTaskIds || []);
  const tasks = (value.tasks || []).filter((task) => !removed.has(task.id));
  const present = new Set(tasks.map((task) => task.id));
  let added = 0;
  const sourceIds = new Set();
  for (const task of sourceTasks || []) {
    if (sourceIds.has(task.id)) continue;
    sourceIds.add(task.id);
    if (present.has(task.id) || removed.has(task.id)) continue;
    tasks.push(task);
    present.add(task.id);
    added += 1;
  }
  const tracking = Object.fromEntries(
    Object.entries(value.tracking || []).filter(([taskId]) => present.has(taskId)),
  );
  return {
    tasks: JSON.parse(JSON.stringify(tasks)),
    tracking: JSON.parse(JSON.stringify(tracking)),
    removedTaskIds: [...removed],
    revision: value.revision || 0,
    updatedAt: value.updatedAt || null,
    hasUnpersistedMerge: added > 0,
  };
}

function createDailyTrackingService({
  dailyTrackingRepository,
  historyRepository,
  now = () => new Date(),
} = {}) {
  if (
    !dailyTrackingRepository
    || typeof dailyTrackingRepository.get !== 'function'
    || typeof dailyTrackingRepository.save !== 'function'
    || !historyRepository
    || typeof historyRepository.listTasksCreatedBetween !== 'function'
  ) {
    throw Object.assign(new Error('Daily tracking dependencies are required.'), {
      code: 'CONFIG_INVALID',
    });
  }

  async function sourceForDay(userId, day) {
    return historyRepository.listTasksCreatedBetween({
      userId,
      startUtc: day.startUtc,
      endUtc: day.endUtc,
    });
  }

  function responseFor(day, source, merged) {
    return {
      trackingDate: day.trackingDate,
      tasks: merged.tasks,
      tracking: merged.tracking,
      removedTaskIds: merged.removedTaskIds,
      revision: merged.revision,
      updatedAt: merged.updatedAt,
      sourceSummary: {
        historyCount: source.historyCount,
        taskCount: merged.tasks.length,
      },
      hasUnpersistedMerge: merged.hasUnpersistedMerge,
    };
  }

  return Object.freeze({
    async getToday({ userId } = {}) {
      const day = shanghaiBusinessDay(now());
      const [saved, source] = await Promise.all([
        dailyTrackingRepository.get({ userId, trackingDate: day.trackingDate }),
        sourceForDay(userId, day),
      ]);
      return responseFor(day, source, mergeDailyTracking({
        saved,
        sourceTasks: source.tasks,
      }));
    },

    async saveToday({ userId, snapshot } = {}) {
      const value = validateDailyWrite(snapshot);
      const day = shanghaiBusinessDay(now());
      if (value.trackingDate !== day.trackingDate) throw dateChangedError();
      const source = await sourceForDay(userId, day);
      const merged = mergeDailyTracking({
        saved: value,
        sourceTasks: source.tasks,
      });
      const stored = await dailyTrackingRepository.save({
        userId,
        trackingDate: day.trackingDate,
        tasks: merged.tasks,
        tracking: merged.tracking,
        removedTaskIds: merged.removedTaskIds,
        revision: value.revision,
      });
      return responseFor(day, source, {
        ...stored,
        hasUnpersistedMerge: false,
      });
    },
  });
}

module.exports = { createDailyTrackingService, mergeDailyTracking };
