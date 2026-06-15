import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.ABA_DISABLE_AUTOSTART = "1";

const originalInline = process.env.DB_CA_CERT;
const originalBase64 = process.env.DB_CA_CERT_BASE64;
const originalPath = process.env.DB_CA_CERT_PATH;
const originalSsl = process.env.DB_SSL;
const originalReject = process.env.DB_SSL_REJECT_UNAUTHORIZED;

const { resolveDbCaCert, postgresConfig } = await import("../server.js");

test.after(() => {
  if (originalInline === undefined) delete process.env.DB_CA_CERT;
  else process.env.DB_CA_CERT = originalInline;
  if (originalBase64 === undefined) delete process.env.DB_CA_CERT_BASE64;
  else process.env.DB_CA_CERT_BASE64 = originalBase64;
  if (originalPath === undefined) delete process.env.DB_CA_CERT_PATH;
  else process.env.DB_CA_CERT_PATH = originalPath;
  if (originalSsl === undefined) delete process.env.DB_SSL;
  else process.env.DB_SSL = originalSsl;
  if (originalReject === undefined) delete process.env.DB_SSL_REJECT_UNAUTHORIZED;
  else process.env.DB_SSL_REJECT_UNAUTHORIZED = originalReject;
});

test("resolveDbCaCert reads PEM text from DB_CA_CERT_PATH", async () => {
  delete process.env.DB_CA_CERT;
  delete process.env.DB_CA_CERT_BASE64;
  const dir = await mkdtemp(join(tmpdir(), "aba-ca-"));
  const certPath = join(dir, "rds-ca.pem");
  const pem = "-----BEGIN CERTIFICATE-----\nexample\n-----END CERTIFICATE-----\n";
  await writeFile(certPath, pem, "utf8");
  process.env.DB_CA_CERT_PATH = certPath;

  assert.equal(resolveDbCaCert(), pem);

  await rm(dir, { recursive: true, force: true });
});

test("resolveDbCaCert decodes base64 certificates", () => {
  delete process.env.DB_CA_CERT;
  delete process.env.DB_CA_CERT_PATH;
  const pem = "-----BEGIN CERTIFICATE-----\nbase64-example\n-----END CERTIFICATE-----\n";
  process.env.DB_CA_CERT_BASE64 = Buffer.from(pem, "utf8").toString("base64");

  assert.equal(resolveDbCaCert(), pem);
});

test("postgresConfig carries strict TLS verification with loaded CA cert", () => {
  process.env.DB_SSL = "true";
  process.env.DB_SSL_REJECT_UNAUTHORIZED = "true";
  process.env.DB_CA_CERT = "-----BEGIN CERTIFICATE-----\\ninline\\n-----END CERTIFICATE-----\\n";
  delete process.env.DB_CA_CERT_BASE64;
  delete process.env.DB_CA_CERT_PATH;

  const config = postgresConfig(class FakePool {});

  assert.equal(config.ssl, true);
  assert.equal(config.sslRejectUnauthorized, true);
  assert.match(config.caCert, /BEGIN CERTIFICATE/);
  assert.match(config.caCert, /\ninline\n/);
});
