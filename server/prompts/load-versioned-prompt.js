const crypto = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const DEFINITIONS = Object.freeze({
  'decomposition.coach-analysis': Object.freeze({
    version: '1.1.0',
    relativePath: 'decomposition/coach-analysis.v1.1.md',
  }),
  'decomposition.task-generation': Object.freeze({
    version: '1.1.0',
    relativePath: 'decomposition/task-generation.v1.1.md',
  }),
});

const CACHE = new Map();

function promptError(message) {
  return Object.assign(new Error(message), { code: 'PROMPT_INVALID' });
}

function loadVersionedPrompt(promptId) {
  if (CACHE.has(promptId)) return CACHE.get(promptId);
  const definition = DEFINITIONS[promptId];
  if (!definition) throw promptError('unknown versioned prompt');
  const filename = path.join(__dirname, '..', '..', 'prompts', definition.relativePath);
  const text = readFileSync(filename, 'utf8').trim();
  if (!text) throw promptError('versioned prompt is empty');
  const value = Object.freeze({
    id: promptId,
    version: definition.version,
    sha256: crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
    text,
  });
  CACHE.set(promptId, value);
  return value;
}

module.exports = { loadVersionedPrompt };
