// localStorage with an in-memory fallback (private mode, Node).
const memory = {};

function store() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; }
}

export function load(key, fallback) {
  try {
    const s = store();
    const raw = s ? s.getItem(key) : memory[key];
    return raw == null ? fallback : JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

export function save(key, value) {
  const raw = JSON.stringify(value);
  try {
    const s = store();
    if (s) s.setItem(key, raw); else memory[key] = raw;
  } catch (e) {
    memory[key] = raw;
  }
}
