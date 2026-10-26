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

import { ConfigError, HttpError } from './errors.js';
import type { GitLabClient, ProjectRef } from './gitlab-client.js';
import { assertNotEmpty, mergeBody } from './json-input.js';
import { stripControlOneLine } from './text.js';

/**
 * Merge requests are addressed by their per-project `iid`, not the instance-wide `id`, and both
 * are bare integers that appear side by side in every payload. Passing the wrong one does not
 * fail: it silently addresses a different merge request in a different project that happens to
 * share the number. So the value is validated as an iid — small, positive, whole — and the error
 * says which of the two fields to read.
 */
export function assertIid(value: unknown, what = 'merge request'): number {
  const iid = typeof value === 'string' ? Number(value) : value;
  if (typeof iid !== 'number' || !Number.isInteger(iid) || iid < 1) {
    throw new ConfigError(
      `A ${what} is addressed by its project-scoped iid: a positive whole number, got ${JSON.stringify(value)}. ` +
        'It is the number in the web URL and the "iid" field of the API payload, not "id".',
    );
  }
  return iid;
}

export interface MergeRequestCreateInput {
  readonly sourceBranch?: string;
  readonly targetBranch?: string;
  readonly title?: string;
  readonly description?: string;
  readonly assigneeIds?: readonly number[];
  readonly reviewerIds?: readonly number[];
  readonly labels?: readonly string[];
  readonly milestoneId?: number;
  readonly removeSourceBranch?: boolean;
  readonly squash?: boolean;
  readonly draft?: boolean;
  readonly targetProjectId?: number;
  readonly body?: Record<string, unknown>;
}

/** GitLab marks a draft by the title prefix; there is no separate flag on the create endpoint. */
const DRAFT_PREFIX = 'Draft: ';

export function buildMergeRequestCreateBody(input: MergeRequestCreateInput): Record<string, unknown> {
  const title =
    input.title !== undefined && input.draft === true && !input.title.startsWith(DRAFT_PREFIX)
      ? `${DRAFT_PREFIX}${input.title}`
      : input.title;

  const merged = mergeBody(input.body, {
    source_branch: input.sourceBranch,
    target_branch: input.targetBranch,
    title,
    description: input.description,
    assignee_ids: input.assigneeIds,
    reviewer_ids: input.reviewerIds,
    labels: input.labels === undefined ? undefined : input.labels.join(','),
    milestone_id: input.milestoneId,
    remove_source_branch: input.removeSourceBranch,
    squash: input.squash,
    target_project_id: input.targetProjectId,
  });

  // Checked here so the refusal names the flag. GitLab's own 400 for a missing source branch is
  // `{"message":{"source_branch":["can't be blank"]}}`, which does not say how to supply one.
  for (const [key, flag] of [
    ['source_branch', '--source-branch'],
    ['target_branch', '--target-branch'],
    ['title', '--title'],
  ] as const) {
    if (typeof merged[key] !== 'string' || merged[key] === '') {
      throw new ConfigError(`A ${key.replace('_', ' ')} is required: pass ${flag}.`);
    }
  }

  return merged;
}

export interface MergeRequestUpdateInput {
  readonly title?: string;
  readonly description?: string;
  readonly targetBranch?: string;
  readonly assigneeIds?: readonly number[];
  readonly reviewerIds?: readonly number[];
  readonly labels?: readonly string[];
  readonly milestoneId?: number;
  readonly removeSourceBranch?: boolean;
  readonly squash?: boolean;
  readonly stateEvent?: 'close' | 'reopen';
  readonly body?: Record<string, unknown>;
}

export function buildMergeRequestUpdateBody(input: MergeRequestUpdateInput): Record<string, unknown> {
  return assertNotEmpty(
    mergeBody(input.body, {
      title: input.title,
      description: input.description,
      target_branch: input.targetBranch,
      assignee_ids: input.assigneeIds,
      reviewer_ids: input.reviewerIds,
      // Deliberately `labels`, which replaces the whole set, rather than add_labels/remove_labels.
      // One verb per flag: a flag that sometimes adds and sometimes replaces is the kind of thing
      // a caller discovers by losing labels.
      labels: input.labels === undefined ? undefined : input.labels.join(','),
      milestone_id: input.milestoneId,
      remove_source_branch: input.removeSourceBranch,
      squash: input.squash,
      state_event: input.stateEvent,
    }),
    'merge request',
  );
}

