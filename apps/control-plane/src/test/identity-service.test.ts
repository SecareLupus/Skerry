import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { initDb, pool } from "../db/client.js";
import {
  upsertIdentityMapping,
  getIdentityByProductUserId,
  getIdentityByProviderSubject,
  listIdentitiesByProductUserId,
  setPreferredUsernameForProductUser,
  isOnboardingComplete,
  searchIdentities
} from "../services/identity-service.js";
import { resetDb } from "./helpers/reset-db.js";

beforeEach(async () => {
  if (pool) {
    await initDb();
    await resetDb();
  }
});

test("identity service lifecycle", async (t) => {
  if (!pool) {
    t.skip("DATABASE_URL not configured.");
    return;
  }

  // 1. Create a new identity
  const identity1 = await upsertIdentityMapping({
    provider: "dev",
    oidcSubject: "sub1",
    email: "test@dev.local",
    preferredUsername: "testuser",
    avatarUrl: null
  });

  assert.ok(identity1.productUserId);
  assert.equal(identity1.provider, "dev");
  assert.equal(identity1.oidcSubject, "sub1");
  assert.equal(identity1.preferredUsername, "testuser");

  // 2. Fetch by product user id
  const fetched1 = await getIdentityByProductUserId(identity1.productUserId);
  assert.deepEqual(fetched1, identity1);

  // 3. Fetch by provider subject
  const fetched2 = await getIdentityByProviderSubject({
    provider: "dev",
    oidcSubject: "sub1"
  });
  assert.deepEqual(fetched2, identity1);

  // 4. List by product user id
  const list1 = await listIdentitiesByProductUserId(identity1.productUserId);
  assert.equal(list1.length, 1);
  assert.deepEqual(list1[0], identity1);

  // 5. Update username
  await setPreferredUsernameForProductUser({
    productUserId: identity1.productUserId,
    preferredUsername: "newname"
  });

  const updated1 = await getIdentityByProductUserId(identity1.productUserId);
  assert.equal(updated1?.preferredUsername, "newname");

  // 6. Onboarding is complete because preferredUsername is set
  const onbComplete = await isOnboardingComplete(identity1.productUserId);
  assert.equal(onbComplete, true);

  // 7. Search identities
  const searchResults = await searchIdentities("newname");
  assert.equal(searchResults.length, 1);
  assert.equal(searchResults[0]?.productUserId, identity1.productUserId);

  // 8. Create another identity to verify search
  const identity2 = await upsertIdentityMapping({
    provider: "dev",
    oidcSubject: "sub2",
    email: "something@example.com",
    preferredUsername: "something",
    avatarUrl: null
  });

  const searchResults2 = await searchIdentities("some");
  assert.equal(searchResults2.length, 1);
  assert.equal(searchResults2[0]?.productUserId, identity2.productUserId);
});
