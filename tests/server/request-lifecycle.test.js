const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  createRequestLifecycle,
  routeBudget,
} = require('../../server/http/request-lifecycle');

function requestResponse(path) {
  const request = new EventEmitter();
  request.originalUrl = path;
  const response = new EventEmitter();
  response.locals = {};
  response.writableEnded = false;
  return { request, response };
}

test('拆解和 coaching 使用 12 秒路由预算', () => {
  assert.equal(routeBudget('/api/time-management/tasks/decompose', 30_000), 12_000);
  assert.equal(
    routeBudget('/api/time-management/tasks/coaching-analysis', 30_000),
    12_000,
  );
  assert.equal(routeBudget('/api/time-management/report/generate', 30_000), 30_000);
  assert.equal(routeBudget('/api/health', 30_000), null);
});

test('路由 deadline 中止请求 signal', () => {
  let timerCallback;
  const middleware = createRequestLifecycle({
    modelTimeoutMs: 30_000,
    now: () => 100,
    setTimer(callback) {
      timerCallback = callback;
      return 1;
    },
    clearTimer() {},
  });
  const { request, response } = requestResponse(
    '/api/time-management/tasks/decompose',
  );

  middleware(request, response, () => undefined);
  assert.equal(response.locals.requestContext.deadlineAt, 12_100);
  timerCallback();
  assert.equal(response.locals.requestContext.signal.aborted, true);
  assert.equal(response.locals.requestContext.signal.reason.code, 'MODEL_TIMEOUT');
});

test('客户端断开中止 signal，正常 finish 只清理 timer', () => {
  let cleared = 0;
  const middleware = createRequestLifecycle({
    setTimer: () => 1,
    clearTimer: () => { cleared += 1; },
  });
  const first = requestResponse('/api/time-management/tasks/decompose');
  middleware(first.request, first.response, () => undefined);
  first.request.emit('aborted');
  assert.equal(first.response.locals.requestContext.signal.reason.code, 'MODEL_CANCELLED');

  const second = requestResponse('/api/time-management/tasks/decompose');
  middleware(second.request, second.response, () => undefined);
  second.response.writableEnded = true;
  second.response.emit('finish');
  assert.equal(second.response.locals.requestContext.signal.aborted, false);
  assert.equal(cleared, 2);
});
