import crypto from "node:crypto";
import {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
    AuthenticatorTransportFuture,
    RegistrationResponseJSON,
    AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { withDb } from "../db/client.js";
import { config } from "../config.js";

export interface WebAuthnCredential {
    id: string;
    hubId: string;
    productUserId: string;
    credentialId: string;
    publicKey: string;
    signCount: number;
    label: string | null;
    hasPin: boolean;
    pinHash: string | null;
    createdAt: string;
    lastUsedAt: string | null;
}

const rpName = config.synapse.serverName || "Skerry";
const rpID = config.webBaseUrl ? new URL(config.webBaseUrl).hostname : "localhost";
const rpOrigin = config.webBaseUrl || "http://localhost:8080";

/**
 * Generate credential creation options for the browser.
 */
export async function beginRegistration(input: {
    hubId: string;
    productUserId: string;
    email?: string | null;
}): Promise<PublicKeyCredentialCreationOptions> {
    const existing = await withDb(async (db) => {
        const result = await db.query<{ credential_id: string }>(
            "select credential_id from webauthn_credentials where product_user_id = $1 and hub_id = $2",
            [input.productUserId, input.hubId]
        );
        return result.rows;
    });

    const opts = await generateRegistrationOptions({
        rpName,
        rpID,
        userID: Buffer.from(input.productUserId),
        userName: input.email ?? input.productUserId,
        userDisplayName: input.email ?? input.productUserId,
        attestationType: "none",
        excludeCredentials: existing.map((c) => ({
            id: c.credential_id,
            type: "public-key",
        })),
        authenticatorSelection: {
            residentKey: "preferred",
            userVerification: "preferred",
        },
    });

    // Store challenge temporarily
    await storeChallenge(input.hubId, input.productUserId, opts.challenge);

    return opts as unknown as PublicKeyCredentialCreationOptions;
}

/**
 * Verify a registration response and store the credential.
 */
export async function completeRegistration(input: {
    hubId: string;
    productUserId: string;
    response: RegistrationResponseJSON;
    label?: string;
    pin?: string;
}): Promise<WebAuthnCredential> {
    const challenge = await popChallenge(input.hubId, input.productUserId);
    if (!challenge) {
        throw new Error("Registration challenge expired. Please try again.");
    }

    const verification = await verifyRegistrationResponse({
        response: input.response,
        expectedChallenge: challenge,
        expectedOrigin: rpOrigin,
        expectedRPID: rpID,
    });

    if (!verification.verified || !verification.registrationInfo) {
        throw new Error("Registration verification failed.");
    }

    const { credential } = verification.registrationInfo;
    const id = `wac_${crypto.randomUUID().replaceAll("-", "")}`;
    const pinHash = input.pin ? await bcryptHash(input.pin) : null;

    await withDb(async (db) => {
        await db.query(
            `insert into webauthn_credentials (id, hub_id, product_user_id, credential_id, public_key, sign_count, label, has_pin, pin_hash)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
                id,
                input.hubId,
                input.productUserId,
                credential.id,
                Buffer.from(credential.publicKey).toString("base64"),
                credential.counter,
                input.label ?? null,
                !!input.pin,
                pinHash,
            ]
        );
    });

    return {
        id,
        hubId: input.hubId,
        productUserId: input.productUserId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString("base64"),
        signCount: credential.counter,
        label: input.label ?? null,
        hasPin: !!input.pin,
        pinHash,
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
    };
}

/**
 * Generate authentication options for passkey login.
 */
export async function beginAuthentication(input: {
    hubId: string;
    productUserId?: string;
}): Promise<PublicKeyCredentialRequestOptions> {
    let credentials: { credential_id: string }[] = [];

    if (input.productUserId) {
        credentials = await withDb(async (db) => {
            const result = await db.query<{ credential_id: string }>(
                "select credential_id from webauthn_credentials where product_user_id = $1 and hub_id = $2",
                [input.productUserId, input.hubId]
            );
            return result.rows;
        });
    }

    const opts = await generateAuthenticationOptions({
        rpID,
        allowCredentials: credentials.map((c) => ({
            id: c.credential_id,
            type: "public-key",
        })),
        userVerification: "preferred",
    });

    await storeChallenge(input.hubId, input.productUserId ?? "__any__", opts.challenge);

    return opts as unknown as PublicKeyCredentialRequestOptions;
}

/**
 * Verify an authentication assertion and return the authenticated productUserId.
 */
export async function completeAuthentication(input: {
    hubId: string;
    response: AuthenticationResponseJSON;
}): Promise<{ productUserId: string; credentialId: string }> {
    const challenge = await popChallenge(input.hubId, "__any__");
    if (!challenge) {
        throw new Error("Authentication challenge expired. Please try again.");
    }

    const credential = await withDb(async (db) => {
        const result = await db.query<WebAuthnCredential>(
            "select * from webauthn_credentials where credential_id = $1 and hub_id = $2",
            [input.response.id, input.hubId]
        );
        return result.rows[0] ?? null;
    });

    if (!credential) {
        throw new Error("Unknown credential. This passkey is not registered on this hub.");
    }

    const verification = await verifyAuthenticationResponse({
        response: input.response,
        expectedChallenge: challenge,
        expectedOrigin: rpOrigin,
        expectedRPID: rpID,
        credential: {
            id: credential.credentialId,
            publicKey: Buffer.from(credential.publicKey, "base64"),
            counter: credential.signCount,
        },
    });

    if (!verification.verified) {
        throw new Error("Authentication verification failed.");
    }

    // Update sign count
    await withDb(async (db) => {
        await db.query(
            `update webauthn_credentials set sign_count = $1, last_used_at = now()
             where credential_id = $2 and hub_id = $3`,
            [verification.authenticationInfo.newCounter, input.response.id, input.hubId]
        );
    });

    return { productUserId: credential.productUserId, credentialId: credential.credentialId };
}

/**
 * List credentials for a user on a hub.
 */
export async function listCredentials(hubId: string, productUserId: string): Promise<WebAuthnCredential[]> {
    return withDb(async (db) => {
        const result = await db.query<WebAuthnCredential>(
            `select id, hub_id as "hubId", product_user_id as "productUserId", credential_id as "credentialId",
                    public_key as "publicKey", sign_count as "signCount", label, has_pin as "hasPin",
                    pin_hash as "pinHash", created_at as "createdAt", last_used_at as "lastUsedAt"
             from webauthn_credentials
             where product_user_id = $1 and hub_id = $2
             order by created_at desc`,
            [productUserId, hubId]
        );
        return result.rows;
    });
}

/**
 * Remove a credential.
 */
export async function removeCredential(id: string, productUserId: string): Promise<void> {
    await withDb(async (db) => {
        await db.query("delete from webauthn_credentials where id = $1 and product_user_id = $2", [id, productUserId]);
    });
}

// --- Challenge store (in-memory — fine for single-node deployment) ---

const challengeStore = new Map<string, { challenge: string; expiresAt: number }>();

function challengeKey(hubId: string, productUserId: string): string {
    return `${hubId}:${productUserId}`;
}

async function storeChallenge(hubId: string, productUserId: string, challenge: string): Promise<void> {
    challengeStore.set(challengeKey(hubId, productUserId), {
        challenge,
        expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
    });
}

async function popChallenge(hubId: string, productUserId: string): Promise<string | null> {
    const key = challengeKey(hubId, productUserId);
    const entry = challengeStore.get(key);
    if (!entry || Date.now() > entry.expiresAt) {
        challengeStore.delete(key);
        return null;
    }
    challengeStore.delete(key);
    return entry.challenge;
}

// --- Minimal bcrypt via Node crypto ---

export async function bcryptHash(input: string): Promise<string> {
    const salt = crypto.randomBytes(16).toString("hex");
    return new Promise((resolve, reject) => {
        crypto.scrypt(input, salt, 64, (err, derived) => {
            if (err) reject(err);
            else resolve(`${salt}:${derived.toString("hex")}`);
        });
    });
}

export async function bcryptVerify(input: string, hash: string): Promise<boolean> {
    const [salt, expected] = hash.split(":");
    if (!salt || !expected) return false;
    return new Promise((resolve, reject) => {
        crypto.scrypt(input, salt, 64, (err, derived) => {
            if (err) reject(err);
            else resolve(derived.toString("hex") === expected);
        });
    });
}
