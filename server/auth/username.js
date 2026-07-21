function inputError() {
  return Object.assign(
    new Error('Username must contain 3 to 32 ASCII letters, numbers, or underscores.'),
    { code: 'INPUT_INVALID' },
  );
}

function validateUsername(value) {
  if (typeof value !== 'string') throw inputError();
  const display = value.trim();
  if (!/^[A-Za-z0-9_]{3,32}$/.test(display)) throw inputError();
  return display;
}

function normalizeUsername(value) {
  return validateUsername(value).toLowerCase();
}

module.exports = { normalizeUsername, validateUsername };
