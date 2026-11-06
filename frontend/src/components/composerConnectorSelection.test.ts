import assert from 'node:assert/strict';
import test from 'node:test';
import { addConnectorSelection, removeConnectorSelection } from './composerConnectorSelection';
const gitlab = { id: 'gitlab', displayName: 'GitLab', kind: 'mcp' as const };
const jenkins = { id: 'jenkins', displayName: 'Jenkins', kind: 'mcp' as const };
test('adding a connector keeps prior selections and does not duplicate repeated choices', () => {
  const first = addConnectorSelection([], gitlab);
  const both = addConnectorSelection(first, jenkins);
  assert.deepEqual(both, [gitlab, jenkins]);
  assert.deepEqual(addConnectorSelection(both, gitlab), both);
  assert.deepEqual(first, [gitlab]);
  assert.deepEqual(removeConnectorSelection(both, gitlab), [jenkins]);
});
test('identity includes connector kind, not just display name', () => {
  const cli = { ...gitlab, kind: 'managed-cli' as const };
  const both = addConnectorSelection([gitlab], cli);
  assert.equal(both.length, 2);
  assert.deepEqual(removeConnectorSelection(both, cli), [gitlab]);
});
