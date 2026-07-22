const migration = Object.freeze({
  version: 1,
  name: 'create authentication and history tables',
  async up(transaction) {
    await transaction.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        normalized_username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        recovery_code_hash TEXT NOT NULL,
        recovery_code_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX users_normalized_username_unique
        ON users (normalized_username);

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        csrf_token_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX sessions_token_hash_unique
        ON sessions (token_hash);
      CREATE INDEX sessions_expires_at_index
        ON sessions (expires_at);
      CREATE INDEX sessions_user_id_index
        ON sessions (user_id);

      CREATE TABLE time_management_runs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        client_run_id TEXT NOT NULL,
        title TEXT NOT NULL,
        goals_json TEXT NOT NULL,
        tasks_json TEXT NOT NULL,
        matrix_json TEXT NOT NULL,
        report_json TEXT NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX time_management_runs_user_client_unique
        ON time_management_runs (user_id, client_run_id);
      CREATE INDEX time_management_runs_user_created_index
        ON time_management_runs (user_id, created_at DESC);
    `);
  },
});

module.exports = migration;
