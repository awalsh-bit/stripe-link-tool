/*
 * Site walk rules — no database. Run: node --test lib/tests/
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  readSyncPayload, decideWrite, canSend, canSignOff, queueRow, offerRow, walkEvents, PayloadError,
  STAGE_CODES, MAX_DOCUMENT_BYTES
} from "../site-walk-rules.js";

const example = () => JSON.parse(fs.readFileSync(new URL("./fixtures/example-walk-payload.json", import.meta.url), "utf8"));

test("a real payload from the phone is read into the summary row", () => {
  const p = example();
  const row = readSyncPayload(p);
  assert.equal(row.walk_id, p.walk.clientId);
  assert.equal(row.job_no, "S00063887");
  assert.equal(row.stage, "in-field");
  assert.equal(row.opening_count, 12);
  assert.equal(row.walked_count, 8);
  assert.equal(row.modify_count, 2);
  assert.equal(row.decision_count, 3);
  assert.equal(row.is_deliverable, false);
  assert.equal(row.client_updated_at, p.walk.updatedAt);
  assert.equal(row.payload.openings.length, 12, "every derived opening is kept for step two");
});

test("the counts are the phone's, never recomputed here", () => {
  const p = example();
  p.rollup.readyCount = 99;            // nonsense on purpose
  assert.equal(readSyncPayload(p).ready_count, 99);
});

test("payloads that can never be accepted are refused with PayloadError", () => {
  const cases = [
    ["not an object", () => "walk"],
    ["wrong schema", () => ({ ...example(), schema: "wilson.sitewalk/1" })],
    ["no walk", () => { const p = example(); delete p.walk; return p; }],
    ["no clientId", () => { const p = example(); p.walk.clientId = ""; return p; }],
    ["an id with a path in it", () => { const p = example(); p.walk.clientId = "../etc"; return p; }],
    ["no openings array", () => { const p = example(); p.openings = null; return p; }],
    ["a stage that does not exist", () => { const p = example(); p.walk.stageCode = "finished"; return p; }],
    ["an access route that does not exist", () => { const p = example(); p.walk.access = { route: "helicopter" }; return p; }]
  ];
  for (const [name, make] of cases) assert.throws(() => readSyncPayload(make()), PayloadError, name);
});

test("a document over the cap is dropped, the walk is still stored", () => {
  const p = example();
  p.walkDocument = { id: p.walk.clientId, blob: "x".repeat(MAX_DOCUMENT_BYTES + 10) };
  const row = readSyncPayload(p);
  assert.equal(row.document, null);
  assert.equal(row.walk_id, p.walk.clientId);
});

test("newest wins by the walk's own revision", () => {
  assert.equal(decideWrite(null, { client_updated_at: "2026-11-09T10:00:00.000Z" }), "CREATED");
  assert.equal(decideWrite({ client_updated_at: "2026-11-09T10:00:00.000Z" }, { client_updated_at: "2026-11-09T10:05:00.000Z" }), "UPDATED");
  assert.equal(decideWrite({ client_updated_at: "2026-11-09T10:05:00.000Z" }, { client_updated_at: "2026-11-09T10:00:00.000Z" }), "IGNORED_STALE");
  assert.equal(decideWrite({ client_updated_at: "2026-11-09T10:00:00.000Z" }, { client_updated_at: "2026-11-09T10:00:00.000Z" }), "UPDATED", "the same revision again is a harmless rewrite");
  assert.equal(decideWrite({ client_updated_at: "" }, { client_updated_at: "" }), "UPDATED", "no stamps: accept");
});

test("the gate: signed off by the walker before anything is sent", () => {
  assert.equal(canSignOff({ stage: "in-field" }).ok, false);
  assert.equal(canSignOff({ stage: "ready-to-walk" }).ok, false);
  assert.equal(canSignOff({ stage: "ready-to-send" }).ok, true);
  assert.equal(canSend({ stage: "ready-to-send", signed_off_at: null }).ok, false);
  assert.equal(canSend({ stage: "ready-to-send", signed_off_at: new Date() }).ok, true);
  assert.equal(canSend(null).ok, false);
  assert.ok(STAGE_CODES.includes("sent"));
});

test("the queue row carries the key names the office page reads", () => {
  const row = queueRow({ walk_id: "walk_a", job_no: "S1", project: "P", builder: "B", stage: "in-field", opening_count: 4, walked_count: 1,
    modify_count: 0, decision_count: 0, access_route: "ground", access_state: "clear", last_synced_at: "t", client_updated_at: "r" });
  for (const k of ["ClientWalkId", "JobNo", "ProjectName", "WalkedByNameSnapshot", "StageCode", "OpeningCount", "WalkedCount",
    "ModifyCount", "DecisionCount", "AccessRoute", "AccessState", "LastSyncedAt", "ClientUpdatedAt", "SignedOffAt", "PacketSentAt"]) {
    assert.ok(k in row, k);
  }
  const offer = offerRow({ walk_id: "walk_a", document: { id: "walk_a" }, client_updated_at: "r", opening_count: 4 });
  assert.deepEqual(Object.keys(offer).sort(), ["address", "archivedAt", "builder", "clientId", "jobNo", "openings", "project", "signedOffAt", "signedOffBy", "stageCode", "syncedAt", "updatedAt", "walk", "walkDate", "walked"]);
  assert.equal(offerRow({ walk_id: "walk_b" }).walk, null, "a summary row has no document");
});

test("what a walk has to say: ready to sign off, sent, and one line per spec decision for sales", () => {
  const row = {
    walk_id: "walk_a", project: "Lot 12", job_no: "S1", stage: "ready-to-send", walked_by: "Pat Manager",
    sales_name: "Sam Sales", sales_email: "sam.sales@example.test", opening_count: 4, walked_count: 4, modify_count: 1, decision_count: 1,
    signed_off_at: null, packet_sent_at: null, last_synced_at: "2026-11-16T15:00:00.000Z",
    payload: { openings: [
      { clientId: "op_1", location: "Kitchen", model: "CL4850UFD/O",
        actions: [{ id: "act_1", text: "Confirm the hinge side with the client.", owner: "sales", kind: "question" },
                  { id: "act_2", text: "Raise the header 1 3/8\".", owner: "cabinet" }, "an old-style string action"],
        findings: [{ label: "Width", detail: "49 5/8\" against a required 50\"." }] },
      { clientId: "op_2", location: "Bar", model: "DEU2450CI", findings: [{ label: "Model", detail: "The opening fits the 15\" unit, not the 24\".", owner: "sales" }] }
    ] }
  };
  const ev = walkEvents(row);
  assert.deepEqual(ev.map((e) => e.key).sort(), ["sitewalk:walk_a:ready", "sitewalk:walk_a:sales:act_1", "sitewalk:walk_a:sales:op_2"]);
  const ready = ev.find((e) => e.kind === "WALK_READY_FOR_REVIEW");
  assert.match(ready.body, /4 of 4 openings walked, 2 need builder action, walked by Pat Manager/);
  assert.match(ready.title, /sign off/);
  assert.match(ev.find((e) => e.key.endsWith("act_1")).body, /Lot 12 — Kitchen · CL4850UFD\/O: Confirm the hinge side/);
  assert.ok(ev.every((e) => e.salesEmail === "sam.sales@example.test"));
  /* a builder's correction is nobody's notification */
  assert.ok(!ev.some((e) => /header/.test(e.body)));
  /* signed off: the nudge clears; sent: the receipt appears, naming who signed */
  const sent = walkEvents({ ...row, stage: "sent", signed_off_at: new Date("2026-11-16T16:00:00Z"), signed_off_by_name: "Pat Manager",
    packet_sent_at: new Date("2026-11-16T16:05:00Z"), packet_sent_to: "super@example.test" });
  assert.ok(!sent.some((e) => e.kind === "WALK_READY_FOR_REVIEW"));
  assert.match(sent.find((e) => e.kind === "WALK_PACKET_SENT").body, /sent to super@example\.test, signed off by Pat Manager/);
  assert.deepEqual(walkEvents(null), []);
});

