const assert = require('node:assert/strict');
const test = require('node:test');

test('authentication and SQLite dependencies support the pinned Node 20 CommonJS runtime', () => {
  assert.equal(process.versions.node, '20.20.2');
  assert.equal(typeof require('express-session'), 'function');
  assert.equal(typeof require('express-rate-limit').rateLimit, 'function');
  assert.equal(typeof require('sqlite3').Database, 'function');
});
