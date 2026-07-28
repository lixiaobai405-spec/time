const migration = Object.freeze({
  version: 3,
  name: 'create account daily tracking table',
  async up(transaction) {
    await transaction.exec(`
      CREATE TABLE daily_tracking_days (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        tracking_date TEXT NOT NULL,
        tasks_json TEXT NOT NULL,
        tracking_json TEXT NOT NULL,
        removed_task_ids_json TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX daily_tracking_days_user_date_unique
        ON daily_tracking_days (user_id, tracking_date);
    `);
  },
});

module.exports = migration;
