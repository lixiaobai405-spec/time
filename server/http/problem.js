const { randomUUID } = require('node:crypto');

function httpProblem(code, message, status) {
  return Object.assign(new Error(message), { code, status, expose: true });
}

function notFound(_request, _response, next) {
  next(httpProblem('NOT_FOUND', '请求的接口不存在。', 404));
}

function problemHandler(error, request, response, _next) {
  let status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599
    ? error.status
    : 500;
  let normalizedError = error;
  if (error.type === 'entity.too.large') {
    status = 413;
    normalizedError = httpProblem('PAYLOAD_TOO_LARGE', '请求内容过大。', status);
  } else if (error.type === 'entity.parse.failed') {
    status = 400;
    normalizedError = httpProblem('INVALID_JSON', 'JSON 格式不正确。', status);
  }

  const exposed = normalizedError.expose === true || status < 500;
  const code = exposed && typeof normalizedError.code === 'string' && normalizedError.code
    ? normalizedError.code
    : 'INTERNAL_ERROR';
  const message = exposed && typeof normalizedError.message === 'string'
    ? normalizedError.message
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
