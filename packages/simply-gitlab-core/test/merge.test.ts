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
import { ConfigError, HttpError } from '../src/errors.js';
import { GitLabClient } from '../src/gitlab-client.js';
import {
  assertSkipTrainAllowed,
  buildMergeBody,
  describeMergeOutcome,
  executeMerge,
  prepareMerge,
} from '../src/merge-requests.js';
import { respondJson, startTestServer, type TestServer } from '../src/testing.js';

const SHA = 'a'.repeat(40);
const MR_PATH = '/api/v4/projects/group%2Fproject/merge_requests/42';

describe('buildMergeBody', () => {
  it('maps each input onto its GitLab field and omits what was not given', () => {
    expect(
      buildMergeBody({
        sha: SHA,
        squash: false,
        removeSourceBranch: true,
        mergeCommitMessage: 'm',
        squashCommitMessage: 's',
      }),
    ).toStrictEqual({
      sha: SHA,
      squash: false,
      should_remove_source_branch: true,
      merge_commit_message: 'm',
      squash_commit_message: 's',
    });
    expect(buildMergeBody({})).toStrictEqual({});
  });

  it('sends auto_merge, never the deprecated merge_when_pipeline_succeeds', () => {
    expect(buildMergeBody({ autoMerge: true })).toStrictEqual({ auto_merge: true });
  });

  it('sends skip_merge_train with the sha it requires', () => {
    expect(buildMergeBody({ skipMergeTrain: true, sha: SHA })).toStrictEqual({ sha: SHA, skip_merge_train: true });
  });

  it('refuses to skip the train without naming the commit', () => {
    expect(() => buildMergeBody({ skipMergeTrain: true })).toThrow(/--skip-merge-train needs --sha/);
  });

  it('refuses auto-merge and skipping the train together', () => {
    expect(() => buildMergeBody({ autoMerge: true, skipMergeTrain: true, sha: SHA })).toThrow(ConfigError);
  });

  it('refuses a short or malformed sha, since GitLab compares the full head', () => {
    expect(() => buildMergeBody({ sha: 'abc1234' })).toThrow(/full commit sha/);
    expect(() => buildMergeBody({ sha: 'b'.repeat(64) })).not.toThrow();
  });
});

describe('assertSkipTrainAllowed', () => {
  it('names the fix for each project state that cannot skip the train', () => {
    expect(() => assertSkipTrainAllowed({ merge_trains_enabled: false })).toThrow(/no train to skip/);
    expect(() =>
      assertSkipTrainAllowed({ merge_trains_enabled: true, merge_trains_skip_train_allowed: false }),
    ).toThrow(/Merge immediately without restarting the merge train/);
    expect(() => assertSkipTrainAllowed({ merge_trains_skip_train_allowed: true, merge_method: 'ff' })).toThrow(
      /fast-forward/,
    );
    expect(() => assertSkipTrainAllowed({ merge_method: 'rebase_merge' })).toThrow(/semi-linear/);
  });

  it('leaves an attribute the instance does not report for GitLab to answer', () => {
    expect(() => assertSkipTrainAllowed({ merge_method: 'merge' })).not.toThrow();
  });
});

