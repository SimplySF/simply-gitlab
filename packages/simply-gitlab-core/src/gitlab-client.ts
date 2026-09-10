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

import { buildAuthHeaders } from './auth.js';
import type { GitLabConfig } from './config.js';
import { ConfigError } from './errors.js';
import { HttpTransport, type JsonCall, type QueryValue } from './http.js';

/** Everything a caller needs after following pages: the items plus why paging stopped. */
export interface ListResult<T = unknown> {
  readonly items: readonly T[];
  /** The instance's reported match count, when it reports one. */
  readonly total?: number;
  readonly pages: number;
  /** False when the caller's limit cut the results short. */
  readonly complete: boolean;
}

/** GitLab's own ceiling on `per_page`; asking for more is silently clamped to it. */
const MAX_PER_PAGE = 100;

/** How many pages one list call will follow before giving up, however small the page size. */
const MAX_PAGES = 100;

const API_BASE = '/api/v4';

export type ProjectRef = string | number;

export interface ListProjectsOptions {
  readonly membership?: boolean;
  readonly owned?: boolean;
  readonly simple?: boolean;
  readonly search?: string;
  readonly orderBy?: string;
  readonly sort?: 'asc' | 'desc';
}

export interface ListBranchesOptions {
  readonly search?: string;
}

export interface ListTagsOptions {
  readonly search?: string;
  readonly orderBy?: string;
  readonly sort?: 'asc' | 'desc';
}

export interface ListCommitsOptions {
  readonly ref?: string;
  readonly since?: string;
  readonly until?: string;
  readonly path?: string;
  readonly author?: string;
  readonly withStats?: boolean;
}

export type MergeRequestState = 'opened' | 'closed' | 'locked' | 'merged' | 'all';

export interface ListMergeRequestsOptions {
  readonly state?: MergeRequestState;
  readonly sourceBranch?: string;
  readonly targetBranch?: string;
  readonly search?: string;
  readonly authorUsername?: string;
  readonly reviewerUsername?: string;
  readonly labels?: readonly string[];
  readonly orderBy?: string;
  readonly sort?: 'asc' | 'desc';
}

export type JobScope =
  'created' | 'pending' | 'running' | 'failed' | 'success' | 'canceled' | 'skipped' | 'waiting_for_resource' | 'manual';

export interface ListJobsOptions {
  readonly scope?: readonly JobScope[];
}

export interface ListEnvironmentsOptions {
  readonly name?: string;
  readonly search?: string;
  readonly states?: 'available' | 'stopped';
}

export type SearchScope =
  | 'projects'
  | 'issues'
  | 'merge_requests'
  | 'milestones'
  | 'wiki_blobs'
  | 'commits'
  | 'blobs'
  | 'notes'
  | 'users'
  | 'snippet_titles';

export interface SearchOptions {
  readonly scope: SearchScope;
  readonly search: string;
  /** Narrow to one project. Mutually exclusive with `group`. */
  readonly project?: ProjectRef;
  /** Narrow to one group. Mutually exclusive with `project`. */
  readonly group?: ProjectRef;
  /** Only meaningful for the `blobs` scope: a `filename:`/`path:`-style filter GitLab understands. */
  readonly ref?: string;
}

export interface FileOptions {
  readonly ref: string;
}

export interface WriteFileInput {
  readonly branch: string;
  readonly content: string;
  readonly commitMessage: string;
  readonly encoding?: 'text' | 'base64';
  readonly authorEmail?: string;
  readonly authorName?: string;
  readonly startBranch?: string;
  /** Update only: the last known commit id for the file, so a concurrent edit is rejected. */
  readonly lastCommitId?: string;
}

export interface CommitAction {
  readonly action: 'create' | 'delete' | 'move' | 'update' | 'chmod';
  readonly file_path: string;
  readonly previous_path?: string;
  readonly content?: string;
  readonly encoding?: 'text' | 'base64';
  readonly last_commit_id?: string;
  readonly execute_filemode?: boolean;
}

/**
 * A path segment built from user input. GitLab addresses a project either by numeric id or by its
 * URL-encoded full path, so `group/project` has to arrive as `group%2Fproject` — an un-encoded
 * slash reads as a different route entirely and answers 404 with nothing pointing at the cause.
 */
function segment(value: ProjectRef): string {
  const text = String(value).trim();
  if (text === '') throw new ConfigError('A project id or path is required, but an empty value was given.');
  return encodeURIComponent(text);
}

/** Drops the entries a caller left unset so they never reach the query string as "undefined". */
function query(pairs: Record<string, QueryValue>): Record<string, QueryValue> {
  return Object.fromEntries(Object.entries(pairs).filter(([, value]) => value !== undefined));
}

/**
 * GitLab REST client. Owns the two things callers should never have to think about: addressing a
 * project by path rather than id, and following offset pagination to a caller's limit while
 * reporting honestly whether anything was left behind.
 */
