const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForHealth(url, child, readStderr) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`server exited before health check: ${readStderr()}`);
    }

    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // The server may still be starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`server did not become healthy: ${readStderr()}`);
}

test('start.bat uses the project environment and loads .env safely', () => {
  const scriptPath = path.join(root, 'start.bat');
  assert.equal(fs.existsSync(scriptPath), true, 'start.bat should exist at project root');

  const script = fs.readFileSync(scriptPath, 'utf8');
  assert.match(script, /cd \/d "%~dp0"/i);
  assert.match(script, /\.conda\\node\.exe/i);
  assert.match(script, /if not exist "\.env"/i);
  assert.match(script, /--env-file=\.env/i);
  assert.match(script, /process\.env\.PORT/i);
  assert.match(script, /server\\index\.js/i);
  assert.match(script, /api\/health/i);
  assert.match(script, /Start-Process/i);
  assert.match(script, /TIME_ASSISTANT_NO_BROWSER/i);
  assert.doesNotMatch(script, /\btype\s+["']?\.env/i);
  assert.doesNotMatch(script, /MODEL_API_KEY/i);
});

test('start.bat uses Windows CRLF line endings', () => {
  const script = fs.readFileSync(path.join(root, 'start.bat'), 'utf8');
  assert.match(script, /\r\n/);
  assert.doesNotMatch(script.replaceAll('\r\n', ''), /\n/);

  const attribute = spawnSync(
    'git',
    ['check-attr', 'eol', '--', 'start.bat'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(attribute.status, 0);
  assert.match(attribute.stdout, /start\.bat: eol: crlf/);
});

test('start.bat is parsed by cmd.exe and reaches the server command', (t) => {
  const tempDirectory = fs.mkdtempSync(path.join(root, '.start-bat-test-'));
  const condaDirectory = path.join(tempDirectory, '.conda');
  const serverDirectory = path.join(tempDirectory, 'server');
  fs.mkdirSync(condaDirectory);
  fs.mkdirSync(serverDirectory);
  fs.copyFileSync(path.join(root, 'start.bat'), path.join(tempDirectory, 'start.bat'));
  fs.copyFileSync(process.execPath, path.join(condaDirectory, 'node.exe'));
  fs.writeFileSync(
    path.join(tempDirectory, '.env'),
    [
      'PORT=42671',
      'MODEL_API_BASE_URL=http://127.0.0.1:9',
      'MODEL_API_KEY=fake-batch-test-key',
      'MODEL_NAME=fake-batch-test-model',
      'DATABASE_PATH=fake-batch-test.sqlite',
      'SESSION_SECRET=fake-batch-session-secret-with-at-least-forty-eight-bytes',
      'SESSION_COOKIE_SECURE=false',
      'SESSION_MAX_AGE_MS=604800000',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.writeFileSync(
    path.join(serverDirectory, 'index.js'),
    "require('node:fs').writeFileSync('server-started.txt', 'ok');\n",
    'utf8',
  );

  t.after(() => {
    fs.rmSync(tempDirectory, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100,
    });
  });

  const environment = { ...process.env };
  for (const key of [
    'PORT',
    'MODEL_API_BASE_URL',
    'MODEL_API_KEY',
    'MODEL_NAME',
    'MODEL_TIMEOUT_MS',
    'DATABASE_PATH',
    'SESSION_SECRET',
    'SESSION_COOKIE_SECURE',
    'SESSION_MAX_AGE_MS',
  ]) {
    delete environment[key];
  }
  environment.TIME_ASSISTANT_NO_BROWSER = '1';

  const result = spawnSync(
    process.env.ComSpec || 'cmd.exe',
    ['/d', '/c', 'start.bat'],
    {
      cwd: tempDirectory,
      encoding: 'utf8',
      env: environment,
      timeout: 15_000,
      windowsHide: true,
    },
  );

  assert.equal(result.error, undefined);
  assert.equal(
    result.status,
    0,
    `start.bat failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.equal(
    fs.existsSync(path.join(tempDirectory, 'server-started.txt')),
    true,
    `start.bat never reached server/index.js\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
});

test('.env variants are ignored while example templates remain trackable', () => {
  const isIgnored = (name) => spawnSync(
    'git',
    ['check-ignore', '--no-index', '--quiet', name],
    { cwd: root },
  ).status === 0;

  for (const name of ['.env', '.env.local', '.env.development', '.env.production', '.env.test']) {
    assert.equal(isIgnored(name), true, `${name} must be ignored`);
  }
  for (const name of ['.env.example', '.env.test.example']) {
    assert.equal(isIgnored(name), false, `${name} must stay trackable`);
  }
});

test('README documents one-click startup without committing .env', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /start\.bat/i);
  assert.match(readme, /\.env\.example/);
  assert.match(readme, /不要.{0,20}提交.{0,20}\.env/);
});

test('the Node env-file startup command works with fake model settings', async (t) => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'time-start-test-'));
  const envPath = path.join(tempDirectory, 'fake.env');
  const port = await getFreePort();
  fs.writeFileSync(
    envPath,
    [
      `PORT=${port}`,
      'MODEL_API_BASE_URL=http://127.0.0.1:9',
      'MODEL_API_KEY=fake-start-script-key',
      'MODEL_NAME=fake-start-script-model',
      'MODEL_TIMEOUT_MS=1000',
      `DATABASE_PATH=${path.join(tempDirectory, 'test.sqlite')}`,
      'SESSION_SECRET=fake-start-session-secret-with-at-least-forty-eight-bytes',
      'SESSION_COOKIE_SECURE=false',
      'SESSION_MAX_AGE_MS=604800000',
      '',
    ].join('\n'),
    'utf8',
  );

  const child = spawn(
    process.execPath,
    [`--env-file=${envPath}`, 'server/index.js'],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  t.after(async () => {
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    fs.rmSync(tempDirectory, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100,
    });
  });

  const response = await waitForHealth(
    `http://127.0.0.1:${port}/api/health`,
    child,
    () => stderr,
  );
  assert.deepEqual(await response.json(), { status: 'ok' });
});
