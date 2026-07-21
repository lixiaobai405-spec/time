const migration = Object.freeze({
  version: 2,
  name: 'preserve username case for authentication',
  async up(transaction) {
    await transaction.run('UPDATE users SET normalized_username = username');
  },
});

module.exports = migration;
