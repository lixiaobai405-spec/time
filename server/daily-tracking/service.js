const { shanghaiBusinessDay } = require('./business-date');
const { validateDailyWrite } = require('./contracts');
const { normalizeDue } = require('../policies/deadline');
const { TASK_LIMIT } = require('../contracts/time-management');

function dateChangedError() {
  return Object.assign(new Error('日期已变化，请重新进入今日跟踪。'), {
    code: 'DAILY_TRACKING_DATE_CHANGED',
    status: 409,
    expose: true,
  });
}

function unfinishedTasksFrom(snapshot) {
  if (!snapshot) return [];
  const removed = new Set(snapshot.removedTaskIds || []);
  return (snapshot.tasks || []).filter((task) => (
    !removed.has(task.id)
    && snapshot.tracking?.[task.id]?.done !== true
  ));
}

function uniqueTasksById(groups) {
  const byId = new Map();
  for (const group of groups || []) {
    for (const task of group || []) {
      if (!byId.has(task.id)) byId.set(task.id, task);
    }
  }
  return [...byId.values()];
}

function capacityExceededError() {
  return Object.assign(
    new Error(`每日清单最多保留 ${TASK_LIMIT} 项任务，请先完成或删除部分任务。`),
    {
      code: 'DAILY_TRACKING_CAPACITY_EXCEEDED',
      status: 409,
      expose: true,
    },
  );
}

function assertWithinCapacity(merged) {
  if (merged.tasks.length > TASK_LIMIT) throw capacityExceededError();
  return merged;
}

function mergeDailyTracking({ saved, sourceTasks, dueContext = {} }) {
  const value = saved || {
    tasks: [],
    tracking: {},
    removedTaskIds: [],
    revision: 0,
    updatedAt: null,
  };
  const sourceById = new Map();
  for (const task of sourceTasks || []) {
    if (!sourceById.has(task.id)) sourceById.set(task.id, task);
  }
  const sourceIds = new Set(sourceById.keys());
  const removedTaskIds = (value.removedTaskIds || [])
    .filter(taskId => sourceIds.has(taskId));
  const removed = new Set(removedTaskIds);
  let changed = removedTaskIds.length !== (value.removedTaskIds || []).length;

  const tasks = [];
  const present = new Set();
  for (const task of value.tasks || []) {
    if (!sourceIds.has(task.id) || removed.has(task.id)) {
      changed = true;
      continue;
    }
    const normalized = { ...task, due: normalizeDue(task.due, dueContext) };
    if (normalized.due !== task.due) changed = true;
    tasks.push(normalized);
    present.add(task.id);
  }

  for (const task of sourceById.values()) {
    if (present.has(task.id) || removed.has(task.id)) continue;
    tasks.push({ ...task, due: normalizeDue(task.due, dueContext) });
    present.add(task.id);
    changed = true;
  }

  const tracking = Object.fromEntries(
    Object.entries(value.tracking || []).filter(([taskId]) => present.has(taskId)),
  );
  if (Object.keys(tracking).length !== Object.keys(value.tracking || {}).length) {
    changed = true;
  }

  return {
    tasks: JSON.parse(JSON.stringify(tasks)),
    tracking: JSON.parse(JSON.stringify(tracking)),
    removedTaskIds,
    revision: value.revision || 0,
    updatedAt: value.updatedAt || null,
    hasUnpersistedMerge: changed,
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
    || typeof dailyTrackingRepository.getLatestBefore !== 'function'
    || typeof dailyTrackingRepository.save !== 'function'
    || !historyRepository
    || typeof historyRepository.listTasksCreatedBetween !== 'function'
  ) {
    throw Object.assign(new Error('Daily tracking dependencies are required.'), {
      code: 'CONFIG_INVALID',
    });
  }

  async function sourceForDay(userId, day) {
    const previous = await dailyTrackingRepository.getLatestBefore({
      userId,
      trackingDate: day.trackingDate,
    });
    const carried = unfinishedTasksFrom(previous);
    const previousIds = new Set([
      ...(previous?.tasks || []).map((task) => task.id),
      ...(previous?.removedTaskIds || []),
    ]);
    const missed = previous?.updatedAt && previous.updatedAt >= day.startUtc
      ? { historyCount: 0, tasks: [] }
      : await historyRepository.listTasksCreatedBetween({
        userId,
        ...(previous?.updatedAt ? { startUtc: previous.updatedAt } : {}),
        endUtc: day.startUtc,
      });
    const today = await historyRepository.listTasksCreatedBetween({
      userId,
      startUtc: day.startUtc,
      endUtc: day.endUtc,
    });
    const newlyDiscovered = [...missed.tasks, ...today.tasks]
      .filter((task) => !previousIds.has(task.id));
    return {
      historyCount: today.historyCount,
      tasks: uniqueTasksById([carried, newlyDiscovered]),
    };
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
      const instant = now();
      const day = shanghaiBusinessDay(instant);
      const [saved, source] = await Promise.all([
        dailyTrackingRepository.get({ userId, trackingDate: day.trackingDate }),
        sourceForDay(userId, day),
      ]);
      const merged = mergeDailyTracking({
        saved,
        sourceTasks: source.tasks,
        dueContext: { now: instant, timeZone: 'Asia/Shanghai' },
      });
      assertWithinCapacity(merged);
      return responseFor(day, source, merged);
    },

    async saveToday({ userId, snapshot } = {}) {
      const value = validateDailyWrite(snapshot);
      const instant = now();
      const day = shanghaiBusinessDay(instant);
      if (value.trackingDate !== day.trackingDate) throw dateChangedError();
      const source = await sourceForDay(userId, day);
      const merged = mergeDailyTracking({
        saved: value,
        sourceTasks: source.tasks,
        dueContext: { now: instant, timeZone: 'Asia/Shanghai' },
      });
      assertWithinCapacity(merged);
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
