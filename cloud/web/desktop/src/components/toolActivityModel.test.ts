import assert from "node:assert/strict";
import test from "node:test";

import { autoCorrectedToolCallIds } from "./toolActivityModel";

const validationError = "Validation failed for tool \"write_xlsx\": sheets is required";

test("marks a validation failure corrected by the next same-tool success", () => {
  const corrected = autoCorrectedToolCallIds([
    {
      id: "failed",
      toolName: "write_xlsx",
      content: validationError,
      status: "error",
    },
    { id: "success", toolName: "write_xlsx", status: "success" },
  ]);

  assert.deepEqual([...corrected], ["failed"]);
});

test("does not relabel unrelated or unrecovered failures", () => {
  const corrected = autoCorrectedToolCallIds([
    {
      id: "runtime-error",
      toolName: "write_xlsx",
      content: "EACCES: permission denied",
      status: "error",
    },
    { id: "runtime-success", toolName: "write_xlsx", status: "success" },
    {
      id: "different-tool",
      toolName: "write_xlsx",
      content: validationError,
      status: "error",
    },
    { id: "other-success", toolName: "write_docx", status: "success" },
    {
      id: "not-adjacent",
      toolName: "write_xlsx",
      content: validationError,
      status: "error",
    },
    { id: "read", toolName: "read", status: "success" },
    { id: "later-success", toolName: "write_xlsx", status: "success" },
    {
      id: "still-failed",
      toolName: "write_xlsx",
      content: validationError,
      status: "error",
    },
    {
      id: "retry-failed",
      toolName: "write_xlsx",
      content: validationError,
      status: "error",
    },
  ]);

  assert.equal(corrected.size, 0);
});

test("marks an unknown read_xlsx call corrected by a same-path read_doc success", () => {
  const corrected = autoCorrectedToolCallIds([
    {
      id: "failed",
      toolName: "read_xlsx",
      toolArgs: JSON.stringify({
        path: "C:\\Users\\tester\\AppData\\Local\\Pi-a\\attachments\\1\\report.xlsx",
      }),
      content: 'Tool "read_xlsx" not found',
      status: "error",
    },
    {
      id: "success",
      toolName: "read_doc",
      toolArgs: JSON.stringify({
        path: "c:/users/tester/AppData/Local/Pi-a/attachments/1/report.xlsx",
      }),
      status: "success",
    },
  ]);

  assert.deepEqual([...corrected], ["failed"]);
});

test("does not relabel unknown read_xlsx failures without an exact recovery", () => {
  const path = "C:\\work\\report.xlsx";
  const messages = [
    {
      id: "different-path",
      toolName: "read_xlsx",
      toolArgs: JSON.stringify({ path }),
      content: "Tool read_xlsx not found",
      status: "error" as const,
    },
    {
      id: "different-path-success",
      toolName: "read_doc",
      toolArgs: JSON.stringify({ path: "C:\\work\\other.xlsx" }),
      status: "success" as const,
    },
    {
      id: "different-error",
      toolName: "read_xlsx",
      toolArgs: JSON.stringify({ path }),
      content: "EACCES: permission denied",
      status: "error" as const,
    },
    {
      id: "different-error-success",
      toolName: "read_doc",
      toolArgs: JSON.stringify({ path }),
      status: "success" as const,
    },
    {
      id: "missing-args",
      toolName: "read_xlsx",
      content: 'Tool "read_xlsx" not found',
      status: "error" as const,
    },
    {
      id: "missing-args-success",
      toolName: "read_doc",
      toolArgs: JSON.stringify({ path }),
      status: "success" as const,
    },
    {
      id: "retry-failed",
      toolName: "read_xlsx",
      toolArgs: JSON.stringify({ path }),
      content: 'Tool "read_xlsx" not found',
      status: "error" as const,
    },
    {
      id: "read-doc-failed",
      toolName: "read_doc",
      toolArgs: JSON.stringify({ path }),
      status: "error" as const,
    },
  ];

  assert.equal(autoCorrectedToolCallIds(messages).size, 0);
});
