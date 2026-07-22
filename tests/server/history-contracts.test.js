const assert = require('node:assert/strict');
const test = require('node:test');

const {
  HISTORY_SCHEMA_VERSION,
  decodeStoredSnapshot,
  validateHistorySnapshot,
} = require('../../server/history/contracts');
const {
  decodeHistoryCursor,
  encodeHistoryCursor,
  normalizeHistoryLimit,
} = require('../../server/history/cursor');
const {
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
    schemaVersion,
  };
}

test('a complete version-1 history snapshot preserves the formal workflow contract', () => {
  const snapshot = historySnapshot();
  assert.equal(HISTORY_SCHEMA_VERSION, 1);
  assert.deepEqual(validateHistorySnapshot(snapshot), snapshot);
  assert.deepEqual(decodeStoredSnapshot(stored(snapshot)), snapshot);
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
    () => decodeStoredSnapshot(stored(historySnapshot(), 2)),
    (error) => error.code === 'HISTORY_DATA_INVALID' && error.status === 500,
  );
  const damaged = stored(historySnapshot());
  damaged.tasksJson = '{damaged';
  assert.throws(
    () => decodeStoredSnapshot(damaged),
    (error) => error.code === 'HISTORY_DATA_INVALID' && error.status === 500,
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
