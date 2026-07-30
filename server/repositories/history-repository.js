const crypto = require('node:crypto');

const {
  HISTORY_SCHEMA_VERSION,
  UUID_PATTERN,
  decodeStoredSnapshot,
  validateHistorySnapshot,
} = require('../history/contracts');
const {
  decodeHistoryCursor,
  encodeHistoryCursor,
  normalizeHistoryLimit,
} = require('../history/cursor');

const UUID = new RegExp(UUID_PATTERN);

function authRequired() {
  return Object.assign(new Error('Authenticated userId is required.'), {
    code: 'AUTH_REQUIRED',
    status: 401,
    expose: true,
  });
}

function requireUserId(userId) {
  if (typeof userId !== 'string' || !UUID.test(userId)) throw authRequired();
  return userId;
}

function inputInvalid() {
  return Object.assign(new Error('历史补写格式不正确。'), {
    code: 'INPUT_INVALID',
    status: 400,
    expose: true,
  });
}

function coachingConflict() {
  return Object.assign(new Error('教练诊断结果与已保存历史冲突。'), {
    code: 'HISTORY_COACHING_CONFLICT',
    status: 409,
    expose: true,
  });
}

function mapSummary(row) {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDetail(row) {
  if (!row) return null;
  const snapshot = decodeStoredSnapshot({
    clientRunId: row.client_run_id,
    title: row.title,
    goalsJson: row.goals_json,
    tasksJson: row.tasks_json,
    matrixJson: row.matrix_json,
    reportJson: row.report_json,
    distributionJson: row.distribution_json,
    decompositionJson: row.decomposition_json,
    schemaVersion: row.schema_version,
  });
  return {
    id: row.id,
    ...snapshot,
    schemaVersion: row.schema_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const DETAIL_COLUMNS = `
  id, client_run_id, title, goals_json, tasks_json, matrix_json, report_json,
  distribution_json, decomposition_json, schema_version, created_at, updated_at
`;

function createHistoryRepository({
  database,
  now = () => new Date().toISOString(),
  randomUUID = crypto.randomUUID,
}) {
  return Object.freeze({
    async save({ userId, snapshot }) {
      const ownerId = requireUserId(userId);
      const value = validateHistorySnapshot(snapshot, { dueMode: 'write' });
      const id = randomUUID();
      if (!UUID.test(id)) throw new Error('History UUID source returned an invalid result.');
      const timestamp = now();

      return database.transaction(async (transaction) => {
        const inserted = await transaction.run(
          `INSERT INTO time_management_runs (
            id, user_id, client_run_id, title, goals_json, tasks_json, matrix_json,
            report_json, distribution_json, decomposition_json, schema_version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, client_run_id) DO NOTHING`,
          [
            id,
            ownerId,
            value.clientRunId,
            value.title,
            JSON.stringify(value.goals),
            JSON.stringify(value.tasks),
            JSON.stringify(value.matrix),
            JSON.stringify(value.report),
            JSON.stringify(value.distribution),
            value.decomposition == null ? null : JSON.stringify(value.decomposition),
            HISTORY_SCHEMA_VERSION,
            timestamp,
            timestamp,
          ],
        );
        const row = await transaction.get(
          `SELECT ${DETAIL_COLUMNS}
           FROM time_management_runs
           WHERE user_id = ? AND client_run_id = ?`,
          [ownerId, value.clientRunId],
        );
        return { created: inserted.changes === 1, item: mapDetail(row) };
      });
    },

    async appendCoaching({
      userId,
      id,
      decompositionId,
      analysisId,
      coachingStage,
    } = {}) {
      const ownerId = requireUserId(userId);
      if (
        typeof id !== 'string'
        || !UUID.test(id)
        || typeof decompositionId !== 'string'
        || !UUID.test(decompositionId)
        || typeof analysisId !== 'string'
        || !UUID.test(analysisId)
        || !coachingStage
        || coachingStage.analysisId !== analysisId
      ) {
        throw inputInvalid();
      }

      return database.transaction(async transaction => {
        const row = await transaction.get(
          `SELECT ${DETAIL_COLUMNS}
           FROM time_management_runs
           WHERE id = ? AND user_id = ? AND schema_version = 3`,
          [id, ownerId],
        );
        if (!row) return null;

        const detail = mapDetail(row);
        if (detail.decomposition?.decompositionId !== decompositionId) {
          throw coachingConflict();
        }
        const existing = detail.decomposition.stages.find(
          stage => stage.name === 'coaching-analysis',
        );
        if (existing) {
          if (existing.analysisId !== analysisId) throw coachingConflict();
          return { updated: false, item: detail };
        }

        const mergedDecomposition = {
          ...detail.decomposition,
          stages: [...detail.decomposition.stages, coachingStage],
        };
        const {
          id: ignoredId,
          schemaVersion: ignoredVersion,
          createdAt: ignoredCreatedAt,
          updatedAt: ignoredUpdatedAt,
          ...snapshot
        } = detail;
        validateHistorySnapshot(
          { ...snapshot, decomposition: mergedDecomposition },
          { schemaVersion: 3 },
        );
        const timestamp = now();
        await transaction.run(
          `UPDATE time_management_runs
           SET decomposition_json = ?, updated_at = ?
           WHERE id = ? AND user_id = ? AND schema_version = 3`,
          [JSON.stringify(mergedDecomposition), timestamp, id, ownerId],
        );
        const updated = await transaction.get(
          `SELECT ${DETAIL_COLUMNS}
           FROM time_management_runs
           WHERE id = ? AND user_id = ?`,
          [id, ownerId],
        );
        return { updated: true, item: mapDetail(updated) };
      });
    },

    async list({ userId, limit, cursor } = {}) {
      const ownerId = requireUserId(userId);
      const pageSize = normalizeHistoryLimit(limit);
      const boundary = decodeHistoryCursor(cursor);
      const params = [ownerId];
      let cursorSql = '';
      if (boundary) {
        cursorSql = 'AND (created_at < ? OR (created_at = ? AND id < ?))';
        params.push(boundary.createdAt, boundary.createdAt, boundary.id);
      }
      params.push(pageSize + 1);
      const rows = await database.all(
        `SELECT id, title, created_at, updated_at
         FROM time_management_runs
         WHERE user_id = ?
         ${cursorSql}
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
        params,
      );
      const hasMore = rows.length > pageSize;
      const items = rows.slice(0, pageSize).map(mapSummary);
      const last = items.at(-1);
      return {
        items,
        nextCursor: hasMore && last
          ? encodeHistoryCursor({ createdAt: last.createdAt, id: last.id })
          : null,
      };
    },

    async listTasksCreatedBetween({ userId, startUtc, endUtc } = {}) {
      const ownerId = requireUserId(userId);
      const hasStart = startUtc !== undefined && startUtc !== null;
      if (
        typeof endUtc !== 'string'
        || Number.isNaN(Date.parse(endUtc))
        || (
          hasStart
          && (
            typeof startUtc !== 'string'
            || Number.isNaN(Date.parse(startUtc))
            || startUtc >= endUtc
          )
        )
      ) {
        throw Object.assign(new Error('History date range is invalid.'), {
          code: 'INPUT_INVALID',
          status: 400,
          expose: true,
        });
      }
      const lowerBoundSql = hasStart ? 'AND created_at >= ?' : '';
      const params = hasStart
        ? [ownerId, startUtc, endUtc]
        : [ownerId, endUtc];
      const rows = await database.all(
        `SELECT ${DETAIL_COLUMNS}
         FROM time_management_runs
         WHERE user_id = ? ${lowerBoundSql} AND created_at < ?
         ORDER BY created_at ASC, id ASC`,
        params,
      );
      return {
        historyCount: rows.length,
        tasks: rows.flatMap((row) => mapDetail(row).tasks),
      };
    },

    async getById({ userId, id } = {}) {
      const ownerId = requireUserId(userId);
      if (typeof id !== 'string' || !UUID.test(id)) return null;
      const row = await database.get(
        `SELECT ${DETAIL_COLUMNS}
         FROM time_management_runs
         WHERE id = ? AND user_id = ?`,
        [id, ownerId],
      );
      return mapDetail(row);
    },

    async deleteById({ userId, id } = {}) {
      const ownerId = requireUserId(userId);
      if (typeof id !== 'string' || !UUID.test(id)) return false;
      const result = await database.run(
        'DELETE FROM time_management_runs WHERE id = ? AND user_id = ?',
        [id, ownerId],
      );
      return result.changes === 1;
    },
  });
}

module.exports = { createHistoryRepository };
