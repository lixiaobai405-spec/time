const assert = require('node:assert/strict');
const test = require('node:test');

const {
  HISTORY_SCHEMA_VERSION,
  decodeStoredSnapshot,
  validateHistorySnapshot,
} = require('../../server/history/contracts');
const { HISTORY_SNAPSHOT_MAX_BYTES } = require('../../server/history/limits');
const {
  decodeHistoryCursor,
  encodeHistoryCursor,
  normalizeHistoryLimit,
} = require('../../server/history/cursor');
const {
  decompositionFixture,
  taskFirstDecompositionFixture,
} = require('../helpers/decomposition-fixture');
const { maxHistorySnapshot } = require('../helpers/max-history-fixture');
const {
  DISTRIBUTION_FIXTURE,
  TASK_ONE_ID,
  TASK_TWO_ID,
  historySnapshot,
} = require('../helpers/history-fixture');

function inputInvalid(block) {
  assert.throws(
    block,
    (error) => error.code === 'INPUT_INVALID'
      && error.status === 400
      && !/SQLITE|SELECT|INSERT/i.test(error.message),
  );
}

function stored(snapshot, schemaVersion = 1) {
  return {
    clientRunId: snapshot.clientRunId,
    title: snapshot.title,
    goalsJson: JSON.stringify(snapshot.goals),
    tasksJson: JSON.stringify(snapshot.tasks),
    matrixJson: JSON.stringify(snapshot.matrix),
    reportJson: JSON.stringify(snapshot.report),
    distributionJson: schemaVersion >= 2 && snapshot.distribution
      ? JSON.stringify(snapshot.distribution) : null,
    decompositionJson: schemaVersion >= 2 && snapshot.decomposition
      ? JSON.stringify(snapshot.decomposition) : null,
    schemaVersion,
  };
}

test('a complete version-3 history snapshot preserves distribution', () => {
  const snapshot = historySnapshot();
  assert.equal(HISTORY_SCHEMA_VERSION, 3);
  assert.deepEqual(validateHistorySnapshot(snapshot), snapshot);
  assert.deepEqual(decodeStoredSnapshot(stored(snapshot, 3)), snapshot);
});

test('history snapshot budget covers the maximum legal version-3 response with ten percent margin', () => {
  const snapshot = maxHistorySnapshot();
  assert.doesNotThrow(() => validateHistorySnapshot(snapshot));
  const response = {
    id: '00000000-0000-4000-8000-000000000000',
    ...snapshot,
    schemaVersion: 3,
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
  };
  const largestBytes = Math.max(
    Buffer.byteLength(JSON.stringify(snapshot), 'utf8'),
    Buffer.byteLength(JSON.stringify(response), 'utf8'),
  );
  const calculatedBudget = Math.ceil(
    (largestBytes * 1.1) / (64 * 1024),
  ) * 64 * 1024;
  assert.equal(HISTORY_SNAPSHOT_MAX_BYTES, calculatedBudget);
  assert.ok(largestBytes <= HISTORY_SNAPSHOT_MAX_BYTES);
});

test('version-2 history round-trips decomposition intermediate JSON', () => {
  const base = historySnapshot();
  const snapshot = {
    ...base,
    decomposition: decompositionFixture(base),
  };
  const validated = validateHistorySnapshot(snapshot, { schemaVersion: 2 });
  assert.deepEqual(validated.decomposition, snapshot.decomposition);
  assert.deepEqual(decodeStoredSnapshot(stored(snapshot, 2)), snapshot);
});

test('version-3 history accepts task-first decomposition with optional coaching', () => {
  const base = historySnapshot({
    goals: { 昨天: '', 今天: '今天18:00前提交方案', 明天: '', 后天: '' },
  });
  const withoutCoaching = {
    ...base,
    decomposition: taskFirstDecompositionFixture(base),
  };
  assert.deepEqual(validateHistorySnapshot(withoutCoaching), withoutCoaching);
  assert.deepEqual(
    decodeStoredSnapshot(stored(withoutCoaching, 3)),
    withoutCoaching,
  );

  const withCoaching = {
    ...base,
    decomposition: taskFirstDecompositionFixture(base, { withCoaching: true }),
  };
  assert.deepEqual(validateHistorySnapshot(withCoaching), withCoaching);
});

