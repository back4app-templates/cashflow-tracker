// File: scripts/lib.mjs · Node 22 · shared by every script: .env loading, Parse REST calls, batches, sign-in
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadEnv(file = path.join(ROOT, '.env')) {
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  const env = {
    appId: process.env.APP_ID, jsKey: process.env.JS_KEY, restKey: process.env.REST_KEY, masterKey: process.env.MASTER_KEY,
    serverUrl: (process.env.SERVER_URL || 'https://parseapi.back4app.com').replace(/\/$/, ''),
  };
  for (const k of ['appId', 'masterKey']) if (!env[k]) { console.error(`Missing ${k === 'appId' ? 'APP_ID' : 'MASTER_KEY'} — copy .env.example to .env and fill it in.`); process.exit(1); }
  return env;
}

export function args(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) out[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
      else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

export class ParseError extends Error {
  constructor(status, body) { super(body?.error || `HTTP ${status}`); this.status = status; this.code = body?.code; this.body = body; }
}

/** rest(env, method, path, body, { master, session, context, headers }) → parsed JSON; throws ParseError on non-2xx. */
export async function rest(env, method, p, body, opts = {}) {
  const headers = { 'X-Parse-Application-Id': env.appId, 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (opts.master) headers['X-Parse-Master-Key'] = env.masterKey;
  else if (env.restKey) headers['X-Parse-REST-API-Key'] = env.restKey;
  else if (env.jsKey) headers['X-Parse-Javascript-Key'] = env.jsKey;
  if (opts.session) headers['X-Parse-Session-Token'] = opts.session;
  if (opts.context) headers['X-Parse-Cloud-Context'] = JSON.stringify(opts.context);
  const res = await fetch(env.serverUrl + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { error: text }; }
  if (!res.ok) throw new ParseError(res.status, json);
  return json;
}

export const where = (obj) => encodeURIComponent(JSON.stringify(obj));

export async function login(env, username, password) {
  const r = await rest(env, 'POST', '/login', { username, password }, { headers: { 'X-Parse-Revocable-Session': '1' } });
  return r.sessionToken;
}

/** Calls a Cloud function as a user (session) or anonymously (no session). Returns { ok, result | error, code }. */
export async function fn(env, name, params = {}, session = null) {
  try {
    const r = await rest(env, 'POST', `/functions/${name}`, params, { session });
    return { ok: true, result: r.result };
  } catch (e) {
    return { ok: false, error: e.message, code: e.code, status: e.status };
  }
}

/** Fetch every object of a class with the master key (paginated). */
export async function allOf(env, className, extra = {}) {
  const out = [];
  for (let skip = 0; ; skip += 1000) {
    const q = new URLSearchParams({ limit: '1000', skip: String(skip), order: 'createdAt', ...extra });
    const page = (await rest(env, 'GET', `/classes/${className}?${q}`, undefined, { master: true })).results;
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

/** Batch requests with the master key, 50 per call. requests = [{ method, path, body }]. */
export async function batch(env, requests, context) {
  const results = [];
  for (let i = 0; i < requests.length; i += 50) {
    const chunk = requests.slice(i, i + 50);
    const r = await rest(env, 'POST', '/batch', { requests: chunk }, { master: true, context });
    for (const item of r) {
      if (item.error) throw new ParseError(400, item.error);
      results.push(item.success);
    }
  }
  return results;
}

export const ptr = (className, objectId) => ({ __type: 'Pointer', className, objectId });

export const CREDENTIALS_FILE = path.join(ROOT, '.credentials.local.json');
export function readCredentials() { try { return JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf8')); } catch { return {}; } }
export function writeCredentials(data) { writeFileSync(CREDENTIALS_FILE, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 }); }
export const password = () => randomBytes(12).toString('base64url');

export const fmt = (cents) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
