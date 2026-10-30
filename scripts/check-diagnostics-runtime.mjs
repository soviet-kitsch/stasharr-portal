import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { createServer } from "node:http";

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
  const unauthorizedScene = randomUUID();
  await api(
    `/api/acquisition/scenes/${unauthorizedScene}/stash-availability`,
    {},
    401,
  );
  await api(
    `/api/requests/${unauthorizedScene}/whisparr-deletion-preview`,
    {},
    401,
  );
  await api(
    `/api/requests/${unauthorizedScene}/delete-whisparr`,
    { method: "POST", body: "{}" },
    401,
  );
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
  const availability = await (
    await api(`/api/acquisition/scenes/${scene}/stash-availability`)
  ).json();
  assert.equal(availability.state, "NOT_CONFIGURED");
  const emptyStash = createServer((req, res) => {
    assert.equal(req.method, "POST");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data: { findScenes: { count: 0, scenes: [] } } }));
  });
  await new Promise((resolve) => emptyStash.listen(0, "127.0.0.1", resolve));
  try {
    const stashUrl = `http://127.0.0.1:${emptyStash.address().port}`;
    for (const type of ["STASH", "STASHDB"])
      await database.query(
        `UPDATE "IntegrationConfig" SET "baseUrl"=$2,enabled=$3,status='CONFIGURED',"lastHealthyAt"=NOW(),"updatedAt"=NOW() WHERE type=$1`,
        [type, stashUrl, type === "STASH"],
      );
    const beforeActions = (
      await database.query(
        'SELECT COUNT(*)::integer AS count FROM "RequestAction"',
      )
    ).rows[0].count;
    const response = await api(
      `/api/acquisition/scenes/${scene}/stash-availability`,
    );
    assert.equal(response.headers.get("cache-control"), "no-store");
    const checked = await response.json();
    assert.equal(checked.state, "NOT_FOUND");
    assert.deepEqual(checked.matches, []);
    assert.equal(
      (
        await database.query(
          'SELECT COUNT(*)::integer AS count FROM "RequestAction"',
        )
      ).rows[0].count,
      beforeActions,
    );
  } finally {
    await database.query('UPDATE "IntegrationConfig" SET enabled=false');
    await new Promise((resolve) => emptyStash.close(resolve));
  }
  // Real HTTP/controller/DTO/Prisma proof against an in-process fake Whisparr only.
  const deletionScene = randomUUID();
  const synthetic = {
    id: 987,
    stashId: deletionScene,
    title: "Synthetic deletion proof",
    path: "/ci/library/synthetic",
    hasFile: true,
    added: "2026-10-30T00:00:00Z",
  };
  let deleted = false;
  const nativeDeletes = [];
  const mock = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("Content-Type", "application/json");
    if (req.method === "DELETE") {
      nativeDeletes.push({
        path: url.pathname,
        deleteFiles: url.searchParams.get("deleteFiles"),
        exclusion: url.searchParams.get("addImportExclusion"),
      });
      deleted = true;
      res.writeHead(204);
      res.end();
      return;
    }
    let value = [];
    if (url.pathname === "/api/v3/movie") value = deleted ? [] : [synthetic];
    if (url.pathname === "/api/v3/movie/987") {
      if (deleted) {
        res.writeHead(404);
        res.end("{}");
        return;
      }
      value = synthetic;
    }
    if (url.pathname === "/api/v3/moviefile")
      value = [
        {
          id: 988,
          movieId: 987,
          path: "/ci/library/synthetic/video.mp4",
          size: 100,
          dateAdded: "2026-10-30T00:00:00Z",
        },
      ];
    if (url.pathname === "/api/v3/rootfolder")
      value = [{ path: "/ci/library", accessible: true }];
    if (url.pathname === "/api/v3/queue")
      value = { totalRecords: 0, records: [] };
    res.end(JSON.stringify(value));
  });
  await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
  try {
    const nativeUrl = `http://127.0.0.1:${mock.address().port}`;
    for (const type of ["WHISPARR", "STASHDB"]) {
      await database.query(
        `INSERT INTO "IntegrationConfig" (id,type,enabled,status,"baseUrl","lastHealthyAt",config,"updatedAt")
        VALUES ($1,$2,true,'CONFIGURED',$3,NOW(),$4,NOW())
        ON CONFLICT (type) DO UPDATE SET enabled=true,status='CONFIGURED',"baseUrl"=EXCLUDED."baseUrl","lastHealthyAt"=NOW(),config=EXCLUDED.config,"updatedAt"=NOW()`,
        [
          randomUUID(),
          type,
          nativeUrl,
          JSON.stringify(
            type === "STASHDB"
              ? { selectedForInstanceCatalogProvider: true }
              : {},
          ),
        ],
      );
    }
    const target = await (
      await api(`/api/requests/${deletionScene}/whisparr-deletion-preview`)
    ).json();
    assert.equal(target.whisparrSceneId, 987);
    assert.equal(target.folder, synthetic.path);
    assert.equal(target.files.length, 1);
    assert.equal(nativeDeletes.length, 0);
    const operationKey = randomUUID();
    await api(
      `/api/requests/${deletionScene}/delete-whisparr`,
      {
        method: "POST",
        body: JSON.stringify({
          operationKey,
          previewToken: target.previewToken,
          confirmDeleteFiles: false,
        }),
      },
      400,
    );
    assert.equal(nativeDeletes.length, 0);
    const payload = JSON.stringify({
      operationKey,
      previewToken: target.previewToken,
      confirmDeleteFiles: true,
    });
    const removed = await (
      await api(
        `/api/requests/${deletionScene}/delete-whisparr`,
        { method: "POST", body: payload },
        201,
      )
    ).json();
    assert.equal(removed.outcome, "WHISPARR_SCENE_REMOVED");
    assert.equal(removed.fileCleanup, "REQUESTED_NOT_VERIFIED");
    await api(
      `/api/requests/${deletionScene}/delete-whisparr`,
      { method: "POST", body: payload },
      201,
    );
    assert.deepEqual(nativeDeletes, [
      { path: "/api/v3/movie/987", deleteFiles: "true", exclusion: "false" },
    ]);
    const action = (
      await database.query(
        'SELECT kind,state FROM "RequestAction" WHERE id=$1',
        [operationKey],
      )
    ).rows[0];
    assert.deepEqual(action, { kind: "DELETE_WHISPARR", state: "SUCCEEDED" });
    const request = (
      await database.query(
        'SELECT "dismissedAt","activeActionId" FROM "Request" WHERE "stashId"=$1',
        [deletionScene],
      )
    ).rows[0];
    assert.ok(request.dismissedAt);
    assert.equal(request.activeActionId, null);
  } finally {
    await database.query('UPDATE "IntegrationConfig" SET enabled=false');
    await new Promise((resolve) => mock.close(resolve));
  }
  console.log(
    "Isolated diagnostics runtime passed: authenticated table/filter/cursor/settings contracts, real Prisma queries, no connected acquisition services.",
  );
} finally {
  await database.end();
}
