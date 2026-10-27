import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';

const UPGRADE = '20261027170000_integration_browser_defaults';
const NEW_FIELDS = ['browserUrl', 'defaultRootFolderPath', 'defaultQualityProfileId'];
let stage = 'checking CI isolation';
let admin;
let database;

try {
  // This script deliberately ignores DATABASE_URL: never inherit an application
  // connection accidentally when running the CI-only migration proof locally.
  assert.equal(process.env.CI, 'true', 'CI=true is required');
  assert.equal(process.env.PORTAL_CI_UPGRADE_CHECK, 'isolated', 'Explicit isolated check is required');
  const adminUrl = new URL(process.env.CI_UPGRADE_DATABASE_URL ?? '');
  assert.ok(['postgres:', 'postgresql:'].includes(adminUrl.protocol));
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(adminUrl.hostname), 'Only a loopback CI database is accepted');
  assert.equal(adminUrl.pathname, '/postgres', 'Use the disposable service administrative database');
  assert.equal(adminUrl.search, '', 'Database connection overrides are not accepted');
  assert.equal(adminUrl.hash, '');
  const name = `portal_ci_upgrade_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  assert.match(name, /^portal_ci_upgrade_[a-f0-9]{20}$/);
  admin = new Client({ connectionString: adminUrl.href, connectionTimeoutMillis: 10000 });
  await admin.connect();
  stage = 'creating a new uniquely named CI database';
  await admin.query(`CREATE DATABASE "${name}"`);
  adminUrl.pathname = `/${name}`;
  database = new Client({ connectionString: adminUrl.href, connectionTimeoutMillis: 10000 });
  await database.connect();
  const migrationRoot = path.resolve('prisma/migrations');
  const migrations = (await readdir(migrationRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  assert.ok(migrations.includes(UPGRADE), 'The reviewed additive migration must exist');
  assert.equal(migrations.at(-1), UPGRADE, 'Review this proof before adding a later migration');
  for (const migration of migrations.filter((migration) => migration < UPGRADE)) {
    stage = `replaying baseline migration ${migration}`;
    await database.query(await readFile(path.join(migrationRoot, migration, 'migration.sql'), 'utf8'));
  }

  stage = 'inserting synthetic pre-upgrade records';
  const settings = { rootFolderPath: '/ci/library', qualityProfileId: 7, monitored: true, tags: [3], searchForMovie: true };
  const details = { remoteKind: 'MOVIE_SEARCH', movieId: 42, uncertain: true };
  await database.query(`INSERT INTO "IntegrationConfig"
    (id,type,enabled,status,"baseUrl","apiKey",config,"lastHealthyAt","updatedAt")
    VALUES ('ci-whis','WHISPARR',true,'CONFIGURED',$1,$2,$3,NOW(),NOW())`,
    ['http://whisparr-ci:6969', 'synthetic-ci-key', { preserved: true }]);
  await database.query(`INSERT INTO "Request"
    (id,"stashId",status,settings,revision,"activeActionId","updatedAt")
    VALUES ('ci-request','ci-scene','REQUESTED',$1,4,'ci-uncertain-action',NOW())`, [settings]);
  await database.query(`INSERT INTO "RequestAction"
    (id,"stashId",kind,"payloadHash",state,details,"dispatchedAt","updatedAt")
    VALUES ('ci-uncertain-action','ci-scene','RE_REQUEST',$1,'UNKNOWN',$2,NOW(),NOW())`, ['a'.repeat(64), details]);
  await database.query(`INSERT INTO "AdminUser"
    (id,"singletonKey",username,"normalizedUsername","passwordHash","sessionVersion","updatedAt")
    VALUES ('ci-admin',1,'CI fixture','ci fixture','synthetic-unused-hash',3,NOW())`);
  await database.query(`INSERT INTO "AdminSession"
    (id,"userId","sessionVersion","expiresAt","updatedAt")
    VALUES ('ci-session','ci-admin',3,NOW()+INTERVAL '1 day',NOW())`);
  await database.query(`INSERT INTO "SceneIndex"
    ("stashId",title,"requestStatus","requestRevision","whisparrMovieId","updatedAt")
    VALUES ('ci-scene','Synthetic scene','REQUESTED',4,42,NOW())`);
  const tables = ['IntegrationConfig', 'Request', 'RequestAction', 'AdminUser', 'AdminSession', 'SceneIndex'];
  const capture = async () => Object.fromEntries(await Promise.all(tables.map(async (table) =>
    [table, (await database.query(`SELECT row_to_json(t) AS row FROM "${table}" t`)).rows.map(({ row }) => row)])));
  const before = await capture();
  stage = `applying ${UPGRADE}`;
  await database.query(await readFile(path.join(migrationRoot, UPGRADE, 'migration.sql'), 'utf8'));
  const after = await capture();
  assert.ok(after.IntegrationConfig.every((row) => NEW_FIELDS.every((field) => row[field] === null)),
    'New presentation/default fields must start nullable');
  after.IntegrationConfig = after.IntegrationConfig.map((row) =>
    Object.fromEntries(Object.entries(row).filter(([field]) => !NEW_FIELDS.includes(field))));
  assert.deepEqual(after, before, 'Existing sessions, credentials, requests and uncertain dispatch records must survive unchanged');
  const columns = (await database.query(`SELECT column_name,is_nullable,column_default FROM information_schema.columns
    WHERE table_schema='public' AND table_name='IntegrationConfig' AND column_name=ANY($1)`, [NEW_FIELDS])).rows;
  assert.equal(columns.length, NEW_FIELDS.length);
  assert.ok(columns.every((column) => column.is_nullable === 'YES' && column.column_default === null));
  stage = 'checking new settings read/write without changing old settings';
  await database.query(`UPDATE "IntegrationConfig" SET "browserUrl"=$1,"defaultRootFolderPath"=$2,
    "defaultQualityProfileId"=$3 WHERE id='ci-whis'`, ['https://portal-ci.invalid/whis', '/ci/default-library', 9]);
  const changed = (await database.query(`SELECT * FROM "IntegrationConfig" WHERE id='ci-whis'`)).rows[0];
  assert.equal(changed.browserUrl, 'https://portal-ci.invalid/whis');
  assert.equal(changed.defaultRootFolderPath, '/ci/default-library');
  assert.equal(changed.defaultQualityProfileId, 9);
  assert.equal(changed.apiKey, before.IntegrationConfig[0].apiKey);
  assert.equal(changed.baseUrl, before.IntegrationConfig[0].baseUrl);
  assert.equal(changed.status, 'CONFIGURED');
  const evidence = {
    sourceCommit: process.env.GITHUB_SHA ?? 'local-isolated-check',
    migration: UPGRADE,
    baselineMigrations: migrations.length - 1,
    syntheticFixtureTables: tables,
    existingRecordsPreserved: true,
    uncertainDispatchAndSessionPreserved: true,
    newFieldsNullable: true,
    newSettingsReadWritePassed: true,
    isolatedDatabase: name,
    cleanup: 'Disposable CI service is removed when the job ends; no existing database was dropped',
  };
  await mkdir('ci-evidence', { recursive: true });
  await writeFile('ci-evidence/upgrade-check.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(`Additive upgrade passed across ${tables.length} synthetic fixture tables.`);
} catch (error) {
  console.error(`Isolated upgrade check failed during ${stage}: ${error.code ?? error.name}`);
  process.exitCode = 1;
} finally {
  await database?.end().catch(() => undefined);
  await admin?.end().catch(() => undefined);
}
