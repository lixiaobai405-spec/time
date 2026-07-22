const fs = require('node:fs');
const path = require('node:path');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  if (typeof process.loadEnvFile !== 'function') {
    throw Object.assign(new Error('This project requires Node.js 20.12+ to load .env safely.'), {
      code: 'NODE_VERSION_UNSUPPORTED',
    });
  }
  process.loadEnvFile(envPath);
}

require('../server/index');
