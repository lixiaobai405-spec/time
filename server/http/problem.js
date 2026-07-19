const { randomUUID } = require('node:crypto');

function httpProblem(code, message, status) {
  return Object.assign(new Error(message), { code, status, expose: true });
}

function notFound(_request, _response, next) {
  next(httpProblem('NOT_FOUND', '请求的接口不存在。', 404));
}

function problemHandler(error, request, response, _next) {
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599
    ? error.status
    : 500;
  const exposed = error.expose === true || status < 500;
  const code = typeof error.code === 'string' && error.code ? error.code : 'INTERNAL_ERROR';
  const message = exposed && typeof error.message === 'string'
    ? error.message
    : '服务暂时不可用，请稍后重试。';

  response.status(status).json({
    error: {
      code,
      message,
      requestId: request.requestId || randomUUID(),
    },
  });
}

module.exports = { httpProblem, notFound, problemHandler };
