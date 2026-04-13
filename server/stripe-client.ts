import Stripe from "stripe";
import crypto from "crypto";
import type { Pool } from "pg";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
// Tag is embedded in the encrypted output by getAuthTag()

function getEncryptionKey(): Buffer {
  const key = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!key || key.length < 16) {
    throw new Error(
      "INTEGRATION_ENCRYPTION_KEY environment variable is required and must be at least 16 characters. Generate one with: openssl rand -hex 32",
    );
  }
  // Derive a 32-byte key from the secret
  return crypto.createHash("sha256").update(key).digest();
}

export function encryptApiKey(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  // Store as iv:tag:ciphertext, all base64
  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptApiKey(ciphertext: string): string {
  const key = getEncryptionKey();
  const [ivB64, tagB64, encB64] = ciphertext.split(":");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const encrypted = Buffer.from(encB64, "base64");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final("utf8");
}

export async function getUncachableStripeClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY environment variable is required");
  }
  return new Stripe(secretKey, {
    apiVersion: "2025-08-27.basil" as Stripe.LatestApiVersion,
  });
}

export async function getStripeClientForUser(
  pool: Pool,
  userId: string,
): Promise<Stripe> {
  const result = await pool.query(
    `SELECT encrypted_api_key FROM integrations WHERE user_id = $1 AND provider = 'stripe' AND encrypted_api_key IS NOT NULL`,
    [userId],
  );
  if (result.rows.length === 0) {
    throw new Error(
      "No Stripe integration found. Please connect Stripe first.",
    );
  }
  const secretKey = decryptApiKey(result.rows[0].encrypted_api_key);
  return new Stripe(secretKey, {
    apiVersion: "2025-08-27.basil" as Stripe.LatestApiVersion,
  });
}

export function createStripeClientFromKey(apiKey: string): Stripe {
  return new Stripe(apiKey, {
    apiVersion: "2025-08-27.basil" as Stripe.LatestApiVersion,
  });
}

export async function getStripePublishableKey() {
  const key = process.env.STRIPE_PUBLISHABLE_KEY;
  if (!key) {
    throw new Error("STRIPE_PUBLISHABLE_KEY environment variable is required");
  }
  return key;
}
