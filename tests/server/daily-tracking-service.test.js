const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const test = require('node:test');

const { shanghaiBusinessDay } = require('../../server/daily-tracking/business-date');
const {
  createDailyTrackingService,
  mergeDailyTracking,
} = require('../../server/daily-tracking/service');
const { historySnapshot, TASK_ONE_ID, TASK_TWO_ID } = require('../helpers/history-fixture');

test('Shanghai business day returns an inclusive UTC start and exclusive UTC end', () => {
  assert.deepEqual(
    shanghaiBusinessDay(new Date('2026-07-22T15:59:59.999Z')),
    {
      trackingDate: '2026-07-22',
      startUtc: '2026-07-21T16:00:00.000Z',
      endUtc: '2026-07-22T16:00:00.000Z',
    },
  );
});

test('Shanghai business day changes exactly at local midnight', () => {
  assert.deepEqual(
    shanghaiBusinessDay(new Date('2026-07-22T16:00:00.000Z')),
    {
      trackingDate: '2026-07-23',
      startUtc: '2026-07-22T16:00:00.000Z',
      endUtc: '2026-07-23T16:00:00.000Z',
    },
  );
});

test('daily merge preserves saved edits, deduplicates IDs, keeps same-name IDs, and honors removals', () => {
  const original = historySnapshot().tasks[0];
  const removed = historySnapshot().tasks[1];
  const sameNameDifferentId = {
    ...original,
    id: '33333333-3333-4333-8333-333333333333',
  };
  const result = mergeDailyTracking({
    saved: {
      tasks: [{ ...original, name: '用户编辑后的名称' }],
      tracking: {
        [original.id]: { done: true, doneAt: '2026-07-23T09:30' },
      },
      removedTaskIds: [removed.id],
      revision: 4,
      updatedAt: '2026-07-23T01:00:00.000Z',
    },
    sourceTasks: [original, original, removed, sameNameDifferentId],
    dueContext: {
      now: () => new Date('2026-07-20T04:00:00.000Z'),
      timeZone: 'Asia/Shanghai',
    },
  });

  assert.deepEqual(result.tasks.map((task) => task.id), [
    TASK_ONE_ID,
    sameNameDifferentId.id,
  ]);
  assert.equal(result.tasks[0].name, '用户编辑后的名称');
  assert.equal(result.tasks[1].name, original.name);
  assert.deepEqual(result.tracking, {
    [TASK_ONE_ID]: { done: true, doneAt: '2026-07-23T09:30' },
  });
  assert.deepEqual(result.removedTaskIds, [TASK_TWO_ID]);
  assert.equal(result.hasUnpersistedMerge, true);
});

test('daily merge removes edited tasks whose source history disappeared', () => {
  const survivingSource = historySnapshot().tasks[0];
  const deletedSource = historySnapshot().tasks[1];
  const staleRemovedId = '44444444-4444-4444-8444-444444444444';
  const result = mergeDailyTracking({
    saved: {
      tasks: [
        { ...survivingSource, name: '保留用户编辑', due: '明天' },
        { ...deletedSource, name: '来源删除后即使编辑也删除' },
      ],
      tracking: {
        [survivingSource.id]: { done: true, doneAt: '2026-07-20T09:30' },
        [deletedSource.id]: { done: true, doneAt: '2026-07-20T10:00' },
      },
      removedTaskIds: [staleRemovedId],
      revision: 3,
      updatedAt: '2026-07-20T02:00:00.000Z',
    },
    sourceTasks: [survivingSource],
    dueContext: {
      now: () => new Date('2026-07-20T04:00:00.000Z'),
      timeZone: 'Asia/Shanghai',
    },
  });

  assert.deepEqual(result.tasks.map(item => item.id), [survivingSource.id]);
  assert.equal(result.tasks[0].name, '保留用户编辑');
  assert.equal(result.tasks[0].due, '2026-07-21');
  assert.deepEqual(result.tracking, {
    [survivingSource.id]: { done: true, doneAt: '2026-07-20T09:30' },
  });
  assert.deepEqual(result.removedTaskIds, []);
  assert.equal(result.hasUnpersistedMerge, true);
});