export class GitLabClient {
  /** The instance this client talks to, for callers that need to render a URL beside a result. */
  public readonly url: string;
  private readonly transport: HttpTransport;

  public constructor(config: GitLabConfig) {
    this.url = config.url;
    this.transport = new HttpTransport({
      baseUrl: config.url,
      headers: buildAuthHeaders(config),
    });
  }

  // --- Projects ---

  public listProjects(options: ListProjectsOptions = {}, limit = 20): Promise<ListResult> {
    return this.collect(
      '/projects',
      query({
        membership: options.membership,
        owned: options.owned,
        simple: options.simple,
        search: options.search,
        order_by: options.orderBy,
        sort: options.sort,
      }),
      limit,
    );
  }

  public async getProject(project: ProjectRef): Promise<unknown> {
    return this.request(`/projects/${segment(project)}`, { method: 'GET' });
  }

  // --- Repository files ---

  public async getFile(project: ProjectRef, filePath: string, options: FileOptions): Promise<unknown> {
    return this.request(`/projects/${segment(project)}/repository/files/${segment(filePath)}`, {
      method: 'GET',
      query: { ref: options.ref },
    });
  }

  public async createFile(project: ProjectRef, filePath: string, input: WriteFileInput): Promise<unknown> {
    return this.request(`/projects/${segment(project)}/repository/files/${segment(filePath)}`, {
      method: 'POST',
      body: fileBody(input),
      mutating: true,
    });
  }

  public async updateFile(project: ProjectRef, filePath: string, input: WriteFileInput): Promise<unknown> {
    return this.request(`/projects/${segment(project)}/repository/files/${segment(filePath)}`, {
      method: 'PUT',
      body: fileBody(input),
      mutating: true,
    });
  }

  // --- Branches ---

  public async listBranches(project: ProjectRef, options: ListBranchesOptions = {}, limit = 20): Promise<ListResult> {
    return this.collect(`/projects/${segment(project)}/repository/branches`, query({ search: options.search }), limit);
  }

  public async createBranch(project: ProjectRef, branch: string, ref: string): Promise<unknown> {
    return this.request(`/projects/${segment(project)}/repository/branches`, {
      method: 'POST',
      body: { branch, ref },
      mutating: true,
    });
  }

  // --- Commits ---

  public async listCommits(project: ProjectRef, options: ListCommitsOptions = {}, limit = 20): Promise<ListResult> {
    return this.collect(
      `/projects/${segment(project)}/repository/commits`,
      query({
        ref_name: options.ref,
        since: options.since,
        until: options.until,
        path: options.path,
        author: options.author,
        with_stats: options.withStats,
      }),
      limit,
    );
  }

  public async getCommit(project: ProjectRef, sha: string): Promise<unknown> {
    return this.request(`/projects/${segment(project)}/repository/commits/${segment(sha)}`, { method: 'GET' });
  }

  public async getCommitDiff(project: ProjectRef, sha: string): Promise<unknown> {
    return this.request(`/projects/${segment(project)}/repository/commits/${segment(sha)}/diff`, { method: 'GET' });
  }

  public async createCommit(project: ProjectRef, body: Record<string, unknown>): Promise<unknown> {
    return this.request(`/projects/${segment(project)}/repository/commits`, { method: 'POST', body, mutating: true });
  }

  // --- Merge requests ---

  public async listMergeRequests(
    project: ProjectRef,
    options: ListMergeRequestsOptions = {},
    limit = 20,
  ): Promise<ListResult> {
    return this.collect(
      `/projects/${segment(project)}/merge_requests`,
      query({
        state: options.state,
        source_branch: options.sourceBranch,
        target_branch: options.targetBranch,
        search: options.search,
        author_username: options.authorUsername,
        reviewer_username: options.reviewerUsername,
        labels: options.labels === undefined ? undefined : options.labels.join(','),
        order_by: options.orderBy,
        sort: options.sort,
      }),
      limit,
    );
  }

  public async getMergeRequest(project: ProjectRef, iid: number): Promise<unknown> {
    return this.request(`/projects/${segment(project)}/merge_requests/${iid}`, { method: 'GET' });
  }

  public async createMergeRequest(project: ProjectRef, body: Record<string, unknown>): Promise<unknown> {
    return this.request(`/projects/${segment(project)}/merge_requests`, { method: 'POST', body, mutating: true });
  }

  public async updateMergeRequest(project: ProjectRef, iid: number, body: Record<string, unknown>): Promise<unknown> {
    return this.request(`/projects/${segment(project)}/merge_requests/${iid}`, {
      method: 'PUT',
      body,
      mutating: true,
    });
  }

  // --- Tags ---

  public async listTags(project: ProjectRef, options: ListTagsOptions = {}, limit = 20): Promise<ListResult> {
    return this.collect(
      `/projects/${segment(project)}/repository/tags`,
      query({ search: options.search, order_by: options.orderBy, sort: options.sort }),
      limit,
    );
  }

  // --- CI/CD ---