/** The web URL of a created or updated merge request, when the payload carries one. */
export function mergeRequestUrl(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const url = (payload as { web_url?: unknown }).web_url;
  return typeof url === 'string' ? url : undefined;
}

// --- Merging (docs/design/0011-merge-request-merge.md) ---

export interface MergeInput {
  /** The source branch head the caller reviewed. GitLab refuses with 409 if the branch has moved. */
  readonly sha?: string;
  /** Merge once checks pass; on a project with merge trains, this joins the train. */
  readonly autoMerge?: boolean;
  /** GitLab's experimental "merge immediately without restarting the merge train". */
  readonly skipMergeTrain?: boolean;
  readonly squash?: boolean;
  readonly removeSourceBranch?: boolean;
  readonly mergeCommitMessage?: string;
  readonly squashCommitMessage?: string;
}

/** What a merge did, which is not always "merged": auto-merge and the train both defer it. */
export type MergeOutcomeKind = 'merged' | 'autoMerge' | 'mergeTrain' | 'accepted';

export interface MergeOutcome {
  readonly kind: MergeOutcomeKind;
  /** The merge request as GitLab returned it, or as read back after a 405. */
  readonly mergeRequest: unknown;
  /** True when a 405 was answered by reading the merge request back and finding it merged as asked. */
  readonly confirmedByReadBack: boolean;
}

export interface PreparedMerge {
  readonly iid: number;
  readonly body: Record<string, unknown>;
  /** Read from the project only when it changes what happens; undefined otherwise. */
  readonly mergeTrainsEnabled?: boolean;
}

/** A full commit sha: 40 hex characters, or 64 in a SHA-256 repository. */
const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

export function buildMergeBody(input: MergeInput): Record<string, unknown> {
  if (input.autoMerge === true && input.skipMergeTrain === true) {
    throw new ConfigError(
      'Pass either --auto-merge or --skip-merge-train, not both: skipping the train merges now, and ' +
        'GitLab defines no meaning for skipping it later.',
    );
  }
  if (input.sha !== undefined && !FULL_SHA.test(input.sha)) {
    throw new ConfigError(
      `--sha must be the full commit sha of the source branch head, got ${JSON.stringify(input.sha)}. ` +
        'It is the "Head" line of mr view, or the "sha" field of its payload.',
    );
  }
  // The train exists so nothing merges untested. Skipping it is a bet on one commit, so the caller
  // names that commit, and a push made after the decision fails with 409 instead of riding along.
  if (input.skipMergeTrain === true && input.sha === undefined) {
    throw new ConfigError(
      '--skip-merge-train needs --sha: the head you reviewed, so that nothing pushed since then ' +
        'merges without the train testing it.',
    );
  }

  // `merge_when_pipeline_succeeds` is deliberately never sent: GitLab deprecated it in 17.11.
  const body: Record<string, unknown> = {
    sha: input.sha,
    auto_merge: input.autoMerge === true ? true : undefined,
    skip_merge_train: input.skipMergeTrain === true ? true : undefined,
    squash: input.squash,
    should_remove_source_branch: input.removeSourceBranch,
    merge_commit_message: input.mergeCommitMessage,
    squash_commit_message: input.squashCommitMessage,
  };
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
}

/**
 * Refuses `--skip-merge-train` on a project that cannot honour it, naming the setting to change.
 *
 * Only an attribute the instance reports as off counts. One it does not report at all, on an older
 * instance or with the feature flag turned off on Self-Managed, is left for GitLab to answer.
 */
