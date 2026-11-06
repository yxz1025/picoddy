import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_ARTIFACT_PANEL_WIDTH,
  clampArtifactPanelWidth,
  getArtifactPanelMaxWidth,
  shouldAutoOpenArtifactPanel,
} from "./artifactPanelModel";

test("clamps the artifact panel width to its supported range", () => {
  assert.equal(clampArtifactPanelWidth(240, 1200), 300);
  assert.equal(clampArtifactPanelWidth(520, 1200), 520);
  assert.equal(clampArtifactPanelWidth(900, 1200), 720);
});

test("uses a safe default width and keeps max width above min width", () => {
  assert.equal(DEFAULT_ARTIFACT_PANEL_WIDTH, 360);
  assert.equal(getArtifactPanelMaxWidth(400), 300);
  assert.equal(getArtifactPanelMaxWidth(1600), 960);
});

test("reserves room for the requirement conversation when preview is open", () => {
  const projectLayout = { projectLayout: true, sidebarCollapsed: false };
  assert.equal(getArtifactPanelMaxWidth(1180, projectLayout), 480);
  assert.equal(clampArtifactPanelWidth(708, 1180, projectLayout), 480);
  assert.equal(getArtifactPanelMaxWidth(1180, { ...projectLayout, sidebarCollapsed: true }), 708);
});

test("reserves a readable chat column beside previews in every category", () => {
  assert.equal(
    getArtifactPanelMaxWidth(1200, { sidebarCollapsed: false }),
    500,
  );
  assert.equal(
    getArtifactPanelMaxWidth(1200, { sidebarCollapsed: true }),
    720,
  );
});

test("does not auto-open generic artifacts for skill creation", () => {
  assert.equal(shouldAutoOpenArtifactPanel("skill_creator"), false);
  assert.equal(shouldAutoOpenArtifactPanel("assistant"), true);
  assert.equal(shouldAutoOpenArtifactPanel(undefined), true);
});
