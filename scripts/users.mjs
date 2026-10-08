// File: scripts/users.mjs · Node 22 · administrator-only user management (needs MASTER_KEY)
//   node scripts/users.mjs list
//   node scripts/users.mjs add <username> <finance|viewer> [--locked] [--password ...]
//   node scripts/users.mjs set-password <username> [--password ...]
//   node scripts/users.mjs remove <username>
// Generated passwords are written to .credentials.local.json (gitignored), never printed.
import { loadEnv, rest, where, args, ptr, readCredentials, writeCredentials, password, ParseError } from './lib.mjs';

const env = loadEnv();
const a = args();
const [cmd, username, roleName] = a._;

async function findUser(name) {
  const u = (await rest(env, 'GET', `/users?where=${where({ username: name })}`, undefined, { master: true })).results[0];
  if (!u) { console.error(`No user named ${name}.`); process.exit(2); }
  return u;
}
async function findRole(name) {
  const r = (await rest(env, 'GET', `/roles?where=${where({ name })}`, undefined, { master: true })).results[0];
  if (!r) { console.error(`No role named ${name}. Run npm run setup first.`); process.exit(2); }
  return r;
}

try {
  if (cmd === 'list') {
    const users = (await rest(env, 'GET', '/users?limit=1000&order=username', undefined, { master: true })).results;
    const roles = (await rest(env, 'GET', '/roles?limit=100', undefined, { master: true })).results;
    const roleOf = {};
    for (const r of roles) {
      const members = (await rest(env, 'GET', `/users?where=${where({ $relatedTo: { object: ptr('_Role', r.objectId), key: 'users' } })}&limit=1000`, undefined, { master: true })).results;
      for (const m of members) roleOf[m.objectId] = [...(roleOf[m.objectId] || []), r.name];
    }
    for (const u of users) console.log(`${u.username.padEnd(20)} ${(roleOf[u.objectId] || ['(no role)']).join(',').padEnd(12)} ${u.locked ? 'locked' : ''} ${u.objectId}`);
  } else if (cmd === 'add') {
    if (!username || !['finance', 'viewer'].includes(roleName)) { console.error('usage: add <username> <finance|viewer> [--locked]'); process.exit(2); }
    const role = await findRole(roleName);
    const pw = a.password || password();
    const r = await rest(env, 'POST', '/users', { username, password: pw, locked: !!a.locked }, { master: true });
    await rest(env, 'PUT', `/users/${r.objectId}`, { ACL: { [r.objectId]: { read: true, write: true } } }, { master: true });
    await rest(env, 'PUT', `/roles/${role.objectId}`, { users: { __op: 'AddRelation', objects: [ptr('_User', r.objectId)] } }, { master: true });
    const creds = readCredentials();
    creds[username] = { password: pw, role: roleName, objectId: r.objectId, createdAt: new Date().toISOString() };
    writeCredentials(creds);
    console.log(`user ${username} created with role ${roleName}${a.locked ? ' (locked)' : ''}; password saved to .credentials.local.json`);
  } else if (cmd === 'set-password') {
    const u = await findUser(username);
    const pw = a.password || password();
    await rest(env, 'PUT', `/users/${u.objectId}`, { password: pw }, { master: true });
    const creds = readCredentials();
    creds[username] = { ...(creds[username] || {}), password: pw, objectId: u.objectId, updatedAt: new Date().toISOString() };
    writeCredentials(creds);
    console.log(`password for ${username} replaced; saved to .credentials.local.json. Existing sessions stay valid until they expire.`);
  } else if (cmd === 'remove') {
    const u = await findUser(username);
    await rest(env, 'DELETE', `/users/${u.objectId}`, undefined, { master: true });
    const creds = readCredentials(); delete creds[username]; writeCredentials(creds);
    console.log(`user ${username} removed.`);
  } else {
    console.log('usage: list | add <username> <finance|viewer> [--locked] | set-password <username> | remove <username>');
  }
} catch (e) {
  if (e instanceof ParseError) console.error(`Parse error ${e.code ?? e.status}: ${e.message}`);
  else console.error(e);
  process.exit(1);
}