test('daily service reads today and appends sources that appear before save', async () => {
  const initial = historySnapshot().tasks[0];
  const later = historySnapshot().tasks[1];
  let sourceTasks = [initial];
  let savedInput;
  const dailyTrackingRepository = {
    get: async () => null,
    getLatestBefore: async () => null,
    save: async (value) => {
      savedInput = value;
      return {
        id: '40000000-0000-4000-8000-000000000004',
        ...value,
        revision: 1,
        createdAt: '2026-07-23T02:00:00.000Z',
        updatedAt: '2026-07-23T02:00:00.000Z',
      };
    },
  };
  const historyRepository = {
    listTasksCreatedBetween: async () => ({
      historyCount: sourceTasks.length,
      tasks: sourceTasks,
    }),
  };
  const service = createDailyTrackingService({
    dailyTrackingRepository,
    historyRepository,
    now: () => new Date('2026-07-23T02:00:00.000Z'),
  });

  const opened = await service.getToday({
    userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  });
  assert.deepEqual(opened.tasks.map((task) => task.id), [initial.id]);
  assert.equal(opened.hasUnpersistedMerge, true);

  sourceTasks = [initial, later];
  const saved = await service.saveToday({
    userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    snapshot: {
      trackingDate: opened.trackingDate,
      tasks: [{ ...initial, name: '保存前编辑' }],
      tracking: {},
      removedTaskIds: [],
      revision: 0,
    },
  });
  assert.deepEqual(saved.tasks.map((task) => task.id), [initial.id, later.id]);
  assert.equal(saved.tasks[0].name, '保存前编辑');
  assert.deepEqual(savedInput.tasks, saved.tasks);
});

test('daily service rejects saving a page from another Shanghai date', async () => {
  const service = createDailyTrackingService({
    dailyTrackingRepository: { get: async () => null, getLatestBefore: async () => null, save: async () => null },
    historyRepository: {
      listTasksCreatedBetween: async () => ({ historyCount: 0, tasks: [] }),
    },
    now: () => new Date('2026-07-23T02:00:00.000Z'),
  });
  await assert.rejects(
    service.saveToday({
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      snapshot: {
        trackingDate: '2026-07-22',
        tasks: [],
        tracking: {},
        removedTaskIds: [],
        revision: 0,
      },
    }),
    (error) => error.code === 'DAILY_TRACKING_DATE_CHANGED' && error.status === 409,
  );
});

function makeTask(overrides = {}) {
  return {
    id: randomUUID(),
    name: '测试任务',
    importance: '高',
    urgency: '高',
    source: '今天',
    due: '待确认',
    est: '1h',
    owner: '待确认',
    acceptanceCriteria: [],
    nextAction: '',
    status: 'pending',
    classificationSource: 'ai-extraction',
    ...overrides,
  };
}

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW_2026_07_23 = () => new Date('2026-07-23T02:00:00.000Z');

