const { performance } = require('node:perf_hooks');

const TASK_ROUTE_BUDGET_MS = 12_000;
const MODEL_ROUTE_SUFFIXES = new Set([
  '/goals/check',
  '/tasks/extract',
  '/matrix/classify',
  '/report/generate',
]);

function timeoutError() {
  return Object.assign(new Error('model request timed out'), {
    code: 'MODEL_TIMEOUT',
  });
}

function cancelledError() {
  return Object.assign(new Error('model request cancelled'), {
    code: 'MODEL_CANCELLED',
  });
}

function routeBudget(pathname, modelTimeoutMs, taskRouteBudgetMs = TASK_ROUTE_BUDGET_MS) {
  if (
    pathname.endsWith('/tasks/decompose')
    || pathname.endsWith('/tasks/coaching-analysis')
  ) {
    return taskRouteBudgetMs;
  }
  for (const suffix of MODEL_ROUTE_SUFFIXES) {
    if (pathname.endsWith(suffix)) return modelTimeoutMs;
  }
  return null;
}

function createRequestLifecycle({
  modelTimeoutMs = 30_000,
  taskRouteBudgetMs = TASK_ROUTE_BUDGET_MS,
  now = () => performance.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  return (request, response, next) => {
    const pathname = new URL(request.originalUrl, 'http://localhost').pathname;
    const budgetMs = routeBudget(pathname, modelTimeoutMs, taskRouteBudgetMs);
    const controller = new AbortController();
    const startedAt = now();
    const deadlineAt = budgetMs == null ? Infinity : startedAt + budgetMs;
    let timer;
    let cleaned = false;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearTimer(timer);
      request.removeListener('aborted', cancel);
      response.removeListener('close', close);
      response.removeListener('finish', cleanup);
    };
    const abort = reason => {
      if (!controller.signal.aborted) controller.abort(reason);
    };
    const cancel = () => {
      abort(cancelledError());
      cleanup();
    };
    const close = () => {
      if (!response.writableEnded) cancel();
      cleanup();
    };

    if (budgetMs != null) {
      timer = setTimer(() => abort(timeoutError()), budgetMs);
    }
    request.once('aborted', cancel);
    response.once('close', close);
    response.once('finish', cleanup);
    response.locals.requestContext = {
      startedAt,
      deadlineAt,
      signal: controller.signal,
    };
    next();
  };
}

module.exports = {
  TASK_ROUTE_BUDGET_MS,
  createRequestLifecycle,
  routeBudget,
};