export function assertSkipTrainAllowed(project: unknown): void {
  const settings = asRecord(project);
  if (settings.merge_trains_enabled === false) {
    throw new ConfigError(
      'This project does not use merge trains, so there is no train to skip. Merge without --skip-merge-train.',
    );
  }
  if (settings.merge_trains_skip_train_allowed === false) {
    throw new ConfigError(
      'This project does not allow skipping the merge train. A Maintainer can turn on "Merge immediately ' +
        'without restarting the merge train" under Settings > Merge requests > Merge options ' +
        '(merge_trains_skip_train_allowed).',
    );
  }
  if (settings.merge_method === 'ff' || settings.merge_method === 'rebase_merge') {
    throw new ConfigError(
      'GitLab does not support skipping the merge train with the fast-forward or semi-linear merge ' +
        `method, and this project uses ${settings.merge_method === 'ff' ? 'fast-forward' : 'semi-linear'}.`,
    );
  }
}

/**
 * Builds the request and runs the reads that decide whether it can be sent. Separate from
 * {@link executeMerge} so a dry run makes the same refusals a real run would.
 */
export async function prepareMerge(
  client: GitLabClient,
  project: ProjectRef,
  iid: number,
  input: MergeInput,
): Promise<PreparedMerge> {
  const body = buildMergeBody(input);
  if (input.skipMergeTrain !== true && input.autoMerge !== true) return { iid, body };

  const settings = asRecord(await client.getProject(project));
  if (input.skipMergeTrain === true) assertSkipTrainAllowed(settings);
  const trains = settings.merge_trains_enabled;
  return { iid, body, mergeTrainsEnabled: typeof trains === 'boolean' ? trains : undefined };
}

/** `detailed_merge_status` in words, for the statuses a caller can do something about. */
const MERGE_BLOCKERS: Readonly<Record<string, string>> = {
  not_approved: 'it needs approval',
  requested_changes: 'a reviewer has requested changes',
  ci_must_pass: 'its pipeline must pass first, or pass --auto-merge to merge when it does',
  ci_still_running: 'its pipeline is still running; pass --auto-merge to merge when it passes',
  draft_status: 'it is a draft',
  discussions_not_resolved: 'it has unresolved threads',
  conflict: 'it has merge conflicts',
  need_rebase: 'it needs a rebase onto the target branch',
  not_open: 'it is not open',
  blocked_status: 'it is blocked by another merge request',
  checking: 'GitLab is still checking whether it can merge; try again shortly',
  unchecked: 'GitLab has not yet checked whether it can merge; try again shortly',
  external_status_checks: 'an external status check has not passed',
  jira_association_missing: 'its title or description must reference a Jira issue',
  security_policy_violations: 'a security policy blocks it',
  merge_time: 'it is scheduled to merge later',
  locked_paths: 'it changes a locked path',
  locked_lfs_files: 'it changes a locked LFS file',
  title_regex: 'its title does not match the pattern the project requires',
  commits_status: 'its source branch has no commits',
};

function explainNotMergeable(iid: number, current: Record<string, unknown>, trainsEnabled?: boolean): string {
  const status = current.detailed_merge_status ?? current.merge_status;
  if ((status === 'mergeable' || status === 'can_be_merged') && trainsEnabled !== false) {
    // Mergeable, yet refused: the usual reason is merge train enforcement, which only lets a merge
    // request in through the train.
    return `!${iid} cannot be merged directly. If this project enforces merge trains, pass --auto-merge to join the train.`;
  }
  if (typeof status !== 'string') return `!${iid} cannot be merged, and GitLab did not say why.`;
  return `!${iid} cannot be merged: ${MERGE_BLOCKERS[status] ?? `GitLab reports "${stripControlOneLine(status)}"`}.`;
}

/**
 * A 405 that might be our own merge, reported back by a retry. It counts as a success only when
 * the merged head is the one the caller asked for; otherwise someone else may have merged first,
 * and the caller cannot know whose merge it was.
 */
