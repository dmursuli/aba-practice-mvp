import test from "node:test";
import assert from "node:assert/strict";

test("document upload falls back to local protected storage when S3 is unavailable", async () => {
  process.env.ABA_DISABLE_AUTOSTART = "1";
  const { saveClientDocument } = await import("../server.js");

  const client = {
    id: "client-1",
    profile: {
      documents: []
    }
  };

  let localPersisted = false;
  const document = await saveClientDocument(client, {
    documentType: "fba-assessment",
    fileName: "assessment-grid.pdf",
    mimeType: "application/pdf",
    fileSize: 12,
    dataUrl: "data:application/pdf;base64,SGVsbG8gd29ybGQ="
  }, {
    documentStore: "s3",
    putS3Object: async () => {
      throw new Error("AccessDenied");
    },
    persistLocal: async () => {
      localPersisted = true;
    }
  });

  assert.equal(localPersisted, true);
  assert.equal(document.storage, "local");
  assert.equal(document.s3Key, "");
  assert.match(document.storageWarning, /stored locally on the server/i);
  assert.equal(client.profile.documents[0].id, document.id);
  assert.match(document.url, /^\/uploads\//);
});
