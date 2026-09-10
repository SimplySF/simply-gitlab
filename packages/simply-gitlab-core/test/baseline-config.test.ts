/*
 * Copyright (c) 2026, SimplySF.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, expect, it } from 'vitest';
import {
  effectiveProject,
  entryKey,
  mergeProjectDesired,
  normalizeSection,
  type ProjectDesired,
  validateBaselineConfig,
} from '../src/baseline-config.js';
import { ConfigError } from '../src/errors.js';
import { matchesExclude } from '../src/baseline-targets.js';

const minimal = { version: 1, targets: { groups: ['platform'] } };

describe('validateBaselineConfig', () => {
  it('accepts a minimal config', () => {
    expect(validateBaselineConfig(minimal).version).toBe(1);
  });

  it('reports every problem at once, with its path', () => {
    // Fixing a config one error per run, fifty projects into a change, is the loop that makes
    // people stop using the tool.
    let message = '';
    try {
      validateBaselineConfig({ version: 2, targets: { group: 'platform' }, nope: 1 });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/version: must be 1/);
    expect(message).toMatch(/targets\.group: is not a known key/);
    expect(message).toMatch(/nope: is not a known top-level key/);
  });

  it('requires targets to name something', () => {
    expect(() => validateBaselineConfig({ version: 1, targets: { exclude: ['x'] } })).toThrow(
      /must name at least one of/,
    );
  });

  it('rejects a section entry with no key field', () => {
    expect(() =>
      validateBaselineConfig({ ...minimal, project: { protectedBranches: [{ allow_force_push: false }] } }),
    ).toThrow(/project\.protectedBranches\[0\]\.name: is required/);
  });

  it('rejects two entries with the same identity', () => {
    // Two entries with one identity would silently reconcile against each other.
    expect(() =>
      validateBaselineConfig({
        ...minimal,
        project: { protectedBranches: [{ name: 'main' }, { name: 'main', allow_force_push: true }] },
      }),
    ).toThrow(/duplicates project\.protectedBranches\[0\]/);
  });

  it('treats an absent environment_scope as * when checking for duplicates', () => {
    expect(() =>
      validateBaselineConfig({
        ...minimal,
        project: { variables: [{ key: 'A' }, { key: 'A', environment_scope: '*' }] },
      }),
    ).toThrow(/duplicates/);
  });

  it('accepts a section written as an object with prune', () => {
    const config = validateBaselineConfig({
      ...minimal,
      project: { protectedBranches: { prune: true, entries: [{ name: 'main' }] } },
    });
    expect(normalizeSection(config.project?.protectedBranches)).toMatchObject({ prune: true });
  });

  it('requires entries when a section is written as an object', () => {
    expect(() => validateBaselineConfig({ ...minimal, project: { protectedBranches: { prune: true } } })).toThrow(
      /entries: is required/,
    );
  });

  it('refuses a config that is not an object', () => {
    expect(() => validateBaselineConfig([])).toThrow(ConfigError);
  });
});

describe('entryKey', () => {
  it('defaults a variable environment scope to *, as GitLab does', () => {
    expect(entryKey('variables', { key: 'A' })).toBe(entryKey('variables', { key: 'A', environment_scope: '*' }));
  });

  it('separates variables that differ only by scope', () => {
    expect(entryKey('variables', { key: 'A', environment_scope: 'production' })).not.toBe(
      entryKey('variables', { key: 'A' }),
    );
  });
});

describe('mergeProjectDesired', () => {
  const base: ProjectDesired = {
    settings: { merge_method: 'ff', build_timeout: 3600 },
    protectedBranches: [{ name: 'main', allow_force_push: false }, { name: 'release/*' }],
    approvalRules: [{ name: 'Two maintainers', approvals_required: 2 }],
  };

  it('merges object sections key by key', () => {
    const merged = mergeProjectDesired(base, { settings: { merge_method: 'merge' } });
    expect(merged.settings).toStrictEqual({ merge_method: 'merge', build_timeout: 3600 });
  });

  it('merges list entries by their natural key, leaving the rest alone', () => {
    // The whole point of a keyed merge: an override adjusts one entry rather than restating all.
    const merged = mergeProjectDesired(base, {
      approvalRules: [{ name: 'Two maintainers', approvals_required: 1 }],
    });
    expect(normalizeSection(merged.approvalRules)?.entries).toStrictEqual([
      { name: 'Two maintainers', approvals_required: 1 },
    ]);
  });

  it('keeps baseline fields an override does not mention', () => {
    const merged = mergeProjectDesired(base, {
      protectedBranches: [{ name: 'main', code_owner_approval_required: true }],
    });
    expect(normalizeSection(merged.protectedBranches)?.entries[0]).toStrictEqual({
      name: 'main',
      allow_force_push: false,
      code_owner_approval_required: true,
    });
  });

  it('appends an entry the baseline does not have', () => {
    const merged = mergeProjectDesired(base, { protectedBranches: [{ name: 'hotfix/*' }] });
    const names = normalizeSection(merged.protectedBranches)?.entries.map((entry) => entry.name);
    expect(names).toStrictEqual(['main', 'release/*', 'hotfix/*']);
  });

  it('replaces the whole list when the override says $replace', () => {
    const merged = mergeProjectDesired(base, {
      protectedBranches: { $replace: true, entries: [{ name: 'trunk' }] },
    });
    expect(normalizeSection(merged.protectedBranches)?.entries).toStrictEqual([{ name: 'trunk' }]);
  });

  it('lets an override turn pruning on for one project', () => {
    const merged = mergeProjectDesired(base, { protectedBranches: { prune: true, entries: [] } });
    expect(normalizeSection(merged.protectedBranches)?.prune).toBe(true);
  });

  it('leaves a section absent when neither side declares it', () => {
    expect(mergeProjectDesired({}, {}).protectedBranches).toBeUndefined();
  });
});

describe('effectiveProject', () => {
  it('applies the override keyed by the project path', () => {
    const config = validateBaselineConfig({
      ...minimal,
      project: { settings: { merge_method: 'ff' } },
      overrides: { 'platform/legacy': { project: { settings: { merge_method: 'merge' } } } },
    });
    expect(effectiveProject(config, 'platform/legacy').settings).toStrictEqual({ merge_method: 'merge' });
    expect(effectiveProject(config, 'platform/other').settings).toStrictEqual({ merge_method: 'ff' });
  });
});

describe('matchesExclude', () => {
  it('matches an exact path, case-insensitively', () => {
    expect(matchesExclude('platform/api', 'platform/api')).toBe(true);
    expect(matchesExclude('Platform/API', 'platform/api')).toBe(true);
    expect(matchesExclude('platform/apix', 'platform/api')).toBe(false);
  });

  it('drops a subtree with a trailing star', () => {
    expect(matchesExclude('platform/archived-one', 'platform/archived-*')).toBe(true);
    expect(matchesExclude('platform/live', 'platform/archived-*')).toBe(false);
  });
});
