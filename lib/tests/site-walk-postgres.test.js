/*
 * Site walk data module — against a real Postgres.
 * Run: DATABASE_URL=postgres://… node --test lib/tests/
 * Skips (does not fail) when DATABASE_URL is not set. Writes only rows whose
 * walk id starts with "walk_test_" and removes them afterwards.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const skip = !process.env.DATABASE_URL && "DATABASE_URL is not set";
const example = () => JSON.parse(fs.readFileSync(new URL("./fixtures/example-walk-payload.json", import.meta.url), "utf8"));
const ID = "walk_test_" + Date.now().toString(36);
const WHO = { byEmail: "pat.manager@example.test", byName: "Pat Manager" };

function payload({ rev, stage = "in-field", walked = 8, extra = {} } = {}) {
  const p = example();
  p.walk.clientId = ID;
  p.walk.updatedAt = rev;
  p.walk.stageCode = stage;
  p.rollup.walked = walked;
  Object.assign(p.walk, extra);
  p.walkDocument = { id: ID, jobNo: p.walk.jobNo, project: p.walk.project, updatedAt: rev, items: [{ id: "op_1", model: "CL4850UFD/O" }], reviewedAt: "", sentAt: "" };
  return p;
}

test("site walk data module", { skip }, async (t) => {
  const sw = await import("../site-walk-postgres.js");
  const { getPostgresPool } = await import("../data-postgres.js");
  const pool = await getPostgresPool();
  const clean = async () => {
    for (const table of ["sw_walks", "sw_walk_events", "sw_photos"]) await pool.query(`DELETE FROM ${table} WHERE walk_id LIKE 'walk_test_%'`).catch(() => {});
    await pool.query("DELETE FROM sw_spec_library WHERE lib_key LIKE 'WALKTEST%'").catch(() => {});
  };
  await sw.listWalks();      // applies the schema
  await clean();
  t.after(async () => { await clean(); await pool.end().catch(() => {}); });

  await t.test("the schema can be applied twice", async () => {
    await sw.listWalks(); await sw.listWalks();
  });

  await t.test("a new walk is CREATED and shows in the queue and the pull", async () => {
    const r = await sw.receiveWalk(payload({ rev: "2026-11-09T15:00:00.000Z" }), WHO);
    assert.equal(r.outcome, "CREATED"); assert.equal(r.walkId, ID); assert.equal(r.openings, 12);
    const row = (await sw.listWalks()).find((w) => w.ClientWalkId === ID);
    assert.ok(row, "in the queue"); assert.equal(row.StageCode, "in-field"); assert.equal(row.WalkedCount, 8);
    assert.equal(row.LastSyncedBy, WHO.byEmail);
    assert.equal(row.WalkDate, "2026-08-10", "the walk date comes back as the day it was, not a timestamp");
    const offer = (await sw.pullWalks()).walks.find((w) => w.clientId === ID);
    assert.ok(offer, "offered to devices");
    assert.equal(offer.walk, null, "the list is summaries: no document in it");
    assert.equal(offer.updatedAt, "2026-11-09T15:00:00.000Z");
    assert.equal(offer.walkDate, "2026-08-10");
    const one = (await sw.pullWalks({ walkId: ID })).walks;
    assert.equal(one.length, 1);
    assert.ok(one[0].walk && one[0].walk.id === ID, "asked for by id, the document is handed back whole");
  });

  await t.test("an archived walk leaves the queue and the devices' list, is kept, and can be restored", async () => {
    const a = await sw.archiveWalk(ID, WHO);
    assert.equal(a.ok, true);
    assert.ok(!(await sw.listWalks()).some((w) => w.ClientWalkId === ID), "out of the queue");
    assert.ok(!(await sw.pullWalks()).walks.some((w) => w.clientId === ID), "out of the devices' list");
    assert.ok((await sw.listWalks({ archived: true })).some((w) => w.ClientWalkId === ID && w.ArchivedAt), "listed as archived");
    assert.equal((await sw.pullWalks({ walkId: ID })).walks.length, 1, "its link still opens it");
    /* a device that still holds it can go on syncing; it stays archived */
    await sw.receiveWalk(payload({ rev: "2026-11-09T15:02:00.000Z" }), WHO);
    assert.ok(!(await sw.listWalks()).some((w) => w.ClientWalkId === ID));
    assert.equal((await sw.archiveWalk(ID, WHO)).already, true, "archiving twice is harmless");
    assert.equal((await sw.archiveWalk("walk_test_nope", WHO)).ok, false);
    const r = await sw.restoreWalk(ID, WHO);
    assert.equal(r.ok, true);
    assert.ok((await sw.listWalks()).some((w) => w.ClientWalkId === ID), "back in the queue");
    const kinds = (await sw.getWalk(ID)).events.map((e) => e.kind);
    assert.ok(kinds.includes("archived") && kinds.includes("restored"));
  });

  await t.test("a newer sync UPDATES; an older one is IGNORED and changes nothing", async () => {
    const up = await sw.receiveWalk(payload({ rev: "2026-11-09T15:10:00.000Z", walked: 10 }), WHO);
    assert.equal(up.outcome, "UPDATED");
    const stale = await sw.receiveWalk(payload({ rev: "2026-11-09T15:05:00.000Z", walked: 3 }), WHO);
    assert.equal(stale.outcome, "IGNORED_STALE");
    const row = (await sw.listWalks()).find((w) => w.ClientWalkId === ID);
    assert.equal(row.WalkedCount, 10, "the stale payload did not undo newer work");
    assert.equal(row.ClientUpdatedAt, "2026-11-09T15:10:00.000Z");
  });

  await t.test("a payload that can never be accepted throws PayloadError", async () => {
    await assert.rejects(() => sw.receiveWalk({ schema: "nope" }, WHO), sw.PayloadError);
  });

  await t.test("sign-off is refused while the walk is still in the field", async () => {
    const r = await sw.signOffWalk(ID, WHO);
    assert.equal(r.ok, false); assert.match(r.why, /not finished/);
  });

  await t.test("nothing is sent before sign-off, whatever the page claims", async () => {
    const claimed = await sw.receiveWalk(payload({ rev: "2026-11-09T16:00:00.000Z", stage: "sent", walked: 12, extra: { sentAt: "2026-11-09T16:00:00.000Z" } }), WHO);
    assert.equal(claimed.outcome, "UPDATED");
    const row = (await sw.listWalks()).find((w) => w.ClientWalkId === ID);
    assert.equal(row.StageCode, "ready-to-send", "a document claiming 'sent' is stored as finished-not-sent");
    assert.equal(row.PacketSentAt, null);
    const sent = await sw.markWalkSent(ID, { to: "builder@example.test", byEmail: WHO.byEmail });
    assert.equal(sent.ok, false); assert.match(sent.why, /signed off/);
  });

  await t.test("the walker signs off under their login; the document repeats it", async () => {
    const r = await sw.signOffWalk(ID, WHO);
    assert.equal(r.ok, true); assert.equal(r.signedOffBy, "Pat Manager"); assert.match(r.signedOffAt, /^\d{4}-\d\d-\d\dT/);
    const got = await sw.getWalk(ID);
    assert.equal(got.summary.SignedOffBy, "Pat Manager");
    assert.equal(got.offer.walk.reviewedBy, "Pat Manager", "every device that opens the walk sees the sign-off");
    assert.ok(got.offer.walk.reviewedAt);
    assert.ok(got.events.some((e) => e.kind === "signed_off" && e.actor_email === WHO.byEmail), "history records who");
  });

  await t.test("a later sync from a device cannot erase the sign-off", async () => {
    await sw.receiveWalk(payload({ rev: "2026-11-09T16:30:00.000Z", stage: "ready-to-send", walked: 12 }), WHO);
    const got = await sw.getWalk(ID);
    assert.ok(got.summary.SignedOffAt, "still signed off");
    assert.equal(got.offer.walk.reviewedBy, "Pat Manager", "and the stored document still says so");
  });

  await t.test("sign-off can be taken back until the packet is sent", async () => {
    assert.equal((await sw.reopenWalk(ID, WHO)).ok, true);
    assert.equal((await sw.getWalk(ID)).summary.SignedOffAt, null);
    assert.equal((await sw.markWalkSent(ID, { to: "x@example.test" })).ok, false);
    assert.equal((await sw.signOffWalk(ID, WHO)).ok, true);
  });

  await t.test("after sign-off the packet can be marked sent, once and for all", async () => {
    const sent = await sw.markWalkSent(ID, { to: "builder@example.test", byEmail: WHO.byEmail });
    assert.equal(sent.ok, true);
    const got = await sw.getWalk(ID);
    assert.equal(got.summary.StageCode, "sent"); assert.equal(got.summary.PacketSentTo, "builder@example.test");
    assert.equal(got.offer.walk.sentTo, "builder@example.test");
    assert.equal((await sw.reopenWalk(ID, WHO)).ok, false, "a sent packet's sign-off stands");
    assert.ok(!(await sw.pullWalks()).walks.some((w) => w.clientId === ID), "sent walks leave the phone's list");
    assert.ok((await sw.pullWalks({ walkId: ID })).walks.length === 1, "but a link to it still opens it");
  });

  await t.test("photographs: stored, listed, read back, replaced, and refused when wrong", async () => {
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    const a = await sw.savePhoto({ walkId: ID, photoId: "photo_test_1", contentType: "image/jpeg", buffer: jpg, meta: { kind: "opening" }, byEmail: WHO.byEmail });
    assert.equal(a.ok, true); assert.equal(a.bytes, 8);
    assert.deepEqual(await sw.listPhotoIds(ID), ["photo_test_1"]);
    const back = await sw.readPhoto(ID, "photo_test_1");
    assert.equal(back.contentType, "image/jpeg"); assert.ok(Buffer.compare(back.buffer, jpg) === 0);
    const again = await sw.savePhoto({ walkId: ID, photoId: "photo_test_1", contentType: "image/jpeg", buffer: Buffer.concat([jpg, jpg]) });
    assert.equal(again.ok, true); assert.equal((await sw.readPhoto(ID, "photo_test_1")).buffer.length, 16, "a re-send replaces");
    assert.equal((await sw.savePhoto({ walkId: ID, photoId: "photo_test_2", contentType: "application/pdf", buffer: jpg })).status, 415);
    assert.equal((await sw.savePhoto({ walkId: ID, photoId: "../x", contentType: "image/jpeg", buffer: jpg })).status, 400);
    assert.equal((await sw.savePhoto({ walkId: ID, photoId: "photo_test_3", contentType: "image/jpeg", buffer: Buffer.alloc(0) })).status, 400);
    assert.equal(await sw.readPhoto(ID, "nope"), null);
  });

  await t.test("the notifications feed is derived from the stored walks and filters by salesperson", async () => {
    const p = payload({ rev: "2026-11-09T18:00:00.000Z", stage: "ready-to-send", walked: 12,
      extra: { salesName: "Sam Sales", salesEmail: "sam.sales@example.test" } });
    p.openings[0].actions = [{ id: "act_test_1", text: "Confirm the hinge side with the client.", owner: "sales", kind: "question" }];
    await sw.receiveWalk(p, WHO);
    const mine = (await sw.listEvents({ email: "sam.sales@example.test" })).filter((e) => e.clientWalkId === ID);
    assert.ok(mine.some((e) => e.kind === "WALK_PACKET_SENT"), JSON.stringify(mine.map((e) => e.kind)));
    assert.ok(mine.some((e) => e.kind === "WALK_SALES_ITEM" && /Confirm the hinge side/.test(e.body)));
    assert.ok(!mine.some((e) => e.kind === "WALK_READY_FOR_REVIEW"), "signed off and sent: no nudge left");
    assert.equal((await sw.listEvents({ email: "nobody@example.test" })).filter((e) => e.clientWalkId === ID).length, 0);
    assert.equal((await sw.listEvents({ since: "2999-01-01" })).length, 0);
  });

  await t.test("the spec library: a row is saved once for everybody, the newest write wins, a removal is kept as a marker", async () => {
    const a = await sw.saveLibraryRow({ kind: "model", key: "WALKTEST1", doc: { brand: "Test", model: "WALK-TEST-1", variations: [{ key: "std", opening: { w: "30", d: "24", h: "84" } }] } }, WHO);
    assert.equal(a.ok, true); assert.equal(a.row.key, "WALKTEST1"); assert.equal(a.row.deleted, false);
    await sw.saveLibraryRow({ kind: "dims", key: "WALKTEST1|std", doc: { w: "30", d: "24", h: "84", confirmedBy: "Pat Manager" } }, WHO);
    await sw.saveLibraryRow({ kind: "model", key: "WALKTEST1", doc: { brand: "Test", model: "WALK-TEST-1", variations: [{ key: "std", opening: { w: "30 1/8", d: "24", h: "84" } }] } }, WHO);
    let rows = (await sw.listLibrary()).filter((r) => r.key.startsWith("WALKTEST"));
    assert.equal(rows.length, 2);
    assert.equal(rows.find((r) => r.kind === "model").doc.variations[0].opening.w, "30 1/8");
    assert.equal(rows.find((r) => r.kind === "dims").doc.confirmedBy, "Pat Manager");
    assert.ok(rows.every((r) => r.updatedAt && r.updatedBy));
    await sw.saveLibraryRow({ kind: "model", key: "WALKTEST1", deleted: true }, WHO);
    rows = (await sw.listLibrary()).filter((r) => r.key.startsWith("WALKTEST"));
    assert.deepEqual([rows.find((r) => r.kind === "model").deleted, rows.find((r) => r.kind === "model").doc], [true, null]);
    await assert.rejects(() => sw.saveLibraryRow({ kind: "walk", key: "WALKTEST1", doc: {} }, WHO), (e) => e.name === "PayloadError");
  });
});
