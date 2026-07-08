// Unit tests for lib/users-postgres.js helpers.
// Pure-function tests always run; DB-backed tests run when DATABASE_URL is set.
//   node scripts/test-user-access.js
import "dotenv/config";
import assert from "assert";
import {
  normalizeEmail,
  isEmailInAllowedDomain,
  validatePasswordPolicy,
  hashPassword,
  verifyPassword,
  hashToken,
  isUserStoreConfigured,
  ensureUserAccessTables,
  createUser,
  findUserByEmail,
  markUserVerifiedAndActive,
  updateUserPassword,
  setUserStatus,
  createAuthToken,
  consumeAuthToken,
  peekAuthToken,
  createSession,
  getSessionWithUser,
  deleteSessionByToken,
  deleteSessionsForUser,
  setUserPagePermissions,
  getGrantedPagesForUser,
  listUsersWithAccess,
  listAuditLog
} from "../lib/users-postgres.js";

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}: ${err.message}`);
  }
}

async function runPureTests() {
  console.log("Pure helper tests:");

  await test("normalizeEmail lowercases and trims", () => {
    assert.strictEqual(normalizeEmail("  JDoe@WilsonAppliance.com "), "jdoe@wilsonappliance.com");
  });

  await test("normalizeEmail strips +tag sub-addressing", () => {
    assert.strictEqual(normalizeEmail("jdoe+test@wilsonappliance.com"), "jdoe@wilsonappliance.com");
    assert.strictEqual(normalizeEmail("jdoe+a+b@wilsonappliance.com"), "jdoe@wilsonappliance.com");
  });

  await test("normalizeEmail rejects garbage", () => {
    assert.strictEqual(normalizeEmail("not-an-email"), "");
    assert.strictEqual(normalizeEmail("@wilsonappliance.com"), "");
    assert.strictEqual(normalizeEmail("a b@wilsonappliance.com"), "");
    assert.strictEqual(normalizeEmail(""), "");
  });

  await test("isEmailInAllowedDomain enforces the signup domain", () => {
    assert.strictEqual(isEmailInAllowedDomain("jdoe@wilsonappliance.com"), true);
    assert.strictEqual(isEmailInAllowedDomain("jdoe@gmail.com"), false);
    assert.strictEqual(isEmailInAllowedDomain("jdoe@notwilsonappliance.com.evil.com"), false);
  });

  await test("password policy: min length 12, not equal to email", () => {
    assert.ok(validatePasswordPolicy("short", "a@wilsonappliance.com"));
    assert.ok(validatePasswordPolicy("jdoe@wilsonappliance.com", "jdoe@wilsonappliance.com"));
    assert.strictEqual(validatePasswordPolicy("a-long-enough-password", "jdoe@wilsonappliance.com"), null);
  });

  await test("hashPassword produces scrypt format with per-user salt", async () => {
    const h1 = await hashPassword("correct horse battery");
    const h2 = await hashPassword("correct horse battery");
    assert.ok(h1.startsWith("scrypt$"));
    assert.strictEqual(h1.split("$").length, 6);
    assert.notStrictEqual(h1, h2, "salts must differ per hash");
  });

  await test("verifyPassword accepts correct and rejects wrong password", async () => {
    const hash = await hashPassword("a-long-enough-password");
    assert.strictEqual(await verifyPassword("a-long-enough-password", hash), true);
    assert.strictEqual(await verifyPassword("a-wrong-password-here", hash), false);
    assert.strictEqual(await verifyPassword("a-long-enough-password", "garbage"), false);
    assert.strictEqual(await verifyPassword("a-long-enough-password", ""), false);
  });

  await test("hashToken is deterministic sha256 hex", () => {
    assert.strictEqual(hashToken("abc"), hashToken("abc"));
    assert.match(hashToken("abc"), /^[0-9a-f]{64}$/);
  });
}

async function runDbTests() {
  console.log("DB-backed tests:");
  await ensureUserAccessTables();

  const testEmail = `__accesstest_${Date.now()}@wilsonappliance.com`;

  // Cleanup helper
  const { getPostgresPool } = await import("../lib/data-postgres.js");
  const pool = await getPostgresPool();
  const cleanup = async () => {
    await pool.query(`DELETE FROM app_users WHERE email LIKE '__accesstest_%'`);
  };
  await cleanup();

  let user;

  await test("createUser + findUserByEmail (normalized, no duplicates)", async () => {
    user = await createUser({
      email: testEmail,
      passwordHash: await hashPassword("a-long-enough-password"),
      displayName: "Access Test"
    });
    assert.ok(user.id);
    assert.strictEqual(user.status, "pending_verification");

    const found = await findUserByEmail(testEmail.replace("@", "+tag@").toUpperCase());
    assert.ok(found, "lookup with +tag/case variant should resolve to same account");
    assert.strictEqual(found.id, user.id);

    await assert.rejects(
      createUser({ email: testEmail.replace("@", "+dupe@") }),
      /duplicate key/i,
      "normalized duplicate must violate unique constraint"
    );
  });

  await test("unverified user cannot hold a session", async () => {
    const token = await createSession(user.id, { ip: "127.0.0.1", userAgent: "test" });
    const resolved = await getSessionWithUser(token);
    assert.strictEqual(resolved, null, "pending_verification user must not resolve a session");
  });

  await test("verify token flow activates the user (single use, right kind)", async () => {
    const raw = await createAuthToken(user.id, "verify");
    assert.strictEqual(await consumeAuthToken("reset", raw), null, "wrong kind must fail");
    const consumed = await consumeAuthToken("verify", raw);
    assert.ok(consumed);
    await markUserVerifiedAndActive(user.id);
    assert.strictEqual(await consumeAuthToken("verify", raw), null, "token must be single-use");
  });

  let sessionToken;

  await test("active+verified user session lifecycle", async () => {
    sessionToken = await createSession(user.id, { ip: "127.0.0.1", userAgent: "test" });
    const resolved = await getSessionWithUser(sessionToken);
    assert.ok(resolved);
    assert.strictEqual(resolved.user.id, user.id);
    assert.strictEqual(await getSessionWithUser("bogus-token-bogus-token"), null);
  });

  await test("page permissions grant and revoke", async () => {
    await setUserPagePermissions(user.id, [
      { pagePath: "/dashboard.html", granted: true },
      { pagePath: "/terminal.html", granted: true }
    ], user.id);
    let pages = await getGrantedPagesForUser(user.id);
    assert.deepStrictEqual(pages, ["/dashboard.html", "/terminal.html"]);

    await setUserPagePermissions(user.id, [{ pagePath: "/terminal.html", granted: false }], user.id);
    pages = await getGrantedPagesForUser(user.id);
    assert.deepStrictEqual(pages, ["/dashboard.html"]);
  });

  await test("password change revokes sessions", async () => {
    await updateUserPassword(user.id, await hashPassword("another-long-password"));
    assert.strictEqual(await getSessionWithUser(sessionToken), null);
  });

  await test("disabling a user kills sessions and pending tokens", async () => {
    const token = await createSession(user.id, {});
    const reset = await createAuthToken(user.id, "reset");
    await setUserStatus(user.id, "disabled", user.id);
    assert.strictEqual(await getSessionWithUser(token), null);
    assert.strictEqual(await peekAuthToken("reset", reset), null);
  });

  await test("reset tokens expire", async () => {
    await setUserStatus(user.id, "active", user.id);
    const raw = await createAuthToken(user.id, "reset", 1);
    await new Promise((r) => setTimeout(r, 1500));
    assert.strictEqual(await consumeAuthToken("reset", raw), null);
  });

  await test("audit log recorded", async () => {
    const log = await listAuditLog(50);
    assert.ok(log.some((entry) => entry.action === "permissions_updated"));
    assert.ok(log.some((entry) => entry.action === "user_disabled"));
  });

  await test("listUsersWithAccess includes granted pages", async () => {
    const users = await listUsersWithAccess();
    const found = users.find((u) => u.email === testEmail.toLowerCase());
    assert.ok(found);
    assert.deepStrictEqual(found.grantedPages, ["/dashboard.html"]);
  });

  await deleteSessionsForUser(user.id);
  await cleanup();
}

async function main() {
  await runPureTests();

  if (isUserStoreConfigured()) {
    await runDbTests();
  } else {
    console.log("DB-backed tests skipped (no DATABASE_URL).");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
