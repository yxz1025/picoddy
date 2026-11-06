import assert from 'node:assert/strict';
import test from 'node:test';
import { connectorBadge } from './connectorBadgeModel';

test('connector badges identify common connectors with distinct stable colors', () => {
  const gitlab = connectorBadge({ id: 'gitlab', displayName: 'GitLab' });
  const jenkins = connectorBadge({ id: 'jenkins', displayName: 'Jenkins' });
  assert.equal(gitlab.initial, 'G');
  assert.equal(jenkins.initial, 'J');
  assert.notEqual(gitlab.hue, jenkins.hue);
  assert.deepEqual(gitlab, connectorBadge({ id: 'gitlab', displayName: 'GitLab' }));
});
test('badges support Chinese names and missing labels without falling back to generic links', () => {
  assert.equal(connectorBadge({ id: 'dingtalk', displayName: '钉钉' }).initial, '钉');
  assert.equal(connectorBadge({ id: 'gitlab', displayName: '  ' }).initial, 'G');
  assert.equal(connectorBadge({ id: 'custom', displayName: '  📦 alpha' }).initial, 'A');
});
