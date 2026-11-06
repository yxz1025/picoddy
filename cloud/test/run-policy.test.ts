import assert from 'node:assert/strict';
import test from 'node:test';

import { parseRunRuntimeSelection } from '../src/cloud/runs/service.ts';
import { HttpError } from '../src/shared/errors.ts';
import { resolveCloudRuntimeProfile } from '../src/agent/tools/contracts.ts';
import type { RunSelection } from '../src/cloud/runs/types.ts';

test('new run submissions have explicit assistant craft full defaults', () => {
  assert.deepEqual(parseRunRuntimeSelection({}), {
    runtimeProfile: { mode: 'craft', category: 'assistant' },
    permission: 'full',
  });
  assert.deepEqual(parseRunRuntimeSelection({
    mode: 'plan', category: 'assistant', permission: 'readonly',
  }), {
    runtimeProfile: { mode: 'plan', category: 'assistant' },
    permission: 'readonly',
  });
});

test('stored runs without frozen runtime permissions fail closed', () => {
  assert.throws(() => resolveCloudRuntimeProfile({} as RunSelection), /runtime|profile|mode/i);
  assert.throws(() => resolveCloudRuntimeProfile({ runtimeProfile: { mode: 'craft', category: 'assistant' } } as RunSelection), /permission/i);
});

test('run runtime selection rejects unsupported modes, categories, and permissions', () => {
  for (const [input, code] of [
    [{ mode: 'creator' }, 'MODE_UNSUPPORTED'],
    [{ category: 'unsupported_category' }, 'CATEGORY_UNSUPPORTED'],
    [{ permission: 'L1' }, 'PERMISSION_UNSUPPORTED'],
  ] as const) {
    assert.throws(
      () => parseRunRuntimeSelection(input),
      (error: unknown) => error instanceof HttpError && error.status === 400 && error.code === code,
    );
  }
});
