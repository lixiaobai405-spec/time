const { httpProblem } = require('../http/problem');

function originError() {
  return httpProblem('AUTH_CSRF_INVALID', '请求来源验证失败，请刷新后重试。', 403);
}

function requireSameOrigin() {
  return (request, _response, next) => {
    const origin = request.get('origin');
    const host = request.get('host');
    if (!origin || !host) return next(originError());
    try {
      const parsed = new URL(origin);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.host !== host) {
        return next(originError());
      }
    } catch {
      return next(originError());
    }
    next();
  };
}

module.exports = { requireSameOrigin };
