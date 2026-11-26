const encoder = new TextEncoder();

export function bytes(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(encoder.encode(value));
}

export function base64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}

async function verify(secret: Uint8Array<ArrayBuffer>, signature: Uint8Array<ArrayBuffer>, body: Uint8Array<ArrayBuffer>) {
  const key = await crypto.subtle.importKey("raw", secret, {name: "HMAC", hash: "SHA-256"}, false, ["verify"]);
  return crypto.subtle.verify("HMAC", key, signature, body);
}

export async function fctlSignature(headers: Headers, body: Uint8Array<ArrayBuffer>, secret: string): Promise<boolean> {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatures = headers.get("webhook-signature");
  if (!id || !/^evt_[A-Za-z0-9]{1,64}$/.test(id) || !timestamp || !/^\d{10}$/.test(timestamp) ||
      Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || !signatures || !secret?.startsWith("whsec_")) return false;
  try {
    const key = base64(secret.slice(6));
    if (key.length < 16) return false;
    const prefix = bytes(`${id}.${timestamp}.`);
    const signed = new Uint8Array(prefix.length + body.length);
    signed.set(prefix);
    signed.set(body, prefix.length);
    for (const part of signatures.split(" ")) {
      if (part.startsWith("v1,") && await verify(key, base64(part.slice(3)), signed)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

export async function githubSignature(headers: Headers, body: Uint8Array<ArrayBuffer>, secret: string): Promise<boolean> {
  const header = headers.get("x-hub-signature-256");
  if (!header || !/^sha256=[0-9a-f]{64}$/.test(header) || !secret) return false;
  const signature = Uint8Array.from(header.slice(7).match(/../g) ?? [], hex => parseInt(hex, 16));
  return verify(bytes(secret), signature, body);
}

export async function digest(body: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", body)), b => b.toString(16).padStart(2, "0")).join("");
}

export async function bearer(headers: Headers, secret: string): Promise<boolean> {
  const value = headers.get("authorization");
  if (!secret || !value) return false;
  const key = await crypto.subtle.importKey("raw", bytes(secret), {name: "HMAC", hash: "SHA-256"}, false, ["sign", "verify"]);
  const expected = await crypto.subtle.sign("HMAC", key, bytes(`Bearer ${secret}`));
  return crypto.subtle.verify("HMAC", key, expected, bytes(value));
}
