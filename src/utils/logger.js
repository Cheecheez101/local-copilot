'use strict';

function redactSecrets(value, keyHint = '') {
  const sensitive = /token|key|secret|password|authorization|api[_-]?key/i.test(String(keyHint || ''));
  if (value == null) return value;
  if (sensitive) return '[REDACTED]';
  if (typeof value === 'string') {
    if (/sk-[a-z0-9]{10,}/i.test(value)) return '[REDACTED]';
    if (/bearer\s+[a-z0-9\-_\.]+/i.test(value)) return 'Bearer [REDACTED]';
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactSecrets(v, k);
    }
    return out;
  }
  return value;
}

function log(level, event, data = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    data: redactSecrets(data),
  };
  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }
}

module.exports = { log, redactSecrets };
