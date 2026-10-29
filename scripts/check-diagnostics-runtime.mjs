import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

// Intentionally accepts only the fresh, uniquely named CI smoke service.
assert.equal(process.env.PORTAL_CI_DIAGNOSTICS_CHECK, "isolated");
assert.equal(process.env.POSTGRES_DB, "portal_ci_smoke");
assert.match(process.env.DATABASE_HOST ?? "", /^portal-db-\d+-\d+$/);
const database = new Client({
  host: process.env.DATABASE_HOST,
  port: 5432,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
});
const root = "http://127.0.0.1:3000";
let cookie = "";
async function api(path, init = {}, status = 200) {
  const response = await fetch(root + path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      ...init.headers,
    },
  });
  assert.equal(response.status, status, path);
  return response;
}
try {
  await database.connect();
  assert.equal(
    (await database.query('SELECT COUNT(*)::integer AS count FROM "AdminUser"'))
      .rows[0].count,
    0,
  );
  assert.equal(
    (
      await database.query(
        'SELECT COUNT(*)::integer AS count FROM "IntegrationConfig" WHERE enabled=true',
      )
    ).rows[0].count,
    0,
  );
  await api("/api/acquisition/table", {}, 401);
  const bootstrap = await api(
    "/api/auth/bootstrap",
    {
      method: "POST",
      body: JSON.stringify({
        username: "CI diagnostics",
        password: randomUUID() + randomUUID(),
      }),
    },
    201,
  );
  cookie = bootstrap.headers
    .getSetCookie()
    .find((value) => value.startsWith("stasharr_session="))
    .split(";")[0];
  const scene = randomUUID();
  await database.query(
    `INSERT INTO "Request" (id,"stashId",status,"updatedAt") VALUES ('ci-diagnostic-request',$1,'REQUESTED',NOW())`,
    [scene],
  );
  for (let index = 0; index < 61; index++) {
    const id = index ? randomUUID() : scene;
    await database.query(
      `INSERT INTO "SceneIndex" ("stashId",title,"requestStatus","computedLifecycle","metadataHydrationState","updatedAt")
      VALUES ($1,$2,'REQUESTED','REQUESTED','HYDRATED',NOW())`,
      [id, `CI example request ${index}`],
    );
  }
  await database.query(
    `INSERT INTO "RequestDiagnosticObservation" ("stashId",source,signature,performers,"performerText")
    VALUES ($1,'ci-native','initial',ARRAY['Example Person'],'Example Person')`,
    [scene],
  );
  for (let index = 0; index < 60; index++) {
    const id = "d".repeat(60) + index.toString(16).padStart(4, "0");
    await database.query(
      `INSERT INTO "RequestDiagnosticEvent" (id,"stashId",source,kind,label,"occurredAt")
      VALUES ($1,$2,'ci-native','OBSERVED','Synthetic event','2026-10-29T00:00:00Z')`,
      [id, scene],
    );
    await database.query(
      `INSERT INTO "RequestSearchAttempt" (id,"stashId",source,"movieId",mode,state,"createdAt")
      VALUES ($1,$2,'ci-native',42,'AUTOMATIC','completed','2026-10-29T00:00:00Z')`,
      [id, scene],
    );
  }
  const first = await (
    await api("/api/acquisition/table?perPage=50&page=1")
  ).json();
  const second = await (
    await api("/api/acquisition/table?perPage=50&page=2")
  ).json();
  assert.equal(first.total, 61);
  assert.equal(first.items.length, 50);
  assert.equal(second.items.length, 11);
  assert.equal(first.countsByLifecycle.REQUESTED, 61);
  assert.equal(first.blockerCounts.STATUS_UNAVAILABLE, 61);
  assert.equal(
    new Set([...first.items, ...second.items].map((row) => row.id)).size,
    61,
  );
  const performer = await (await api("/api/acquisition/table?q=Person")).json();
  assert.equal(performer.total, 1);
  assert.equal(performer.items[0].id, scene);
  await api("/api/acquisition/table?perPage=51", {}, 400);
  const history = await (
    await api(`/api/requests/${scene}/diagnostics`)
  ).json();
  assert.equal(history.events.length, 50);
  assert.equal(history.attempts.length, 50);
  assert.equal(history.hasMoreEvents, true);
  assert.equal(history.hasMoreAttempts, true);
  const older = await (
    await api(
      `/api/requests/${scene}/diagnostics?eventBefore=${history.nextEventCursor}&attemptBefore=${history.nextAttemptCursor}`,
    )
  ).json();
  assert.equal(
    new Set([...history.events, ...older.events].map((row) => row.id)).size,
    60,
  );
  assert.equal(
    new Set([...history.attempts, ...older.attempts].map((row) => row.id)).size,
    60,
  );
  await api("/api/settings/hydra-search", {
    method: "PUT",
    body: JSON.stringify({
      browserUrl: "https://ci.invalid/hydra",
      studio: true,
      performers: true,
      title: false,
    }),
  });
  const settings = await (await api("/api/settings/hydra-search")).json();
  assert.equal(settings.browserUrl, "https://ci.invalid/hydra");
  await api(
    "/api/settings/hydra-search",
    {
      method: "PUT",
      body: JSON.stringify({
        browserUrl: "https://user:secret@ci.invalid",
        studio: true,
        performers: true,
        title: false,
      }),
    },
    400,
  );
  await api(
    `/api/requests/${scene}/diagnostic-searches`,
    { method: "POST", body: JSON.stringify({ operationKey: randomUUID() }) },
    400,
  );
  assert.equal(
    (
      await database.query(
        'SELECT COUNT(*)::integer AS count FROM "IntegrationConfig" WHERE enabled=true',
      )
    ).rows[0].count,
    0,
  );
  console.log(
    "Isolated diagnostics runtime passed: authenticated table/filter/cursor/settings contracts, real Prisma queries, no connected acquisition services.",
  );
} finally {
  await database.end();
}