test('version-3 history rejects wrong prompt identity and pending coaching', () => {
  const base = historySnapshot({
    goals: { 昨天: '', 今天: '今天18:00前提交方案', 明天: '', 后天: '' },
  });
  const wrongPrompt = {
    ...base,
    decomposition: taskFirstDecompositionFixture(base),
  };
  wrongPrompt.decomposition.stages[0].prompt.id = 'decomposition.task-generation';
  inputInvalid(() => validateHistorySnapshot(wrongPrompt));

  const pending = {
    ...base,
    decomposition: taskFirstDecompositionFixture(base, { withCoaching: true }),
  };
  pending.decomposition.stages[1].status = 'pending';
  inputInvalid(() => validateHistorySnapshot(pending));
});

test('manual task edits keep the original decomposition trace auditable', () => {
  const base = historySnapshot();
  const snapshot = {
    ...base,
    decomposition: decompositionFixture(base),
    tasks: base.tasks.map((task, index) => (
      index === 0 ? { ...task, name: '人工修订后的方案' } : task
    )),
  };
  const validated = validateHistorySnapshot(snapshot, { schemaVersion: 2 });
  assert.equal(validated.tasks[0].name, '人工修订后的方案');
  assert.equal(
    validated.decomposition.stages[1].output.tasks[0].name,
    '提交方案',
  );
});

test('Schema 1 stored records decode with distribution: null', () => {
  const snapshot = historySnapshot();
  const v1 = stored(snapshot, 1);
  const decoded = decodeStoredSnapshot(v1);
  assert.equal(decoded.distribution, null);
  assert.equal(decoded.title, snapshot.title);
  assert.equal(decoded.tasks.length, snapshot.tasks.length);
});

test('Schema 2 snapshot missing distribution returns INPUT_INVALID', () => {
  const snapshot = historySnapshot();
  delete snapshot.distribution;
  inputInvalid(() => validateHistorySnapshot(snapshot));
});

test('history snapshots normalize missing, blank, and null due values', () => {
  const missing = historySnapshot();
  delete missing.tasks[0].due;
  assert.equal(validateHistorySnapshot(missing).tasks[0].due, '待确认');

  const blank = historySnapshot();
  blank.tasks[0].due = '   ';
  assert.equal(validateHistorySnapshot(blank).tasks[0].due, '待确认');

  const nullable = historySnapshot();
  nullable.tasks[0].due = null;
  assert.equal(validateHistorySnapshot(nullable).tasks[0].due, '待确认');
});

test('history snapshots normalize missing, blank, and null owner values', () => {
  const missing = historySnapshot();
  delete missing.tasks[0].owner;
  assert.equal(validateHistorySnapshot(missing).tasks[0].owner, '待确认');

  const blank = historySnapshot();
  blank.tasks[0].owner = '   ';
  assert.equal(validateHistorySnapshot(blank).tasks[0].owner, '待确认');

  const nullable = historySnapshot();
  nullable.tasks[0].owner = null;
  assert.equal(validateHistorySnapshot(nullable).tasks[0].owner, '待确认');

  const explicit = historySnapshot();
  explicit.tasks[0].owner = '张三';
  assert.equal(validateHistorySnapshot(explicit).tasks[0].owner, '张三');
});

test('history input rejects identity injection, unknown fields, bad UUIDs, and incomplete shapes', () => {
  inputInvalid(() => validateHistorySnapshot({ ...historySnapshot(), userId: 'attacker' }));
  inputInvalid(() => validateHistorySnapshot({ ...historySnapshot(), user_id: 'attacker' }));
  inputInvalid(() => validateHistorySnapshot({ ...historySnapshot(), extra: true }));
  inputInvalid(() => validateHistorySnapshot({ ...historySnapshot(), clientRunId: 'not-a-uuid' }));
  inputInvalid(() => validateHistorySnapshot({ ...historySnapshot(), title: 'x'.repeat(101) }));
  const incomplete = historySnapshot();
  delete incomplete.report;
  inputInvalid(() => validateHistorySnapshot(incomplete));
});

