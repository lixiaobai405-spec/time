const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');

const { createAuthRateLimiters } = require('../../server/auth/rate-limiters');
const { problemHandler } = require('../../server/http/problem');
const {
  createPreAuthCsrfToken,
  createSessionCsrfToken,
  createSessionCsrfTokenHash,
  requirePreAuthCsrf,
  requireSessionCsrf,
  verifyPreAuthCsrfToken,
} = require('../../server/security/csrf');
const { requireSameOrigin } = require('../../server/security/origin');

const SECRET = 'fake-session-secret-with-at-least-forty-eight-bytes-000000';
const NOW = Date.parse('2026-07-21T02:00:00.000Z');

function runMiddleware(middleware, request) {
  return new Promise((resolve) => {
    middleware(request, {}, (error) => resolve(error || null));
  });
}

function headers(values) {
  const normalized = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return { get: (name) => normalized[name.toLowerCase()] };
}

async function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
}

async function close(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => server.close((error) => (
    error ? reject(error) : resolve()
  )));
}

test('pre-auth CSRF tokens are signed, expire in ten minutes, and reject tampering', () => {
  const token = createPreAuthCsrfToken(SECRET, {
    now: () => NOW,
    randomBytesImpl: (size) => Buffer.alloc(size, 3),
  });

  assert.equal(verifyPreAuthCsrfToken(token, SECRET, { now: () => NOW }), true);
  assert.equal(
    verifyPreAuthCsrfToken(token, SECRET, { now: () => NOW + (10 * 60 * 1000) }),
    true,
  );
  assert.equal(
    verifyPreAuthCsrfToken(token, SECRET, { now: () => NOW + (10 * 60 * 1000) + 1 }),
    false,
  );
  const replacement = token.endsWith('x') ? 'y' : 'x';
  assert.equal(
    verifyPreAuthCsrfToken(`${token.slice(0, -1)}${replacement}`, SECRET, { now: () => NOW }),
    false,
  );
  assert.equal(verifyPreAuthCsrfToken(token, `${SECRET}x`, { now: () => NOW }), false);
  assert.equal(token.includes('manager'), false);
});

test('session CSRF tokens derive from the sid while only their SHA-256 is persisted', async () => {
  const sessionId = 'raw-session-id-for-test';
  const token = createSessionCsrfToken(SECRET, sessionId);
  const storedHash = createSessionCsrfTokenHash(SECRET, sessionId);
  const repository = {
    async findByToken(value) {
      assert.equal(value, sessionId);
      return { userId: 'user-1', csrfTokenHash: storedHash };
    },
  };
  const middleware = requireSessionCsrf({ secret: SECRET, sessionRepository: repository });

  assert.notEqual(token, sessionId);
  assert.notEqual(storedHash, token);
  assert.equal(await runMiddleware(middleware, {
    ...headers({ 'x-csrf-token': token }),
    sessionID: sessionId,
    session: { userId: 'user-1' },
  }), null);
  for (const request of [
    { ...headers({}), sessionID: sessionId, session: { userId: 'user-1' } },
    { ...headers({ 'x-csrf-token': `${token}x` }), sessionID: sessionId, session: { userId: 'user-1' } },
    { ...headers({ 'x-csrf-token': token }), sessionID: sessionId, session: null },
  ]) {
    const error = await runMiddleware(middleware, request);
    assert.equal(error.code, 'AUTH_CSRF_INVALID');
    assert.equal(error.status, 403);
  }
});

test('Origin and Host must both exist and match for state-changing requests', async () => {
  const middleware = requireSameOrigin();
  assert.equal(await runMiddleware(middleware, headers({
    origin: 'http://assistant.example:8011',
    host: 'assistant.example:8011',
  })), null);

  for (const values of [
    { host: 'assistant.example:8011' },
    { origin: 'http://assistant.example:8011' },
    { origin: 'http://evil.example', host: 'assistant.example:8011' },
    { origin: 'not a url', host: 'assistant.example:8011' },
  ]) {
    const error = await runMiddleware(middleware, headers(values));
    assert.equal(error.code, 'AUTH_CSRF_INVALID');
    assert.equal(error.status, 403);
  }
});

test('pre-auth middleware requires a valid header token', async () => {
  const token = createPreAuthCsrfToken(SECRET, { now: () => NOW });
  const middleware = requirePreAuthCsrf({ secret: SECRET, now: () => NOW });

  assert.equal(await runMiddleware(middleware, headers({ 'x-csrf-token': token })), null);
  for (const value of [undefined, 'tampered']) {
    const error = await runMiddleware(middleware, headers({ 'x-csrf-token': value }));
    assert.equal(error.code, 'AUTH_CSRF_INVALID');
  }
});

test('register, login, and reset limiters combine IP with the case-sensitive username', async (t) => {
  const limiters = createAuthRateLimiters();
  for (const [name, middleware, limit] of [
    ['register', limiters.register, 5],
    ['login', limiters.login, 10],
    ['reset', limiters.reset, 5],
  ]) {
    const app = express();
    app.use(express.json());
    app.post(`/${name}`, middleware, (_request, response) => response.json({ ok: true }));
    app.use(problemHandler);
    const server = await listen(app);
    t.after(() => close(server));
    const url = `http://127.0.0.1:${server.address().port}/${name}`;

    for (let attempt = 0; attempt < limit; attempt += 1) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'Manager_01' }),
      });
      assert.equal(response.status, 200);
    }
    const differentlyCasedUser = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'manager_01' }),
    });
    assert.equal(differentlyCasedUser.status, 200);

    const sameExactUser = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'Manager_01' }),
    });
    assert.equal(sameExactUser.status, 429);
    assert.equal((await sameExactUser.json()).error.code, 'AUTH_RATE_LIMITED');

    const differentUser = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'other_01' }),
    });
    assert.equal(differentUser.status, 200);
    await close(server);
  }
});