function assertMergedAsAsked(iid: number, current: Record<string, unknown>, sha: string | undefined): void {
  if (sha !== undefined && typeof current.sha === 'string' && current.sha.toLowerCase() === sha.toLowerCase()) return;
  const by = asRecord(current.merged_by ?? current.merge_user).username;
  const who = typeof by === 'string' ? ` by ${stripControlOneLine(by)}` : '';
  const when = typeof current.merged_at === 'string' ? ` at ${stripControlOneLine(current.merged_at)}` : '';
  const head = typeof current.sha === 'string' ? stripControlOneLine(current.sha) : 'not reported';
  const why =
    sha === undefined
      ? 'Without --sha there is no telling whether that was this merge.'
      : `Its head was ${head}, not ${sha}.`;
  throw new HttpError(`!${iid} is already merged${who}${when}. ${why}`, 405, current);
}

function explainFailure(error: HttpError, iid: number, sha: string | undefined): Error {
  if (error.status === 400 && /sha/i.test(error.message)) {
    return new HttpError(
      'This group or instance requires --sha to merge. Pass the head you reviewed: the "Head" line of mr view. ' +
        `(${error.message})`,
      error.status,
      error.body,
    );
  }
  if (error.status === 409) {
    return new HttpError(
      `The source branch of !${iid} has moved since ${sha ?? 'the sha you passed'}. Review the new head, ` +
        'then pass its sha.',
      error.status,
      error.body,
    );
  }
  if (error.status === 422) {
    return new HttpError(
      `GitLab tried to merge !${iid} and could not, usually because of a conflict or a server hook. ` +
        `(${error.message})`,
      error.status,
      error.body,
    );
  }
  return error;
}

function outcomeKind(merged: Record<string, unknown>, prepared: PreparedMerge): MergeOutcomeKind {
  if (merged.state === 'merged') return 'merged';
  if (prepared.body.auto_merge === true) return prepared.mergeTrainsEnabled === true ? 'mergeTrain' : 'autoMerge';
  return 'accepted';
}

/** Sends a prepared merge and turns GitLab's bare refusals into reasons. */
export async function executeMerge(
  client: GitLabClient,
  project: ProjectRef,
  prepared: PreparedMerge,
): Promise<MergeOutcome> {
  const { iid, body } = prepared;
  const sha = typeof body.sha === 'string' ? body.sha : undefined;
  try {
    const merged = await client.mergeMergeRequest(project, iid, body);
    return { kind: outcomeKind(asRecord(merged), prepared), mergeRequest: merged, confirmedByReadBack: false };
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    if (error.status !== 405) throw explainFailure(error, iid, sha);

    // 405 covers every reason a merge request cannot merge and names none of them. The merge
    // request itself knows, and if a retried merge had already succeeded, it says that too.
    const current = asRecord(await client.getMergeRequest(project, iid));
    if (current.state === 'merged') {
      assertMergedAsAsked(iid, current, sha);
      return { kind: 'merged', mergeRequest: current, confirmedByReadBack: true };
    }
    throw new HttpError(explainNotMergeable(iid, current, prepared.mergeTrainsEnabled), 405, error.body);
  }
}

/** The one line a person reads after a merge. The caller prints it through `logSafe`. */
export function describeMergeOutcome(outcome: MergeOutcome): string {
  const mr = asRecord(outcome.mergeRequest);
  const ref = `!${typeof mr.iid === 'number' ? mr.iid : '?'}`;
  const target = typeof mr.target_branch === 'string' ? mr.target_branch : 'its target branch';
  switch (outcome.kind) {
    case 'merged': {
      const commit = mr.merge_commit_sha ?? mr.squash_commit_sha;
      const short = typeof commit === 'string' ? ` (${commit.slice(0, 8)})` : '';
      const note = outcome.confirmedByReadBack ? ' Confirmed by reading it back after GitLab refused a retry.' : '';
      return `Merged ${ref} into ${target}${short}.${note}`;
    }
    case 'mergeTrain':
      return `${ref} joined the merge train for ${target}.`;
    case 'autoMerge':
      return `${ref} will merge into ${target} when its checks pass.`;
    case 'accepted':
      return `GitLab accepted the merge of ${ref} into ${target} but has not finished it. Check with mr view.`;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
}