test('daily source carries unchecked and missing-tracking tasks but drops checked and deleted tasks', async () => {
  const unfinished = makeTask({ id: '11111111-1111-4111-8111-111111111111', name: '未完成', source: '复盘' });
  const noTracking = makeTask({ id: '22222222-2222-4222-8222-222222222222', name: '无tracking', source: '今天', status: 'done' });
  const finished = makeTask({ id: '33333333-3333-4333-8333-333333333333', name: '已完成', source: '临时' });
  const removedId = '44444444-4444-4444-8444-444444444444';
  const prior = {
    tasks: [unfinished, noTracking, finished],
    tracking: {
      [unfinished.id]: { done: false, doneAt: '' },
      [finished.id]: { done: true, doneAt: '2026-07-22T09:30' },
    },
    removedTaskIds: [removedId],
    revision: 1,
    updatedAt: '2026-07-22T16:00:00.000Z',
    trackingDate: '2026-07-22',
  };

  let capturedStartUtc;
  const dailyTrackingRepository = {
    get: async () => null,
    getLatestBefore: async () => prior,
    save: async () => null,
  };
  const historyRepository = {
    listTasksCreatedBetween: async (params) => {
      capturedStartUtc = params.startUtc;
      if (params.startUtc) {
        const deletedTask = makeTask({ id: removedId, name: '已删除任务', source: '今天' });
        return { historyCount: 1, tasks: [deletedTask] };
      }
      return { historyCount: 0, tasks: [] };
    },
  };
  const service = createDailyTrackingService({
    dailyTrackingRepository,
    historyRepository,
    now: NOW_2026_07_23,
  });

  const result = await service.getToday({ userId: USER_ID });
  assert.deepEqual(result.tasks.map(t => t.id), [unfinished.id, noTracking.id]);
  assert.equal(result.tasks[0].name, '未完成');
  assert.equal(result.tasks[0].source, '复盘');
  assert.equal(result.tasks[1].name, '无tracking');
  assert.equal(result.tasks[1].status, 'done');
  assert.ok(capturedStartUtc, 'history delta should use startUtc when prior exists');
});

