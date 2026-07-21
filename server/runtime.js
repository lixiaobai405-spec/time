const session = require('express-session');

const { createAuthService } = require('./auth/auth-service');
const { createRequireAuth } = require('./auth/middleware');
const { createAuthRateLimiters } = require('./auth/rate-limiters');
const { createAuthRouter } = require('./auth/router');
const { openDatabase } = require('./database/sqlite');
const { createSessionRepository } = require('./repositories/session-repository');
const { createUserRepository } = require('./repositories/user-repository');
const {
  createPreAuthCsrfToken,
  createSessionCsrfToken,
  createSessionCsrfTokenHash,
  requirePreAuthCsrf,
  requireSessionCsrf,
} = require('./security/csrf');
const password = require('./security/password');
const recoveryCode = require('./security/recovery-code');
const { requireSameOrigin } = require('./security/origin');
const { generateSessionId } = require('./security/token-hash');
const { SqliteSessionStore } = require('./session/sqlite-session-store');

function includeSessionMaxAge(sessionMiddleware, sessionMaxAgeMs) {
  const maxAgeSeconds = Math.floor(sessionMaxAgeMs / 1000);
  return (request, response, next) => {
    const setHeader = response.setHeader.bind(response);
    response.setHeader = (name, value) => {
      if (String(name).toLowerCase() !== 'set-cookie') return setHeader(name, value);
      const values = Array.isArray(value) ? value : [value];
      const updated = values.map((item) => {
        if (
          typeof item !== 'string'
          || !item.startsWith('time.sid=')
          || /;\s*Max-Age=/i.test(item)
          || /Expires=Thu, 01 Jan 1970/i.test(item)
        ) {
          return item;
        }
        return `${item}; Max-Age=${maxAgeSeconds}`;
      });
      return setHeader(name, Array.isArray(value) ? updated : updated[0]);
    };
    sessionMiddleware(request, response, next);
  };
}

async function createRuntime(config) {
  const database = await openDatabase({ filename: config.databasePath });
  const userRepository = createUserRepository({ database });
  const sessionRepository = createSessionRepository({ database });
  const sessionCookie = Object.freeze({
    httpOnly: true,
    secure: config.sessionCookieSecure,
    sameSite: 'strict',
    path: '/',
    maxAge: config.sessionMaxAgeMs,
  });
  const store = new SqliteSessionStore({
    repository: sessionRepository,
    sessionMaxAgeMs: config.sessionMaxAgeMs,
    cookie: sessionCookie,
    createCsrfTokenHash: (sessionId) => createSessionCsrfTokenHash(
      config.sessionSecret,
      sessionId,
    ),
  });
  const expressSessionMiddleware = session({
    name: 'time.sid',
    secret: config.sessionSecret,
    genid: () => generateSessionId(),
    resave: false,
    saveUninitialized: false,
    rolling: false,
    store,
    cookie: sessionCookie,
  });
  const sessionMiddleware = includeSessionMaxAge(
    expressSessionMiddleware,
    config.sessionMaxAgeMs,
  );
  const passwordService = Object.freeze({
    hashPassword: password.hashPassword,
    validatePassword: password.validatePassword,
    verifyPassword: password.verifyPassword,
  });
  const authService = createAuthService({
    database,
    userRepository,
    passwordService,
    recoveryCodeService: recoveryCode,
  });
  const requireAuth = createRequireAuth({ userRepository });
  const sessionCsrf = requireSessionCsrf({
    secret: config.sessionSecret,
    sessionRepository,
  });
  const router = createAuthRouter({
    authService,
    createPreAuthCsrfToken: () => createPreAuthCsrfToken(config.sessionSecret),
    createSessionCsrfToken: (sessionId) => createSessionCsrfToken(
      config.sessionSecret,
      sessionId,
    ),
    limiters: createAuthRateLimiters(),
    requireAuth,
    requirePreAuthCsrf: requirePreAuthCsrf({ secret: config.sessionSecret }),
    requireSameOrigin: requireSameOrigin(),
    requireSessionCsrf: sessionCsrf,
    sessionCookie,
  });
  const authBoundary = Object.freeze({
    router,
    requireAuth,
    requireSessionCsrf: sessionCsrf,
    sessionMiddleware,
  });

  return Object.freeze({
    authBoundary,
    database,
    async close() {
      await database.close();
    },
  });
}

module.exports = { createRuntime };
