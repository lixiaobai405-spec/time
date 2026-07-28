const migration = Object.freeze({
  version: 4,
  name: 'add history distribution snapshot',
  async up(transaction) {
    await transaction.exec(`
      ALTER TABLE time_management_runs
        ADD COLUMN distribution_json TEXT;
    `);
  },
});

module.exports = migration;
