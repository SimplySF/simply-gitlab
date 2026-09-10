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

import { ConfigError } from './errors.js';
import { assertNotEmpty, mergeBody } from './json-input.js';

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
