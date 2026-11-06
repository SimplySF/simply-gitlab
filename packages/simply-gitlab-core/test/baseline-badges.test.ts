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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyTarget } from '../src/baseline-apply.js';
import { validateBaselineConfig } from '../src/baseline-config.js';
import { exportProject } from '../src/baseline-export.js';
import { planProject, type TargetPlan } from '../src/baseline-plan.js';
import { GitLabClient } from '../src/gitlab-client.js';
import { respondJson, startTestServer, type TestServer } from '../src/testing.js';

let server: TestServer;

beforeEach(async () => {
  server = await startTestServer();
});

afterEach(async () => {
  await server.close();
});

function client(): GitLabClient {
  return new GitLabClient({ url: server.baseUrl, token: 'glpat-testing' });
}

const BADGES = '/api/v4/projects/group%2Fproject/badges';
const target = { path: 'group/project', id: 7 };

const LINK = 'https://example.test/%{project_path}';
const IMAGE = 'https://example.test/%{project_path}/badge.svg';

const pipeline = {
  id: 1,
  name: 'Pipeline',
  link_url: LINK,
  image_url: IMAGE,
  rendered_link_url: 'https://example.test/group/project',
  rendered_image_url: 'https://example.test/group/project/badge.svg',
  kind: 'project',
};
const inherited = { ...pipeline, id: 2, name: 'Inherited', kind: 'group' };
const unnamed = { ...pipeline, id: 3, name: null };

function stubBadges(badges: unknown[]): void {
  server.route(BADGES, (_req, res) => {
    respondJson(res, 200, badges);
  });
}

function badgeSection(plan: TargetPlan) {
  return plan.sections.find((entry) => entry.section === 'badges');
}

function writes(): string[] {
  return server.requests.filter((request) => request.method !== 'GET').map((r) => `${r.method} ${r.url}`);
}

describe('exportProject: badges', () => {
  it('exports a project badge with its raw URLs only', async () => {
    stubBadges([pipeline]);

    const desired = await exportProject(client(), 'group/project', { sections: ['badges'] });

    expect(desired.badges).toStrictEqual([{ name: 'Pipeline', link_url: LINK, image_url: IMAGE }]);
  });

  it('leaves out inherited and unnamed badges', async () => {
    stubBadges([pipeline, inherited, unnamed]);

    const desired = await exportProject(client(), 'group/project', { sections: ['badges'] });

    expect(desired.badges).toStrictEqual([{ name: 'Pipeline', link_url: LINK, image_url: IMAGE }]);
  });
});

describe('planProject: badges', () => {
  it('reports nothing when the raw URLs match, placeholders included', async () => {
    stubBadges([pipeline]);

    const plan = await planProject(client(), target, {
      badges: [{ name: 'Pipeline', link_url: LINK, image_url: IMAGE }],
    });

    expect(badgeSection(plan)?.changes).toStrictEqual([]);
  });

  it('plans a create for a badge the project does not have', async () => {
    stubBadges([]);
    const entry = { name: 'Pipeline', link_url: LINK, image_url: IMAGE };

    const plan = await planProject(client(), target, { badges: [entry] });

    expect(badgeSection(plan)?.actions).toStrictEqual([{ kind: 'createBadge', body: entry }]);
  });

  it('plans an update by id, sending only what differs', async () => {
    stubBadges([pipeline]);

    const plan = await planProject(client(), target, {
      badges: [{ name: 'Pipeline', image_url: 'https://new.test/b' }],
    });

    expect(badgeSection(plan)?.actions).toStrictEqual([
      { kind: 'updateBadge', badgeId: 1, body: { image_url: 'https://new.test/b' } },
    ]);
  });

  it('fails the target when a new badge is missing a URL', async () => {
    stubBadges([]);

    const plan = await planProject(client(), target, { badges: [{ name: 'Pipeline', link_url: LINK }] });

    expect(plan.error).toMatch(/Badge "Pipeline" does not exist on this project/);
  });

  it('never reports or prunes an inherited badge', async () => {
    stubBadges([inherited]);

    const plan = await planProject(client(), target, { badges: { prune: true, entries: [] } });

    expect(badgeSection(plan)?.changes).toStrictEqual([]);
    expect(badgeSection(plan)?.actions).toStrictEqual([]);
  });

  it('reports each unnamed badge separately, without deleting unless pruning', async () => {
    stubBadges([unnamed, { ...unnamed, id: 4, name: '' }]);

    const plan = await planProject(client(), target, { badges: [] });

    expect(badgeSection(plan)?.changes.map((change) => change.key)).toStrictEqual([
      '(unnamed badge 3)',
      '(unnamed badge 4)',
    ]);
    expect(badgeSection(plan)?.actions).toStrictEqual([]);
  });

  it('prunes an undeclared badge by id', async () => {
    stubBadges([pipeline, unnamed]);

    const plan = await planProject(client(), target, { badges: { prune: true, entries: [] } });

    expect(badgeSection(plan)?.actions).toStrictEqual([
      { kind: 'deleteBadge', badgeId: 1 },
      { kind: 'deleteBadge', badgeId: 3 },
    ]);
  });
});

describe('applyTarget: badges', () => {
  it('creates, updates, and deletes through the badge endpoints', async () => {
    const stale = { ...pipeline, id: 5, name: 'Stale' };
    server.route(BADGES, (req, res) => {
      if (req.method === 'POST') respondJson(res, 201, { id: 9 });
      else respondJson(res, 200, [pipeline, stale]);
    });
    server.route(`${BADGES}/1`, (_req, res) => {
      respondJson(res, 200, {});
    });
    server.route(`${BADGES}/5`, (_req, res) => {
      respondJson(res, 200, {});
    });

    const plan = await planProject(client(), target, {
      badges: {
        prune: true,
        entries: [
          { name: 'Pipeline', link_url: 'https://new.test/l' },
          { name: 'Coverage', link_url: LINK, image_url: IMAGE },
        ],
      },
    });
    const result = await applyTarget(client(), plan);

    expect(result.error).toBeUndefined();
    expect(writes()).toStrictEqual([`PUT ${BADGES}/1`, `POST ${BADGES}`, `DELETE ${BADGES}/5`]);
  });
});

describe('validateBaselineConfig: badges', () => {
  it('requires a name', () => {
    expect(() =>
      validateBaselineConfig({ version: 1, project: { badges: [{ link_url: LINK, image_url: IMAGE }] } }),
    ).toThrow(/project\.badges\[0\]\.name: is required/);
  });

  it('refuses two badges with the same name', () => {
    expect(() =>
      validateBaselineConfig({ version: 1, project: { badges: [{ name: 'Pipeline' }, { name: 'Pipeline' }] } }),
    ).toThrow(/duplicates project\.badges\[0\]/);
  });
});
