const express = require('express');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

const { notFound, problemHandler } = require('./http/problem');
const { checkGoals } = require('./workflows/check-goals');
const { classifyMatrix } = require('./workflows/classify-matrix');
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

function createApp({ modelClient, logger, now = Date.now } = {}) {
  const app = express();
  app.disable('x-powered-by');
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
        modelClient,
        requestBody: request.body,
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
