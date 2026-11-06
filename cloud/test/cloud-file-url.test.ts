import assert from "node:assert/strict";
import test from "node:test";
import { cloudFileUrl } from "../web/desktop/src/utils/cloudFile.ts";

test("published file paths resolve only to an authenticated file endpoint", () => {
  const id = "b9fd0f70-3e63-4fc0-b5cd-0948025e3780";
  assert.equal(cloudFileUrl(`/cloud-files/${id}/report.html`), `/api/files/${id}/download`);
  assert.equal(cloudFileUrl("/etc/passwd"), null);
  assert.equal(cloudFileUrl("https://example.com/file"), null);
  assert.equal(cloudFileUrl(`/cloud-files/${id}/../../secret`), null);
});
