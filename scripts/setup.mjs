// File: scripts/setup.mjs · Node 22 · idempotent: run it as many times as you like
// Creates, with the master key, everything the app needs on a Back4app backend:
// classes + fields + indexes, class-level permissions (master key only), the finance and viewer roles,
// the first users (the viewer is locked), and the Parse Config values. No dashboard clicks.
//   node scripts/setup.mjs [--demo] [--reference-date 2026-09-30] [--timezone America/New_York]
//                          [--finance-user finance] [--viewer-user demo] [--no-viewer]
import path from 'node:path';
import { loadEnv, rest, where, args, ptr, readCredentials, writeCredentials, password, ParseError, ROOT } from './lib.mjs';

const a = args();
const env = loadEnv(a.env ? path.resolve(ROOT, a.env) : undefined);

const MASTER_ONLY = { find: {}, count: {}, get: {}, create: {}, update: {}, delete: {}, addField: {}, protectedFields: {} };
const SCHEMAS = {
  Account: {
    fields: { name: { type: 'String' }, openingBalance: { type: 'Number' }, currency: { type: 'String' } },
    indexes: { name_1: { name: 1 } },
    classLevelPermissions: MASTER_ONLY,
  },
  Category: {
    fields: { name: { type: 'String' }, color: { type: 'String' } },
    indexes: { name_1: { name: 1 } },
    classLevelPermissions: MASTER_ONLY,
  },
  Transaction: {
    fields: {
      type: { type: 'String' }, description: { type: 'String' }, amount: { type: 'Number' },
      accrualDate: { type: 'String' }, dueDate: { type: 'String' }, paidDate: { type: 'String' }, date: { type: 'String' },
      account: { type: 'Pointer', targetClass: 'Account' }, toAccount: { type: 'Pointer', targetClass: 'Account' },
      category: { type: 'Pointer', targetClass: 'Category' },
      accountId: { type: 'String' }, toAccountId: { type: 'String' }, categoryId: { type: 'String' },
      contact: { type: 'String' }, notes: { type: 'String' },
    },
    indexes: { date_1: { date: 1 }, paidDate_1: { paidDate: 1 }, accrualDate_1: { accrualDate: 1 }, accountId_1: { accountId: 1 }, toAccountId_1: { toAccountId: 1 }, categoryId_1: { categoryId: 1 } },
    classLevelPermissions: MASTER_ONLY,
  },
  Snapshot: {
    fields: { payload: { type: 'String' }, bytes: { type: 'Number' }, counts: { type: 'Object' }, startedAt: { type: 'Date' }, finishedAt: { type: 'Date' } },
    indexes: {},
    classLevelPermissions: MASTER_ONLY,
  },
  _User: {
    fields: { locked: { type: 'Boolean' } },
    indexes: {},
    // Users can read and update their own object (object ACL = owner only); nobody can list users or create them without the master key.
    classLevelPermissions: { find: {}, count: {}, get: { requiresAuthentication: true }, create: {}, update: { requiresAuthentication: true }, delete: {}, addField: {}, protectedFields: {} },
  },
  _Role: { fields: {}, indexes: {}, classLevelPermissions: MASTER_ONLY },
};

async function upsertSchema(className, spec) {
  let existing = null;
  try { existing = await rest(env, 'GET', `/schemas/${className}`, undefined, { master: true }); }
  catch (e) { if (e.status !== 400 && e.status !== 404) throw e; }
  const body = { className, fields: spec.fields, classLevelPermissions: spec.classLevelPermissions };
  if (Object.keys(spec.indexes).length) {
    body.indexes = {};
    for (const [name, def] of Object.entries(spec.indexes)) if (!existing?.indexes?.[name]) body.indexes[name] = def;
    if (!Object.keys(body.indexes).length) delete body.indexes;
  }
  if (existing) {
    // PUT only adds fields that are missing; existing ones are left alone.
    for (const f of Object.keys(body.fields)) if (existing.fields?.[f]) delete body.fields[f];
    await rest(env, 'PUT', `/schemas/${className}`, body, { master: true });
    console.log(`schema ${className}: updated (${Object.keys(body.fields).length} new field(s)${body.indexes ? `, ${Object.keys(body.indexes).length} new index(es)` : ''})`);
  } else {
    await rest(env, 'POST', '/schemas', body, { master: true });
    console.log(`schema ${className}: created`);
  }
}

async function ensureRole(name) {
  const found = (await rest(env, 'GET', `/roles?where=${where({ name })}`, undefined, { master: true })).results[0];
  if (found) { console.log(`role ${name}: exists (${found.objectId})`); return found.objectId; }
  const r = await rest(env, 'POST', '/roles', { name, ACL: {} }, { master: true });
  console.log(`role ${name}: created (${r.objectId})`);
  return r.objectId;
}

async function ensureUser(username, roleId, roleName, locked) {
  const creds = readCredentials();
  const found = (await rest(env, 'GET', `/users?where=${where({ username })}`, undefined, { master: true })).results[0];
  let userId;
  if (found) {
    userId = found.objectId;
    console.log(`user ${username}: exists (${userId})`);
  } else {
    const pw = process.env[`${roleName.toUpperCase()}_PASSWORD`] || creds[username]?.password || password();
    const r = await rest(env, 'POST', '/users', { username, password: pw, locked: !!locked }, { master: true });
    userId = r.objectId;
    creds[username] = { password: pw, role: roleName, objectId: userId, createdAt: new Date().toISOString() };
    writeCredentials(creds);
    console.log(`user ${username}: created (${userId}); password saved to .credentials.local.json`);
  }
  await rest(env, 'PUT', `/users/${userId}`, { ACL: { [userId]: { read: true, write: true } }, locked: !!locked }, { master: true });
  await rest(env, 'PUT', `/roles/${roleId}`, { users: { __op: 'AddRelation', objects: [ptr('_User', userId)] } }, { master: true });
  return userId;
}

async function setConfig() {
  const params = { orgTimezone: a.timezone || process.env.ORG_TIMEZONE || 'America/New_York', demo: !!a.demo };
  const ref = a['reference-date'] || process.env.REFERENCE_DATE;
  params.referenceDate = ref ? ref : { __op: 'Delete' };
  await rest(env, 'PUT', '/config', { params }, { master: true });
  console.log(`config: orgTimezone=${params.orgTimezone} demo=${params.demo} referenceDate=${ref || '(none)'}`);
}

try {
  for (const [name, spec] of Object.entries(SCHEMAS)) await upsertSchema(name, spec);
  const financeRole = await ensureRole('finance');
  const viewerRole = await ensureRole('viewer');
  await ensureUser(a['finance-user'] || 'finance', financeRole, 'finance', false);
  if (!a['no-viewer']) await ensureUser(a['viewer-user'] || 'demo', viewerRole, 'viewer', true);
  await setConfig();
  console.log('\nSetup complete. Next: deploy cloud/ (Cloud Code), then `npm run seed`.');
  console.log('Note: unique indexes cannot be created through the schema API — add them in the dashboard (Database → Index Manager) if your plan offers it.');
} catch (e) {
  if (e instanceof ParseError) console.error(`Parse error ${e.code ?? e.status}: ${e.message}`);
  else console.error(e);
  process.exit(1);
}