test('task IDs are stable unique UUIDs and every task is conserved exactly once', () => {
  const duplicateTasks = historySnapshot();
  duplicateTasks.tasks[1].id = TASK_ONE_ID;
  inputInvalid(() => validateHistorySnapshot(duplicateTasks));

  const missingClassification = historySnapshot();
  missingClassification.matrix.classifications.pop();
  inputInvalid(() => validateHistorySnapshot(missingClassification));

  const duplicatedPlacement = historySnapshot();
  duplicatedPlacement.matrix.quadrants[1].taskIds.push(TASK_ONE_ID);
  inputInvalid(() => validateHistorySnapshot(duplicatedPlacement));

  const missingPlacement = historySnapshot();
  missingPlacement.matrix.quadrants[3].taskIds = [];
  inputInvalid(() => validateHistorySnapshot(missingPlacement));
});

test('only high maps to important or urgent and quadrants keep 55/25/15/5', () => {
  const wrongHighMapping = historySnapshot();
  wrongHighMapping.matrix.quadrants[3].taskIds = [];
  wrongHighMapping.matrix.quadrants[0].taskIds.push(TASK_TWO_ID);
  inputInvalid(() => validateHistorySnapshot(wrongHighMapping));

  const changedEnergy = historySnapshot();
  changedEnergy.matrix.quadrants[0].energyPercent = 50;
  inputInvalid(() => validateHistorySnapshot(changedEnergy));

  const changedClassification = historySnapshot();
  changedClassification.matrix.classifications[1].urgency = '高';
  inputInvalid(() => validateHistorySnapshot(changedClassification));
});

test('reports reference only current tasks and never expose UUID text or eight-character prefixes', () => {
  const unknownReference = historySnapshot();
  unknownReference.report.order[0].taskId = '33333333-3333-4333-8333-333333333333';
  inputInvalid(() => validateHistorySnapshot(unknownReference));

  const fullLeak = historySnapshot();
  fullLeak.report.energyRules[0] = `内部编号 ${TASK_ONE_ID}`;
  inputInvalid(() => validateHistorySnapshot(fullLeak));

  const prefixLeak = historySnapshot();
  prefixLeak.report.adjustments[0] = `追踪编号 ${TASK_TWO_ID.slice(0, 8)}`;
  inputInvalid(() => validateHistorySnapshot(prefixLeak));
});

test('stored snapshots reject unknown schema versions and damaged JSON without partial data', () => {
  assert.throws(
    () => decodeStoredSnapshot(stored(historySnapshot(), 4)),
    (error) => error.code === 'HISTORY_DATA_INVALID' && error.status === 500,
  );
  const damaged = stored(historySnapshot(), 2);
  damaged.tasksJson = '{damaged';
  assert.throws(
    () => decodeStoredSnapshot(damaged),
    (error) => error.code === 'HISTORY_DATA_INVALID' && error.status === 500,
  );
});

test('Schema 2 with NULL distribution_json returns HISTORY_DATA_INVALID', () => {
  const valid = stored(historySnapshot(), 2);
  valid.distributionJson = null;
  assert.throws(
    () => decodeStoredSnapshot(valid),
    (error) => error.code === 'HISTORY_DATA_INVALID' && error.status === 500,
  );
});

test('Schema 2 with damaged distribution_json returns safe HISTORY_DATA_INVALID', () => {
  const valid = stored(historySnapshot(), 2);
  valid.distributionJson = '{corrupt';
  assert.throws(
    () => decodeStoredSnapshot(valid),
    (error) => error.code === 'HISTORY_DATA_INVALID'
      && error.status === 500
      && !error.message.includes('{corrupt'),
  );
});

test('distribution with extra field returns INPUT_INVALID', () => {
  const snapshot = historySnapshot();
  snapshot.distribution = { ...DISTRIBUTION_FIXTURE, secret: 'leaked' };
  inputInvalid(() => validateHistorySnapshot(snapshot));
});

test('distribution with fifth category returns INPUT_INVALID', () => {
  const snapshot = historySnapshot();
  snapshot.distribution = {
    ...DISTRIBUTION_FIXTURE,
    categories: [...DISTRIBUTION_FIXTURE.categories, { key: '额外', minutes: 10, hours: 0.2, percent: 5, target: { min: 0, max: 10, label: '?' }, status: 'ok' }],
  };
  inputInvalid(() => validateHistorySnapshot(snapshot));
});

test('distribution with duplicate category keys returns INPUT_INVALID', () => {
  const snapshot = historySnapshot();
  snapshot.distribution = {
    ...DISTRIBUTION_FIXTURE,
    categories: [
      { key: '昨天', minutes: 0, hours: 0, percent: 0, target: { min: 0, max: 2, label: '→0%' }, status: 'ok' },
      { key: '昨天', minutes: 90, hours: 1.5, percent: 100, target: { min: 70, max: 80, label: '70–80%' }, status: 'over' },
    ],
  };
  inputInvalid(() => validateHistorySnapshot(snapshot));
});