describe('merging against an instance', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  function client(): GitLabClient {
    return new GitLabClient({ url: server.baseUrl, token: 'glpat-0123456789abcdef' });
  }

  function stubProject(settings: Record<string, unknown>): void {
    server.route('/api/v4/projects/group%2Fproject', (_req, res) => respondJson(res, 200, settings));
  }

  it('reads nothing before a plain merge', async () => {
    await prepareMerge(client(), 'group/project', 42, { sha: SHA });
    expect(server.requests).toHaveLength(0);
  });

  it('refuses to skip the train before sending anything when the project does not allow it', async () => {
    stubProject({ merge_trains_enabled: true, merge_trains_skip_train_allowed: false });

    await expect(prepareMerge(client(), 'group/project', 42, { skipMergeTrain: true, sha: SHA })).rejects.toThrow(
      ConfigError,
    );
    expect(server.requests.map((request) => request.method)).toStrictEqual(['GET']);
  });

  it('reports a merge request that joined the train as such', async () => {
    stubProject({ merge_trains_enabled: true });
    server.route(`${MR_PATH}/merge`, (_req, res) =>
      respondJson(res, 200, { iid: 42, state: 'opened', target_branch: 'main' }),
    );

    const c = client();
    const outcome = await executeMerge(
      c,
      'group/project',
      await prepareMerge(c, 'group/project', 42, { autoMerge: true }),
    );

    expect(outcome.kind).toBe('mergeTrain');
    expect(describeMergeOutcome(outcome)).toBe('!42 joined the merge train for main.');
    expect(server.requests[1]).toMatchObject({ method: 'PUT', url: `${MR_PATH}/merge` });
    expect(JSON.parse(server.requests[1]?.body ?? '{}')).toStrictEqual({ auto_merge: true });
  });

  it('reports auto-merge without a train as merging when checks pass', async () => {
    stubProject({ merge_trains_enabled: false });
    server.route(`${MR_PATH}/merge`, (_req, res) =>
      respondJson(res, 200, { iid: 42, state: 'opened', target_branch: 'main' }),
    );

    const c = client();
    const outcome = await executeMerge(
      c,
      'group/project',
      await prepareMerge(c, 'group/project', 42, { autoMerge: true }),
    );

    expect(describeMergeOutcome(outcome)).toBe('!42 will merge into main when its checks pass.');
  });

  it('reports a merge with its commit', async () => {
    server.route(`${MR_PATH}/merge`, (_req, res) =>
      respondJson(res, 200, { iid: 42, state: 'merged', target_branch: 'main', merge_commit_sha: 'c'.repeat(40) }),
    );

    const outcome = await executeMerge(client(), 'group/project', { iid: 42, body: {} });

    expect(describeMergeOutcome(outcome)).toBe('Merged !42 into main (cccccccc).');
  });

  it('explains a 405 by reading the merge status back', async () => {
    server.route(`${MR_PATH}/merge`, (_req, res) => respondJson(res, 405, { message: '405 Method Not Allowed' }));
    server.route(MR_PATH, (_req, res) =>
      respondJson(res, 200, { iid: 42, state: 'opened', detailed_merge_status: 'not_approved' }),
    );

    await expect(executeMerge(client(), 'group/project', { iid: 42, body: {} })).rejects.toThrow(
      '!42 cannot be merged: it needs approval.',
    );
  });

  it('prints an unknown merge status as GitLab spelled it, without its control characters', async () => {
    server.route(`${MR_PATH}/merge`, (_req, res) => respondJson(res, 405, {}));
    server.route(MR_PATH, (_req, res) =>
      respondJson(res, 200, { state: 'opened', detailed_merge_status: 'new_status\nFAKE LINE' }),
    );

    const error = await executeMerge(client(), 'group/project', { iid: 42, body: {} }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).message).toContain('GitLab reports "new_status FAKE LINE"');
    expect((error as HttpError).message).not.toContain('\n');
  });

  it('suggests the train when a mergeable merge request is refused', async () => {
    server.route(`${MR_PATH}/merge`, (_req, res) => respondJson(res, 405, {}));
    server.route(MR_PATH, (_req, res) =>
      respondJson(res, 200, { state: 'opened', detailed_merge_status: 'mergeable' }),
    );

    await expect(executeMerge(client(), 'group/project', { iid: 42, body: {} })).rejects.toThrow(/--auto-merge/);
  });

  it('treats a 405 after a retried merge as success when the merged head is the one asked for', async () => {
    let attempts = 0;
    server.route(`${MR_PATH}/merge`, (_req, res) => {
      attempts += 1;
      if (attempts === 1) {
        // GitLab merged, then the proxy lost the answer.
        res.writeHead(502, { 'retry-after': '0' });
        res.end();
      } else {
        respondJson(res, 405, { message: '405 Method Not Allowed' });
      }
    });
    server.route(MR_PATH, (_req, res) =>
      respondJson(res, 200, { iid: 42, state: 'merged', sha: SHA, target_branch: 'main' }),
    );

    const outcome = await executeMerge(client(), 'group/project', { iid: 42, body: { sha: SHA } });

    expect(outcome).toMatchObject({ kind: 'merged', confirmedByReadBack: true });
    expect(describeMergeOutcome(outcome)).toMatch(/Confirmed by reading it back/);
  });

  it('does not claim a merge it cannot prove was this one', async () => {
    server.route(`${MR_PATH}/merge`, (_req, res) => respondJson(res, 405, {}));
    server.route(MR_PATH, (_req, res) =>
      respondJson(res, 200, {
        state: 'merged',
        sha: SHA,
        merged_by: { username: 'someone' },
        merged_at: '2026-10-26T10:00:00Z',
      }),
    );

    await expect(executeMerge(client(), 'group/project', { iid: 42, body: {} })).rejects.toThrow(
      '!42 is already merged by someone at 2026-10-26T10:00:00Z. Without --sha there is no telling whether that was this merge.',
    );
    await expect(executeMerge(client(), 'group/project', { iid: 42, body: { sha: 'b'.repeat(40) } })).rejects.toThrow(
      /Its head was a{40}, not b{40}/,
    );
  });

  it('says what each other refusal means', async () => {
    let status = 400;
    const messages: Record<number, string> = {
      400: 'SHA must be provided when merging',
      409: 'SHA does not match HEAD of source branch',
      422: 'Branch cannot be merged',
    };
    server.route(`${MR_PATH}/merge`, (_req, res) => respondJson(res, status, { message: messages[status] }));

    const merge = (): Promise<unknown> => executeMerge(client(), 'group/project', { iid: 42, body: { sha: SHA } });
    await expect(merge()).rejects.toThrow(/requires --sha/);
    status = 409;
    await expect(merge()).rejects.toThrow(`The source branch of !42 has moved since ${SHA}`);
    status = 422;
    await expect(merge()).rejects.toThrow(/conflict or a server hook.*Branch cannot be merged/);
  });
});
