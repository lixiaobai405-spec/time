const express = require('express');

const { httpProblem } = require('../http/problem');
const { HISTORY_SNAPSHOT_MAX_BYTES } = require('./limits');

function historyNotFound() {
  return httpProblem('HISTORY_NOT_FOUND', '历史记录不存在。', 404);
}

function historySaveFailed() {
  return httpProblem('HISTORY_SAVE_FAILED', '报告已生成，但历史保存失败，请重试。', 500);
}

function databaseUnavailable() {
  return httpProblem('DATABASE_UNAVAILABLE', '历史数据库暂时不可用，请稍后重试。', 503);
}

function isInputError(error) {
  return error?.code === 'INPUT_INVALID' && error.status === 400;
}

function sendHistoryJson(response, value, status = 200) {
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > HISTORY_SNAPSHOT_MAX_BYTES) {
    throw httpProblem(
      'HISTORY_RESPONSE_TOO_LARGE',
      '历史数据暂时无法返回。',
      500,
    );
  }
  return response.status(status).type('application/json').send(serialized);
}

function createHistoryRouter({ historyRepository } = {}) {
  if (
    !historyRepository
    || typeof historyRepository.save !== 'function'
    || typeof historyRepository.list !== 'function'
    || typeof historyRepository.getById !== 'function'
    || typeof historyRepository.appendCoaching !== 'function'
    || typeof historyRepository.deleteById !== 'function'
  ) {
    throw Object.assign(new Error('A complete historyRepository is required.'), {
      code: 'CONFIG_INVALID',
    });
  }

  const router = express.Router();

  router.post('/', async (request, response, next) => {
    try {
      const result = await historyRepository.save({
        userId: request.auth.userId,
        snapshot: request.body,
      });
      sendHistoryJson(response, result.item, result.created ? 201 : 200);
    } catch (error) {
      next(isInputError(error) ? error : historySaveFailed());
    }
  });

  router.get('/', async (request, response, next) => {
    try {
      sendHistoryJson(response, await historyRepository.list({
        userId: request.auth.userId,
        cursor: request.query.cursor,
        limit: request.query.limit,
      }));
    } catch (error) {
      next(isInputError(error) ? error : databaseUnavailable());
    }
  });

  router.get('/:id', async (request, response, next) => {
    try {
      const item = await historyRepository.getById({
        userId: request.auth.userId,
        id: request.params.id,
      });
      if (!item) return next(historyNotFound());
      return sendHistoryJson(response, item);
    } catch {
      return next(databaseUnavailable());
    }
  });

  router.patch('/:id/coaching-analysis', async (request, response, next) => {
    try {
      const keys = request.body && typeof request.body === 'object'
        ? Object.keys(request.body).sort()
        : [];
      if (
        keys.length !== 3
        || keys[0] !== 'analysisId'
        || keys[1] !== 'coachingStage'
        || keys[2] !== 'decompositionId'
      ) {
        throw httpProblem('INPUT_INVALID', '历史补写格式不正确。', 400);
      }
      const result = await historyRepository.appendCoaching({
        userId: request.auth.userId,
        id: request.params.id,
        decompositionId: request.body.decompositionId,
        analysisId: request.body.analysisId,
        coachingStage: request.body.coachingStage,
      });
      if (!result) return next(historyNotFound());
      return sendHistoryJson(response, result.item);
    } catch (error) {
      if (isInputError(error) || error?.code === 'HISTORY_COACHING_CONFLICT') {
        return next(error);
      }
      return next(databaseUnavailable());
    }
  });

  router.delete('/:id', async (request, response, next) => {
    try {
      const deleted = await historyRepository.deleteById({
        userId: request.auth.userId,
        id: request.params.id,
      });
      if (!deleted) return next(historyNotFound());
      return response.status(204).end();
    } catch {
      return next(databaseUnavailable());
    }
  });

  return router;
}

module.exports = { createHistoryRouter };