  public async listJobs(project: ProjectRef, options: ListJobsOptions = {}, limit = 20): Promise<ListResult> {
    return this.collect(`/projects/${segment(project)}/jobs`, query({ scope: options.scope }), limit);
  }

  /** A job's trace is plain text, sometimes megabytes of it, and is never JSON. */
  public async getJobLog(project: ProjectRef, jobId: number): Promise<string> {
    return this.transport.text({
      method: 'GET',
      path: `${API_BASE}/projects/${segment(project)}/jobs/${jobId}/trace`,
    });
  }

  public async listVariables(project: ProjectRef, limit = 20): Promise<ListResult> {
    return this.collect(`/projects/${segment(project)}/variables`, {}, limit);
  }

  public async listEnvironments(
    project: ProjectRef,
    options: ListEnvironmentsOptions = {},
    limit = 20,
  ): Promise<ListResult> {
    return this.collect(
      `/projects/${segment(project)}/environments`,
      query({ name: options.name, search: options.search, states: options.states }),
      limit,
    );
  }

  // --- Releases ---

  public async listReleases(project: ProjectRef, limit = 20): Promise<ListResult> {
    return this.collect(`/projects/${segment(project)}/releases`, {}, limit);
  }

  // --- Search ---

  /**
   * Global, group, or project search. GitLab exposes these as three separate endpoints rather
   * than one endpoint with a filter, and the scopes each accepts differ, so the caller's choice
   * of `project` or `group` selects the route instead of becoming a query parameter.
   */
  public async search(options: SearchOptions, limit = 20): Promise<ListResult> {
    if (options.project !== undefined && options.group !== undefined) {
      throw new ConfigError('Search within a project or within a group, not both.');
    }

    const path =
      options.project !== undefined
        ? `/projects/${segment(options.project)}/search`
        : options.group !== undefined
          ? `/groups/${segment(options.group)}/search`
          : '/search';

    return this.collect(path, query({ scope: options.scope, search: options.search, ref: options.ref }), limit);
  }

  // --- Plumbing ---

  private request<T>(
    path: string,
    call: { method: string; query?: Record<string, QueryValue>; body?: unknown; mutating?: boolean },
  ): Promise<T> {
    return this.transport.json<T>({ ...call, path: `${API_BASE}${path}` } satisfies JsonCall);
  }

  /**
   * Follows offset pagination until the limit is reached or the instance says there is no next
   * page, and reports which of the two happened. A caller that gets `complete: false` was cut
   * short by its own limit and knows more exists — the alternative, returning a short list with
   * no signal, is how a partial answer gets mistaken for the whole one.
   */
  private async collect<T>(path: string, params: Record<string, QueryValue>, limit: number): Promise<ListResult<T>> {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new ConfigError(`A limit must be a positive whole number, got ${limit}.`);
    }

    const items: T[] = [];
    let page = 1;
    let pages = 0;
    let total: number | undefined;

    /* Paging is sequential by definition: each request needs the previous page's cursor. */
    /* eslint-disable no-await-in-loop */
    while (items.length < limit && pages < MAX_PAGES) {
      const response = await this.transport.jsonPaged<T[]>({
        method: 'GET',
        path: `${API_BASE}${path}`,
        query: { ...params, per_page: Math.min(MAX_PER_PAGE, limit - items.length), page },
      });
      pages += 1;
      total = response.pagination.total ?? total;

      // Every list endpoint answers with a JSON array. A non-array here means the route matched
      // something else — a redirect to a sign-in page, most often — and slicing it would produce
      // a confidently empty list rather than an error.
      if (!Array.isArray(response.data)) {
        throw new ConfigError(`GET ${path} did not return a list. Check that the URL points at a GitLab instance.`);
      }

      items.push(...response.data);

      const nextPage = response.pagination.nextPage;
      // No next-page header, an empty page, or a cursor that fails to advance all mean the same
      // thing: this was the last page. The last of the three matters because a misconfigured
      // reverse proxy that strips or pins the header would otherwise loop until MAX_PAGES.
      if (response.data.length === 0 || nextPage === undefined || nextPage <= page) {
        return { items: items.slice(0, limit), total, pages, complete: true };
      }
      page = nextPage;
    }
    /* eslint-enable no-await-in-loop */

    return { items: items.slice(0, limit), total, pages, complete: false };
  }
}

function fileBody(input: WriteFileInput): Record<string, unknown> {
  return {
    branch: input.branch,
    content: input.content,
    commit_message: input.commitMessage,
    ...(input.encoding === undefined ? {} : { encoding: input.encoding }),
    ...(input.authorEmail === undefined ? {} : { author_email: input.authorEmail }),
    ...(input.authorName === undefined ? {} : { author_name: input.authorName }),
    ...(input.startBranch === undefined ? {} : { start_branch: input.startBranch }),
    ...(input.lastCommitId === undefined ? {} : { last_commit_id: input.lastCommitId }),
  };
}
