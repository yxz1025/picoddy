import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('cloud removes project navigation, application panel and resource route', async () => {
  const sidebar = await readFile(new URL('../web/desktop/src/components/Sidebar.tsx', import.meta.url), 'utf8');
  const app = await readFile(new URL('../web/desktop/src/App.tsx', import.meta.url), 'utf8');
  const routes = await readFile(new URL('../src/transport/http/resources.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(sidebar, /id: "project"|<RecentRequirements/);
  assert.doesNotMatch(app, /<ProjectPanel|<ProjectAuthorization/);
  assert.doesNotMatch(routes, /\bprojects:\s/);
  assert.match(routes, /\bworkspaces:\s/);
});
