const { randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const sqlite3 = require('sqlite3');

const DEFAULT_BACKUP_PATH = '/var/backups/time/time-management-latest.sqlite';

function openSqlite(filename, mode) {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(filename, mode, (error) => {
      if (error) reject(error);
      else resolve(database);
    });
  });
}

function closeSqlite(database) {
  return new Promise((resolve, reject) => {
    database.close((error) => (error ? reject(error) : resolve()));
  });
}

function backupSqlite(database, destination) {
  return new Promise((resolve, reject) => {
    const backup = database.backup(destination, (initializeError) => {
      if (initializeError) return reject(initializeError);
      backup.step(-1, (stepError) => {
        backup.finish((finishError) => {
          if (stepError) reject(stepError);
          else if (finishError) reject(finishError);
          else resolve();
        });
      });
    });
  });
}

function getSqlite(database, sql) {
  return new Promise((resolve, reject) => {
    database.get(sql, (error, row) => (error ? reject(error) : resolve(row)));
  });
}

async function verifyDatabaseIntegrity(filename) {
  const database = await openSqlite(filename, sqlite3.OPEN_READWRITE);
  try {
    const journal = await getSqlite(database, 'PRAGMA journal_mode = DELETE');
    if (!journal || journal.journal_mode !== 'delete') {
      throw new Error('Backup journal normalization failed');
    }
    const row = await getSqlite(database, 'PRAGMA integrity_check');
    if (!row || row.integrity_check !== 'ok') {
      throw new Error('Database integrity check failed');
    }
  } finally {
    await closeSqlite(database).catch(() => undefined);
  }
}

async function removeTemporaryDatabaseFiles(filename) {
  await Promise.all([
    filename,
    `${filename}-wal`,
    `${filename}-shm`,
    `${filename}-journal`,
  ].map((candidate) => fs.rm(candidate, { force: true }).catch(() => undefined)));
}

async function syncFile(filename) {
  const handle = await fs.open(filename, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function createDatabaseBackup({ databasePath, backupPath = DEFAULT_BACKUP_PATH }) {
  if (typeof databasePath !== 'string' || !databasePath.trim()) {
    throw new TypeError('DATABASE_PATH is required');
  }
  if (typeof backupPath !== 'string' || !backupPath.trim()) {
    throw new TypeError('Backup path is required');
  }

  const sourcePath = path.resolve(databasePath.trim());
  const destinationPath = path.resolve(backupPath.trim());
  if (sourcePath === destinationPath) throw new Error('Backup path must differ from database path');
  const sourceStat = await fs.stat(sourcePath);
  if (!sourceStat.isFile()) throw new Error('Database path must be a file');

  const destinationDirectory = path.dirname(destinationPath);
  await fs.mkdir(destinationDirectory, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await fs.chmod(destinationDirectory, 0o700);
  const temporaryPath = path.join(
    destinationDirectory,
    `.${path.basename(destinationPath)}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`,
  );

  let source;
  try {
    source = await openSqlite(sourcePath, sqlite3.OPEN_READONLY);
    await backupSqlite(source, temporaryPath);
    await closeSqlite(source);
    source = null;
    await verifyDatabaseIntegrity(temporaryPath);
    await fs.chmod(temporaryPath, 0o600);
    await syncFile(temporaryPath);
    await fs.rename(temporaryPath, destinationPath);
    return Object.freeze({ backupPath: destinationPath });
  } catch (error) {
    if (source) await closeSqlite(source).catch(() => undefined);
    await removeTemporaryDatabaseFiles(temporaryPath);
    throw error;
  }
}

async function main() {
  try {
    await createDatabaseBackup({
      databasePath: process.env.DATABASE_PATH,
      backupPath: process.argv[2] || DEFAULT_BACKUP_PATH,
    });
    process.stdout.write('Database backup completed successfully.\n');
  } catch {
    process.stderr.write('Database backup failed.\n');
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  DEFAULT_BACKUP_PATH,
  createDatabaseBackup,
  verifyDatabaseIntegrity,
};
