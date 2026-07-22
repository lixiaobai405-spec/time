const { createApp } = require('./app');
const { loadConfig } = require('./config');
const { createModelClient } = require('./model/model-client');
const { createRuntime } = require('./runtime');

async function main() {
  const config = loadConfig(process.env);
  const runtime = await createRuntime(config);
  const app = createApp({
    modelClient: createModelClient(config),
    authBoundary: runtime.authBoundary,
  });

  const server = app.listen(config.port, '127.0.0.1', () => {
    process.stdout.write(`Time assistant listening on http://127.0.0.1:${config.port}\n`);
  });
  server.once('error', async () => {
    await runtime.close().catch(() => undefined);
  });
}

main().catch((error) => {
  const detail = error?.message ? `: ${error.message}` : '';
  process.stderr.write(`Time assistant failed to start${detail}.\n`);
  process.exitCode = 1;
});
