const express = require('express');

const { httpProblem } = require('../http/problem');

function databaseUnavailable() {
  return httpProblem(
    'DAILY_TRACKING_UNAVAILABLE',
    '每日跟踪暂时不可用，请稍后重试。',
    503,
  );
}

function isExpected(error) {
  return ['INPUT_INVALID', 'DAILY_TRACKING_CONFLICT', 'DAILY_TRACKING_DATE_CHANGED']
    .includes(error?.code);
}

function createDailyTrackingRouter({ dailyTrackingService } = {}) {
  if (
    !dailyTrackingService
    || typeof dailyTrackingService.getToday !== 'function'
    || typeof dailyTrackingService.saveToday !== 'function'
  ) {
    throw Object.assign(new Error('A complete dailyTrackingService is required.'), {
      code: 'CONFIG_INVALID',
    });
  }
  const router = express.Router();

  router.get('/today', async (request, response, next) => {
    try {
      response.json(await dailyTrackingService.getToday({
        userId: request.auth.userId,
      }));
    } catch (error) {
      next(isExpected(error) ? error : databaseUnavailable());
    }
  });

  router.put('/today', async (request, response, next) => {
    try {
      response.json(await dailyTrackingService.saveToday({
        userId: request.auth.userId,
        snapshot: request.body,
      }));
    } catch (error) {
      next(isExpected(error) ? error : databaseUnavailable());
    }
  });

  return router;
}

module.exports = { createDailyTrackingRouter };
