import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { 
  verifyFederatedToken 
} from "../src/services/federation-service.js";

test("Federation: verifyFederatedToken", async (t) => {
  const sharedSecret = "correct-shared-secret-long-enough-32-chars";
  const hubUrl = "https://partner-hub.com";
  
  // We need to bypass the DB check for unit testing or use a real entry.
  // Since we are in the control-plane test suite, setup-test-db already runs.
  // We'll add the hub to the test DB.
  
  const setupHub = async () => {
    const { withDb } = await import("../src/db/client.js");
    await withDb(async (db) => {
      await db.query("delete from trusted_hubs where hub_url = $1", [hubUrl]);
      await db.query(
        "insert into trusted_hubs (hub_url, shared_secret) values ($1, $2)",
        [hubUrl, sharedSecret]
      );
    });
  };

  await setupHub();

  const generateToken = (payloadObj: any, secret: string) => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
    const signature = crypto
      .createHmac("sha256", secret)
      .update(`${header}.${payload}`)
      .digest("base64url");
    return `${header}.${payload}.${signature}`;
  };

  await t.test("Valid token should pass", async () => {
    const token = generateToken({
      sub: "user:remote-user-123",
      name: "Remote User",
      iat: Math.floor(Date.now() / 1000)
    }, sharedSecret);
    
    const result = await verifyFederatedToken(token, hubUrl);
    
    assert.ok(result, "Verification should pass");
    assert.strictEqual(result.federatedId, "user:remote-user-123");
  });

  await t.test("Invalid signature should fail", async () => {
    const token = generateToken({ sub: "user:hacker" }, "wrong-secret");
    
    const result = await verifyFederatedToken(token, hubUrl);
    
    assert.strictEqual(result, null, "Verification should fail due to signature");
  });

  await t.test("Expired token should fail (if we check iat, currently not implemented but planned)", async () => {
    // Note: implementation currently doesn't check 'iat' or 'exp', but we should at least check signature
    const token = generateToken({ sub: "user:stale" }, sharedSecret);
    const result = await verifyFederatedToken(token, hubUrl);
    assert.ok(result, "Signature is valid, so it passes (expiry check not yet in server logic)");
  });
});

