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

import type { BaselineConfig, Entry, ProjectDesired } from './baseline-config.js';
import type { GitLabClient } from './gitlab-client.js';

/**
 * Reads a live project and writes down what it looks like, as a config someone can edit.
 *
 * Writing a baseline by hand against forty attributes is miserable and the first draft would be
 * wrong. Exporting the project that already looks right and deleting what you do not care about is
 * how anyone actually starts, so this errs towards saying too much: deleting a line is easier than
 * discovering that a key exists.
 */

/** The sections `export` can emit, in the order they appear in the file. */
export const EXPORTABLE_SECTIONS = [
  'settings',
  'protectedBranches',
  'protectedTags',
  'approvals',
  'approvalRules',
  'pushRules',
  'variables',
] as const;

export type ExportableSection = (typeof EXPORTABLE_SECTIONS)[number];

export interface ExportOptions {
  /** Which sections to emit. Defaults to all of them. */
  readonly sections?: readonly ExportableSection[];
}

/**
 * The project attributes worth putting in a baseline.
 *
 * A deliberate list rather than everything `GET /projects/:id` returns: that payload carries ids,
 * timestamps, counts, and URLs, none of which can be set and all of which would look like intent
 * once they were sitting in a config file.
 */
const SETTING_KEYS = [
  // Merge request behaviour
  'merge_method',
  'squash_option',
  'only_allow_merge_if_pipeline_succeeds',
  'only_allow_merge_if_all_discussions_are_resolved',
  'allow_merge_on_skipped_pipeline',
  'remove_source_branch_after_merge',
  'merge_trains_enabled',
  'printing_merge_request_link_enabled',
  'resolve_outdated_diff_discussions',
  'merge_requests_template',
  // CI/CD
  'ci_config_path',
  'build_timeout',
  'auto_cancel_pending_pipelines',
  'ci_default_git_depth',
  'ci_forward_deployment_enabled',
  'ci_separated_caches',
  'ci_allow_fork_pipelines_to_run_in_parent_project',
  'keep_latest_artifact',
  'auto_devops_enabled',
  'shared_runners_enabled',
  'group_runners_enabled',
  // Repository
  'default_branch',
  'issues_enabled',
  'wiki_enabled',
  'packages_enabled',
] as const;

/** Approval settings that can be set back, as opposed to reported. */
const APPROVAL_KEYS = [
  'approvals_before_merge',
  'reset_approvals_on_push',
  'disable_overriding_approvers_per_merge_request',
  'merge_requests_author_approval',
  'merge_requests_disable_committers_approval',
  'require_password_to_approve',
] as const;

/** Push-rule attributes, minus the id and the project it belongs to. */
const PUSH_RULE_KEYS = [
  'commit_message_regex',
  'commit_message_negative_regex',
  'branch_name_regex',
  'author_email_regex',
  'file_name_regex',
  'deny_delete_tag',
  'member_check',
  'prevent_secrets',
  'max_file_size',
  'commit_committer_check',
  'commit_committer_name_check',
  'reject_unsigned_commits',
  'reject_non_dco_commits',
] as const;

/** Protected-branch attributes, keeping the access arrays but dropping their server-side ids. */
const BRANCH_KEYS = ['name', 'allow_force_push', 'code_owner_approval_required'] as const;
const ACCESS_ARRAYS = ['push_access_levels', 'merge_access_levels', 'unprotect_access_levels'] as const;
const ACCESS_TARGET: Readonly<Record<string, string>> = {
  push_access_levels: 'allowed_to_push',
  merge_access_levels: 'allowed_to_merge',
  unprotect_access_levels: 'allowed_to_unprotect',
};

function asRecord(value: unknown): Record<string, unknown> {
  return (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
}

/** Copies the named keys that are actually present, so an absent attribute stays absent. */
function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) picked[key] = source[key];
  }
  return picked;
}

/**
 * Turns an access-level array as GitLab reports it into the shape it accepts back.
 *
 * The read shape carries `id` and `access_level_description`, neither of which is writable, and the
 * write shape is a different key. Exporting the raw read would produce a config that fails on its
 * first apply.
 */
function accessEntries(levels: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(levels)) return undefined;
  const mapped = levels.map((raw) => {
    const level = asRecord(raw);
    const entry: Record<string, unknown> = {};
    if (typeof level.user_id === 'number') entry.user_id = level.user_id;
    else if (typeof level.group_id === 'number') entry.group_id = level.group_id;
    else if (typeof level.access_level === 'number') entry.access_level = level.access_level;
    return entry;
  });
  return mapped.length === 0 ? undefined : mapped;
}

