const { createApp } = require('./app');
const { loadConfig } = require('./config');

const config = loadConfig(process.env);
const app = createApp({ modelClient: null });

app.listen(config.port, '127.0.0.1', () => {
  process.stdout.write(`Time assistant listening on http://127.0.0.1:${config.port}\n`);
});