test('daily source survives skipped days and keeps carried values ahead of history duplicates', async () => {
  const carriedA = makeTask({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', name: 'prior原始', source: '今天' });
  const carriedB = makeTask({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', name: 'priorB', source: '临时' });
  const prior = {
    tasks: [carriedA, carriedB],
    tracking: {},
    removedTaskIds: [],
    revision: 1,
    updatedAt: '2026-07-20T08:00:00.000Z',
    trackingDate: '2026-07-20',
  };

  const sameIdDifferent = makeTask({ id: carriedA.id, name: 'history同名覆盖', source: '今天' });
  const sameTimestamp = makeTask({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: '同毫秒新增', source: '今天' });
  const sameNameDifferentId = makeTask({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: 'priorB', source: '今天' });
  const newerTask = makeTask({ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name: '新增later', source: '今天' });

  const dailyTrackingRepository = {
    get: async () => null,
    getLatestBefore: async () => prior,
    save: async () => null,
  };
  const historyRepository = {
    listTasksCreatedBetween: async (params) => {
      if (params.startUtc) {
        return { historyCount: 2, tasks: [sameIdDifferent, sameTimestamp, sameNameDifferentId, newerTask] };
      }
      return { historyCount: 0, tasks: [] };
    },
  };
  const service = createDailyTrackingService({
    dailyTrackingRepository,
    historyRepository,
    now: NOW_2026_07_23,
  });

  const result = await service.getToday({ userId: USER_ID });
  assert.equal(result.tasks.length, 5);
  assert.equal(result.tasks.find(t => t.id === carriedA.id).name, 'prior原始');
  assert.equal(result.tasks.find(t => t.id === carriedB.id).name, 'priorB');
  assert.ok(result.tasks.find(t => t.id === sameTimestamp.id), 'same-ms new ID must be included');
  assert.ok(result.tasks.find(t => t.id === sameNameDifferentId.id), 'same-name different-ID must be kept');
  assert.ok(result.tasks.find(t => t.id === newerTask.id), 'newer task must be included');
});

test('today saved task values win over carryover and history values', async () => {
  const taskA = makeTask({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', name: 'prior旧值', source: '复盘' });
  const prior = {
    tasks: [taskA],
    tracking: {},
    removedTaskIds: [],
    revision: 1,
    updatedAt: '2026-07-22T08:00:00.000Z',
    trackingDate: '2026-07-22',
  };
  const todaySaved = {
    tasks: [{ ...taskA, name: '今天编辑值' }],
    tracking: {},
    removedTaskIds: [],
    revision: 1,
    updatedAt: '2026-07-23T01:00:00.000Z',
    trackingDate: '2026-07-23',
  };
  const historyVersion = makeTask({ id: taskA.id, name: 'history同名', source: '今天' });

  const dailyTrackingRepository = {
    get: async () => todaySaved,
    getLatestBefore: async () => prior,
    save: async () => null,
  };
  const historyRepository = {
    listTasksCreatedBetween: async () => ({ historyCount: 1, tasks: [historyVersion] }),
  };
  const service = createDailyTrackingService({
    dailyTrackingRepository,
    historyRepository,
    now: NOW_2026_07_23,
  });

  const result = await service.getToday({ userId: USER_ID });
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].name, '今天编辑值');
});

test('daily source starts from all history when no prior snapshot exists', async () => {
  const historyA = makeTask({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', name: '历史任务A', source: '今天' });
  const historyB = makeTask({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', name: '历史任务B', source: '临时' });
  let capturedNoStart, capturedToday;
  const dailyTrackingRepository = {
    get: async () => null,
    getLatestBefore: async () => null,
    save: async () => null,
  };
  const historyRepository = {
    listTasksCreatedBetween: async (params) => {
      if (params.startUtc === undefined) {
        capturedNoStart = params;
        return { historyCount: 2, tasks: [historyA, historyB] };
      }
      capturedToday = params;
      return { historyCount: 0, tasks: [] };
    },
  };
  const service = createDailyTrackingService({
    dailyTrackingRepository,
    historyRepository,
    now: NOW_2026_07_23,
  });

  const result = await service.getToday({ userId: USER_ID });
  assert.equal(result.tasks.length, 2);
  assert.ok(capturedNoStart, 'should call history without startUtc when no prior snapshot');
  assert.equal(capturedNoStart.startUtc, undefined);
  assert.equal(capturedToday.startUtc, '2026-07-22T16:00:00.000Z');
});

test('daily source rejects more than 100 merged tasks without truncation', async () => {
  const manyTasks = Array.from({ length: 101 }, (_, i) => makeTask({
    id: `${String(i + 1).padStart(8, '0')}-0000-4000-8000-000000000000`,
    name: `Task ${i + 1}`,
  }));

  let saveCalled = false;
  const dailyTrackingRepository = {
    get: async () => null,
    getLatestBefore: async () => null,
    save: async () => { saveCalled = true; },
  };
  const historyRepository = {
    listTasksCreatedBetween: async () => ({ historyCount: manyTasks.length, tasks: manyTasks }),
  };
  const service = createDailyTrackingService({
    dailyTrackingRepository,
    historyRepository,
    now: NOW_2026_07_23,
  });

  await assert.rejects(
    service.getToday({ userId: USER_ID }),
    (error) => error.code === 'DAILY_TRACKING_CAPACITY_EXCEEDED'
      && error.status === 409
      && error.expose === true,
  );
  assert.equal(saveCalled, false);
});

test('daily save rejects more than 100 merged tasks before repository write', async () => {
  const manyTasks = Array.from({ length: 101 }, (_, i) => makeTask({
    id: `${String(i + 1).padStart(8, '0')}-0000-4000-8000-000000000000`,
    name: `Task ${i + 1}`,
  }));
  let saveCalled = false;
  const service = createDailyTrackingService({
    dailyTrackingRepository: {
      get: async () => null,
      getLatestBefore: async () => null,
      save: async () => {
        saveCalled = true;
      },
    },
    historyRepository: {
      listTasksCreatedBetween: async () => ({
        historyCount: manyTasks.length,
        tasks: manyTasks,
      }),
    },
    now: NOW_2026_07_23,
  });

  await assert.rejects(
    service.saveToday({
      userId: USER_ID,
      snapshot: {
        trackingDate: '2026-07-23',
        tasks: [],
        tracking: {},
        removedTaskIds: [],
        revision: 0,
      },
    }),
    (error) => error.code === 'DAILY_TRACKING_CAPACITY_EXCEEDED'
      && error.status === 409
      && error.expose === true,
  );
  assert.equal(saveCalled, false);
});