function exportBranch(raw: unknown): Entry {
  const branch = asRecord(raw);
  const entry = pick(branch, BRANCH_KEYS);
  for (const key of ACCESS_ARRAYS) {
    const mapped = accessEntries(branch[key]);
    if (mapped !== undefined) entry[ACCESS_TARGET[key]] = mapped;
  }
  return entry;
}

function exportTag(raw: unknown): Entry {
  const tag = asRecord(raw);
  const entry: Record<string, unknown> = { name: tag.name };
  const levels = Array.isArray(tag.create_access_levels) ? tag.create_access_levels.map(asRecord) : [];
  const first = levels[0];
  if (first !== undefined && typeof first.access_level === 'number') entry.create_access_level = first.access_level;
  return entry;
}

function exportRule(raw: unknown): Entry | undefined {
  const rule = asRecord(raw);
  // The implicit fallback rule is not something a config declares; exporting it would invite
  // someone to prune it and lose the project's default approval behaviour.
  if (rule.rule_type === 'any_approver') return undefined;

  const entry: Record<string, unknown> = { name: rule.name, approvals_required: rule.approvals_required };
  const usernames = (Array.isArray(rule.eligible_approvers) ? rule.eligible_approvers : [])
    .map((user) => asRecord(user).username)
    .filter((username): username is string => typeof username === 'string');
  if (usernames.length > 0) entry.usernames = usernames.sort();

  const groups = (Array.isArray(rule.groups) ? rule.groups : [])
    .map((group) => asRecord(group).full_path)
    .filter((path): path is string => typeof path === 'string');
  if (groups.length > 0) entry.groups = groups.sort();

  const branches = (Array.isArray(rule.protected_branches) ? rule.protected_branches : [])
    .map((branch) => asRecord(branch).name)
    .filter((name): name is string => typeof name === 'string');
  if (branches.length > 0) entry.protectedBranches = branches.sort();
  else if (rule.applies_to_all_protected_branches === true) entry.applies_to_all_protected_branches = true;

  return entry;
}

/** Variables are exported as metadata. The `value` GitLab returns is never copied into the file. */
function exportVariable(raw: unknown): Entry {
  const variable = asRecord(raw);
  return pick(variable, ['key', 'environment_scope', 'variable_type', 'protected', 'masked', 'raw']);
}

/** Reads a section, treating a Premium-only endpoint that refuses as simply absent. */
async function optional<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch {
    return undefined;
  }
}

/** Reads one project and returns the `project` block of a config describing it. */
export async function exportProject(
  client: GitLabClient,
  project: string,
  options: ExportOptions = {},
): Promise<ProjectDesired> {
  const wanted = new Set<string>(options.sections ?? EXPORTABLE_SECTIONS);
  const desired: Record<string, unknown> = {};

  if (wanted.has('settings')) {
    desired.settings = pick(asRecord(await client.getProject(project)), SETTING_KEYS);
  }
  if (wanted.has('protectedBranches')) {
    desired.protectedBranches = (await client.listProtectedBranches(project)).items.map(exportBranch);
  }
  if (wanted.has('protectedTags')) {
    desired.protectedTags = (await client.listProtectedTags(project)).items.map(exportTag);
  }
  if (wanted.has('approvals')) {
    const approvals = await optional(() => client.getApprovalSettings(project));
    if (approvals !== undefined) desired.approvals = pick(asRecord(approvals), APPROVAL_KEYS);
  }
  if (wanted.has('approvalRules')) {
    const rules = await optional(() => client.listApprovalRules(project));
    if (rules !== undefined) {
      desired.approvalRules = rules.items.map(exportRule).filter((rule): rule is Entry => rule !== undefined);
    }
  }
  if (wanted.has('pushRules')) {
    const pushRules = await optional(() => client.getPushRules(project));
    if (pushRules !== undefined && pushRules !== null) desired.pushRules = pick(asRecord(pushRules), PUSH_RULE_KEYS);
  }
  if (wanted.has('variables')) {
    const variables = await optional(() => client.listVariables(project, 200));
    if (variables !== undefined) desired.variables = variables.items.map(exportVariable);
  }

  return desired;
}

/** A whole config file describing one project, ready to be widened to a group of them. */
export async function exportConfig(
  client: GitLabClient,
  project: string,
  options: ExportOptions = {},
): Promise<BaselineConfig> {
  const desired = await exportProject(client, project, options);
  return {
    version: 1,
    // Deliberately the project it came from, not a group: whoever runs this next should choose the
    // blast radius on purpose rather than inherit one from an export.
    targets: { projects: [project] },
    project: desired,
  };
}
