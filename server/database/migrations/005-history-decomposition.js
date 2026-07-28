const migration = Object.freeze({
  version: 5,
  name: 'add history decomposition trace',
  async up(transaction) {
    await transaction.exec(`
      ALTER TABLE time_management_runs
        ADD COLUMN decomposition_json TEXT;
    `);
  },
});

module.exports = migration;
