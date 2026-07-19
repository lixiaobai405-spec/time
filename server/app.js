const express = require('express');
const path = require('node:path');

const { notFound, problemHandler } = require('./http/problem');
const { checkGoals } = require('./workflows/check-goals');
const { classifyMatrix } = require('./workflows/classify-matrix');
const { extractTasks } = require('./workflows/extract-tasks');
const { generateReport } = require('./workflows/generate-report');

function createApp({ modelClient } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.locals.modelClient = modelClient;

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
