const crypto = require('node:crypto');

const { httpProblem } = require('../http/problem');
const { normalizeUsername, validateUsername } = require('./username');

const DUMMY_PASSWORD_HASH = [
  'scrypt',
  'v=1',
  'N=32768',
  'r=8',
  'p=3',
  Buffer.alloc(16).toString('base64url'),
  Buffer.alloc(64).toString('base64url'),
].join('$');
const DUMMY_RECOVERY_CODE_HASH = recoveryCodeHashForDummy();

function recoveryCodeHashForDummy() {
  return crypto
    .createHash('sha256')
    .update('0'.repeat(48), 'ascii')
    .digest('base64url');
}

function inputProblem() {
  return httpProblem('INPUT_INVALID', '用户名或密码格式不正确。', 400);
}

function invalidCredentials() {
  return httpProblem('AUTH_INVALID_CREDENTIALS', '用户名或密码不正确。', 401);
}

function createAuthService({
  database,
  userRepository,
  sessionRepository,
  passwordService,
  recoveryCodeService,
  randomUUID = crypto.randomUUID,
}) {
  return Object.freeze({
    async register({ username, password }) {
      let displayUsername;
      let normalizedUsername;
      try {
        displayUsername = validateUsername(username);
        normalizedUsername = normalizeUsername(displayUsername);
        passwordService.validatePassword(password, normalizedUsername);
      } catch {
        throw inputProblem();
      }

      const passwordHash = await passwordService.hashPassword(password);
      const recoveryCode = recoveryCodeService.generateRecoveryCode();
      const recoveryCodeHash = recoveryCodeService.hashRecoveryCode(recoveryCode);
      const id = randomUUID();
      let user;
      try {
        user = await database.transaction((transaction) => userRepository.createUser(transaction, {
          id,
          username: displayUsername,
          passwordHash,
          recoveryCodeHash,
        }));
      } catch (error) {
        if (error?.code === 'AUTH_USERNAME_TAKEN') {
          throw httpProblem('AUTH_USERNAME_TAKEN', '该用户名已被使用。', 409);
        }
        throw error;
      }
      return { user: { id: user.id, username: user.username }, recoveryCode };
    },

    async login({ username, password }) {
      let user = null;
      try {
        user = await userRepository.findByNormalizedUsername(normalizeUsername(username));
      } catch {
        // Invalid and unknown usernames share the same response and scrypt work.
      }
      const passwordHash = user?.passwordHash || DUMMY_PASSWORD_HASH;
      const valid = typeof password === 'string'
        && await passwordService.verifyPassword(password, passwordHash);
      if (!user || !valid) throw invalidCredentials();
      return { id: user.id, username: user.username };
    },

    async resetWithRecovery({ username, recoveryCode: submittedCode, newPassword }) {
      let normalizedUsername;
      try {
        normalizedUsername = normalizeUsername(username);
      } catch {
        throw invalidCredentials();
      }

      let user = null;
      try {
        user = await userRepository.findByNormalizedUsername(normalizedUsername);
      } catch {
        // Invalid and unknown usernames share the same recovery-code work.
      }
      const recoveryValid = recoveryCodeService.verifyRecoveryCode(
        submittedCode,
        user?.recoveryCodeHash || DUMMY_RECOVERY_CODE_HASH,
      );
      if (!user || !recoveryValid) throw invalidCredentials();

      try {
        passwordService.validatePassword(newPassword, normalizedUsername);
      } catch {
        throw inputProblem();
      }

      const passwordHash = await passwordService.hashPassword(newPassword);
      const recoveryCode = recoveryCodeService.generateRecoveryCode();
      const recoveryCodeHash = recoveryCodeService.hashRecoveryCode(recoveryCode);

      await database.transaction(async (transaction) => {
        const current = await userRepository.findById(user.id, transaction);
        if (
          !current
          || !recoveryCodeService.verifyRecoveryCode(submittedCode, current.recoveryCodeHash)
        ) {
          throw invalidCredentials();
        }
        const update = await userRepository.updateCredentials(transaction, {
          userId: current.id,
          passwordHash,
          recoveryCodeHash,
        });
        if (update.changes !== 1) throw invalidCredentials();
        await sessionRepository.destroyAllForUser(transaction, current.id);
      });

      return { recoveryCode };
    },

    async rotateRecoveryCode({ userId, password: submittedPassword }) {
      const user = await userRepository.findById(userId);
      const passwordHash = user?.passwordHash || DUMMY_PASSWORD_HASH;
      const valid = typeof submittedPassword === 'string'
        && await passwordService.verifyPassword(submittedPassword, passwordHash);
      if (!user || !valid) throw invalidCredentials();

      const recoveryCode = recoveryCodeService.generateRecoveryCode();
      const recoveryCodeHash = recoveryCodeService.hashRecoveryCode(recoveryCode);
      await database.transaction(async (transaction) => {
        const update = await userRepository.rotateRecoveryCode(transaction, {
          userId: user.id,
          expectedPasswordHash: user.passwordHash,
          recoveryCodeHash,
        });
        if (update.changes !== 1) throw invalidCredentials();
      });
      return { recoveryCode };
    },
  });
}

module.exports = { createAuthService };
