const assert = require('node:assert/strict');
const test = require('node:test');

const { shanghaiBusinessDay } = require('../../server/daily-tracking/business-date');

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
