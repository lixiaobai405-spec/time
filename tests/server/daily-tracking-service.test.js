const assert = require('node:assert/strict');
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
    dailyTrackingRepository: { get: async () => null, save: async () => null },
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
