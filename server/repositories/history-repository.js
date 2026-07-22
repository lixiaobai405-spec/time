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
  schema_version, created_at, updated_at
`;

function createHistoryRepository({
  database,
  now = () => new Date().toISOString(),
  randomUUID = crypto.randomUUID,
}) {
  return Object.freeze({
    async save({ userId, snapshot }) {
      const ownerId = requireUserId(userId);
      const value = validateHistorySnapshot(snapshot);
      const id = randomUUID();
      if (!UUID.test(id)) throw new Error('History UUID source returned an invalid result.');
      const timestamp = now();

      return database.transaction(async (transaction) => {
        const inserted = await transaction.run(
          `INSERT INTO time_management_runs (
            id, user_id, client_run_id, title, goals_json, tasks_json, matrix_json,
            report_json, schema_version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
