const { createApp } = require('./app');
const { loadConfig } = require('./config');
const { createModelClient } = require('./model/model-client');

const config = loadConfig(process.env);
const app = createApp({ modelClient: createModelClient(config) });

app.listen(config.port, '127.0.0.1', () => {
  process.stdout.write(`Time assistant listening on http://127.0.0.1:${config.port}\n`);
});
