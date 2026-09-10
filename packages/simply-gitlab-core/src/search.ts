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

import type { SearchScope } from './gitlab-client.js';
import type { Column } from './output.js';
import { commitColumns, mergeRequestColumns, projectColumns, type Row } from './tables.js';

/** The scopes every GitLab instance can search without Advanced Search (Elasticsearch) enabled. */
export const BASIC_SCOPES: readonly SearchScope[] = ['projects', 'issues', 'merge_requests', 'milestones', 'users'];

/**
 * The scopes that need Advanced Search on the instance. Named so a caller can be told *why* a
 * scope came back empty: GitLab answers an unsupported scope with an empty list and a 200, which
 * is indistinguishable from "no matches" unless something says otherwise.
 */
export const ADVANCED_SCOPES: readonly SearchScope[] = ['blobs', 'commits', 'wiki_blobs', 'notes', 'snippet_titles'];

export function needsAdvancedSearch(scope: SearchScope): boolean {
  return ADVANCED_SCOPES.includes(scope);
}

const issueColumns: ReadonlyArray<Column<Row>> = [
  { header: 'IID', value: (row) => row.iid },
  { header: 'STATE', value: (row) => row.state },
  { header: 'PROJECT', value: (row) => row.project_id },
  { header: 'TITLE', value: (row) => row.title },
];

const blobColumns: ReadonlyArray<Column<Row>> = [
  { header: 'PATH', value: (row) => row.path ?? row.filename },
  { header: 'REF', value: (row) => row.ref },
  { header: 'LINE', value: (row) => row.startline },
  { header: 'PROJECT', value: (row) => row.project_id },
];

const userColumns: ReadonlyArray<Column<Row>> = [
  { header: 'ID', value: (row) => row.id },
  { header: 'USERNAME', value: (row) => row.username },
  { header: 'NAME', value: (row) => row.name },
  { header: 'STATE', value: (row) => row.state },
];

const milestoneColumns: ReadonlyArray<Column<Row>> = [
  { header: 'IID', value: (row) => row.iid },
  { header: 'STATE', value: (row) => row.state },
  { header: 'DUE', value: (row) => row.due_date },
  { header: 'TITLE', value: (row) => row.title },
];

const noteColumns: ReadonlyArray<Column<Row>> = [
  { header: 'ID', value: (row) => row.id },
  { header: 'AUTHOR', value: (row) => (row.author as Row | undefined)?.username },
  { header: 'BODY', value: (row) => row.body },
];

const snippetColumns: ReadonlyArray<Column<Row>> = [
  { header: 'ID', value: (row) => row.id },
  { header: 'TITLE', value: (row) => row.title },
  { header: 'FILE', value: (row) => row.file_name },
];

/**
 * The columns to render for a search result set.
 *
 * Each scope returns a different object — a blob hit has a path and a line number, a user hit has
 * a username — so one column set for all of them would show an em dash in most cells. The scope
 * is known before the request, so the renderer picks by scope rather than sniffing the rows.
 */
export function searchColumns(scope: SearchScope): ReadonlyArray<Column<Row>> {
  switch (scope) {
    case 'projects':
      return projectColumns;
    case 'issues':
      return issueColumns;
    case 'merge_requests':
      return mergeRequestColumns;
    case 'milestones':
      return milestoneColumns;
    case 'commits':
      return commitColumns;
    case 'blobs':
    case 'wiki_blobs':
      return blobColumns;
    case 'notes':
      return noteColumns;
    case 'users':
      return userColumns;
    case 'snippet_titles':
      return snippetColumns;
  }
}