test('distribution with unknown task ID in invalidTasks returns INPUT_INVALID', () => {
  const snapshot = historySnapshot();
  snapshot.distribution = {
    ...DISTRIBUTION_FIXTURE,
    invalidTasks: [{ taskId: '33333333-3333-4333-8333-333333333333', name: '幽灵任务', est: '?' }],
  };
  inputInvalid(() => validateHistorySnapshot(snapshot));
});

test('distribution with duplicate invalidTasks returns INPUT_INVALID', () => {
  const snapshot = historySnapshot();
  snapshot.distribution = {
    ...DISTRIBUTION_FIXTURE,
    invalidTasks: [
      { taskId: TASK_ONE_ID, name: '重复', est: '?' },
      { taskId: TASK_ONE_ID, name: '重复', est: '?' },
    ],
  };
  inputInvalid(() => validateHistorySnapshot(snapshot));
});

test('distribution with totalMinutes not matching category sum returns INPUT_INVALID', () => {
  const snapshot = historySnapshot();
  snapshot.distribution = { ...DISTRIBUTION_FIXTURE, totalMinutes: 999 };
  inputInvalid(() => validateHistorySnapshot(snapshot));
});

test('distribution with validTaskCount not matching task count minus invalidTasks returns INPUT_INVALID', () => {
  const snapshot = historySnapshot();
  snapshot.distribution = { ...DISTRIBUTION_FIXTURE, validTaskCount: 99 };
  inputInvalid(() => validateHistorySnapshot(snapshot));
});

test('distribution with wrong category percent returns INPUT_INVALID', () => {
  const snapshot = historySnapshot();
  const bad = JSON.parse(JSON.stringify(DISTRIBUTION_FIXTURE));
  bad.categories[0].percent = 50;
  inputInvalid(() => validateHistorySnapshot({ ...snapshot, distribution: bad }));
});

test('distribution with percentages not summing to 100 returns INPUT_INVALID', () => {
  const snapshot = historySnapshot();
  const bad = JSON.parse(JSON.stringify(DISTRIBUTION_FIXTURE));
  bad.percentages = { 昨天: 30, 今天: 30, 明天: 30, 后天: 30 };
  inputInvalid(() => validateHistorySnapshot({ ...snapshot, distribution: bad }));
});

test('distribution error messages do not leak raw JSON, SQL, table names or db paths', () => {
  const snapshot = historySnapshot();
  snapshot.distribution = { ...DISTRIBUTION_FIXTURE, totalMinutes: -1 };
  assert.throws(
    () => validateHistorySnapshot(snapshot),
    (error) => error.code === 'INPUT_INVALID'
      && error.status === 400
      && !/SQLITE|SELECT|time_management/i.test(error.message),
  );
});

test('history legacy reads preserve timestamps while write mode stores date-only due', () => {
  const snapshot = historySnapshot();
  snapshot.tasks[0].due = '2026-07-20 18:00';

  assert.equal(
    validateHistorySnapshot(snapshot).tasks[0].due,
    '2026-07-20 18:00',
  );
  assert.equal(
    validateHistorySnapshot(snapshot, { dueMode: 'write' }).tasks[0].due,
    '2026-07-20',
  );
});

test('history cursors are canonical, opaque, and limits default to 20 with a maximum of 50', () => {
  const value = {
    createdAt: '2026-07-21T08:00:00.000Z',
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  };
  const encoded = encodeHistoryCursor(value);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeHistoryCursor(encoded), value);
  inputInvalid(() => decodeHistoryCursor(`${encoded}=`));
  inputInvalid(() => decodeHistoryCursor('not-json'));
  inputInvalid(() => encodeHistoryCursor({ ...value, extra: true }));
  inputInvalid(() => encodeHistoryCursor({ ...value, createdAt: 'yesterday' }));
  assert.equal(normalizeHistoryLimit(undefined), 20);
  assert.equal(normalizeHistoryLimit('12'), 12);
  assert.equal(normalizeHistoryLimit('999'), 50);
  inputInvalid(() => normalizeHistoryLimit('0'));
  inputInvalid(() => normalizeHistoryLimit('1.5'));
});
