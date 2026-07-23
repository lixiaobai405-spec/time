const express = require('express');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

const { notFound, problemHandler } = require('./http/problem');
const { checkGoals } = require('./workflows/check-goals');
const { checkIntake } = require('./workflows/check-intake');
const { checkTaskSmart } = require('./workflows/check-task-smart');
const { classifyMatrix } = require('./workflows/classify-matrix');
const { decomposeTasks } = require('./workflows/decompose-tasks');
const { diagnoseDistribution } = require('./workflows/diagnose-distribution');
const { extractTasks } = require('./workflows/extract-tasks');
const { generateReport } = require('./workflows/generate-report');

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

function writeLog(logger, entry) {
  if (typeof logger === 'function') logger(entry);
  else if (logger && typeof logger.info === 'function') logger.info(entry);
}

function requireMutationSecurity(authBoundary) {
  return (request, response, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next();
    return authBoundary.requireSameOrigin(request, response, (originError) => {
      if (originError) return next(originError);
      return authBoundary.requireSessionCsrf(request, response, next);
    });
  };
}

function createApp({ modelClient, authBoundary, logger, now = Date.now } = {}) {
  if (
    !authBoundary
    || typeof authBoundary.sessionMiddleware !== 'function'
    || typeof authBoundary.router !== 'function'
    || typeof authBoundary.dailyTrackingRouter !== 'function'
    || typeof authBoundary.historyRouter !== 'function'
    || typeof authBoundary.requireAuth !== 'function'
    || typeof authBoundary.requireSameOrigin !== 'function'
    || typeof authBoundary.requireSessionCsrf !== 'function'
  ) {
    throw Object.assign(new Error('A complete authBoundary is required.'), {
      code: 'CONFIG_INVALID',
    });
  }
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.locals.modelClient = modelClient;

  app.use((_request, response, next) => {
    response.set({
      'Cache-Control': 'no-store',
      'Content-Security-Policy': CONTENT_SECURITY_POLICY,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    });
    next();
  });
  app.use('/api', (request, response, next) => {
    const startedAt = Date.now();
    request.requestId = randomUUID();
    response.set('X-Request-Id', request.requestId);
    response.once('finish', () => {
      writeLog(logger, {
        requestId: request.requestId,
        path: new URL(request.originalUrl, 'http://localhost').pathname,
        status: response.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });
    next();
  });
  app.use(express.json({ limit: '64kb', strict: true }));
  app.get('/api/health', (_request, response) => response.json({ status: 'ok' }));
  app.use(authBoundary.sessionMiddleware);
  app.use('/api/auth', authBoundary.router);
  app.use('/api/time-management', authBoundary.requireAuth);
  app.use('/api/time-management', requireMutationSecurity(authBoundary));
  app.use('/api/time-management/daily-tracking', authBoundary.dailyTrackingRouter);
  app.use('/api/time-management/history', authBoundary.historyRouter);
  app.post('/api/time-management/intake/check', (request, response, next) => {
    try {
      response.json(checkIntake({
        entries: request.body?.entries,
        requestBody: request.body,
      }));
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/time-management/tasks/decompose', async (request, response, next) => {
    try {
      response.json(await decomposeTasks({
        entries: request.body?.entries,
        modelClient,
        requestBody: request.body,
        now,
      }));
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/time-management/tasks/smart-check', (request, response, next) => {
    try {
      response.json(checkTaskSmart({
        tasks: request.body?.tasks,
        requestBody: request.body,
      }));
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/time-management/distribution/diagnose', (request, response, next) => {
    try {
      response.json(diagnoseDistribution({
        tasks: request.body?.tasks,
        requestBody: request.body,
      }));
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/time-management/goals/check', async (request, response, next) => {
    try {
      response.json(await checkGoals({
        goals: request.body?.goals,
        modelClient,
        requestBody: request.body,
      }));
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/time-management/tasks/extract', async (request, response, next) => {
    try {
      response.json(await extractTasks({
        goals: request.body?.goals,
        modelClient,
        requestBody: request.body,
        now,
      }));
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/time-management/matrix/classify', async (request, response, next) => {
    try {
      response.json(await classifyMatrix({
        tasks: request.body?.tasks,
        modelClient,
        requestBody: request.body,
      }));
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/time-management/report/generate', async (request, response, next) => {
    try {
      response.json(await generateReport({
        tasks: request.body?.tasks,
        matrix: request.body?.matrix,
        goals: request.body?.goals,
        distribution: request.body?.distribution,
        modelClient,
        requestBody: request.body,
        now,
      }));
    } catch (error) {
      next(error);
    }
  });
  app.use('/api', notFound);
  app.use(express.static(path.join(__dirname, '..', 'frontend')));
  app.use(problemHandler);

  return app;
}

module.exports = { createApp };