test("a spec library row: a model or confirmed dimensions, keyed the way the pages key them", async () => {
  const { readLibraryRow, libraryRow } = await import("../site-walk-rules.js");
  const model = readLibraryRow({ kind: "model", key: "DF48650GSP", doc: { brand: "Wolf", model: "DF48650G/S/P", variations: [] } });
  assert.deepEqual([model.kind, model.key, model.deleted], ["model", "DF48650GSP", false]);
  const dims = readLibraryRow({ kind: "dims", key: "DW2451|install-24", doc: { w: "24", d: "24", h: "34 1/2", confirmedBy: "Olive Office" } });
  assert.equal(dims.doc.h, "34 1/2");
  /* a removal carries no entry, and is kept as a marker */
  const gone = readLibraryRow({ kind: "model", key: "DF48650GSP", deleted: true });
  assert.deepEqual([gone.deleted, gone.doc], [true, null]);
  for (const bad of [null, [], { kind: "walk", key: "X", doc: {} }, { kind: "model", key: "", doc: {} }, { kind: "model", key: "DF-486/50", doc: {} },
    { kind: "dims", key: "DW2451", doc: {} }, { kind: "model", key: "X1", doc: "text" }, { kind: "model", key: "X1" }]) {
    assert.throws(() => readLibraryRow(bad), (e) => e.name === "PayloadError", JSON.stringify(bad));
  }
  const shown = libraryRow({ kind: "model", lib_key: "X1", doc: { model: "X1" }, deleted_at: new Date("2026-11-17T12:00:00Z"), updated_at: new Date("2026-11-17T12:00:00Z"), updated_by: "o@example.test", updated_by_name: "Olive Office" });
  assert.deepEqual([shown.key, shown.deleted, shown.doc, shown.updatedBy], ["X1", true, null, "Olive Office"]);
});
