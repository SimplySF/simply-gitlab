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

import type { Column } from './output.js';

/**
 * The column sets each list command renders.
 *
 * They live here, in core, rather than on the commands for the same reason the operations do:
 * the MCP server's tool descriptions quote what a list actually contains, and a column set that
 * only the CLI knew about would drift from that description with nothing to catch it. Every row
 * type is `Record<string, unknown>` because these are raw GitLab payloads — the API adds fields
 * between releases, and typing them exhaustively would make an added field a compile error
 * rather than a non-event.
 */
export type Row = Record<string, unknown>;

/** Reads a nested field without asserting a shape on server JSON. */
function at(row: Row, ...path: readonly string[]): unknown {
  let cursor: unknown = row;
  for (const key of path) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    cursor = (cursor as Row)[key];
  }
  return cursor;
}

/**
 * Renders a boolean API field.
 *
 * Deliberately 'no' rather than a blank: the renderer shows a missing value as an em dash, and a
 * branch that is genuinely not merged is not a missing value. Anything that is not a boolean is
 * left undefined so it renders as the em dash, which is then honest — the API did not say.
 */
function flag(value: unknown): unknown {
  return typeof value === 'boolean' ? (value ? 'yes' : 'no') : undefined;
}

/** Trims an ISO timestamp to the date, which is what a list is actually scanned for. */
function day(value: unknown): unknown {
  return typeof value === 'string' && value.length >= 10 ? value.slice(0, 10) : value;
}

export const projectColumns: ReadonlyArray<Column<Row>> = [
  { header: 'ID', value: (row) => row.id },
  { header: 'PATH', value: (row) => row.path_with_namespace },
  { header: 'VISIBILITY', value: (row) => row.visibility },
  { header: 'DEFAULT BRANCH', value: (row) => row.default_branch },
  { header: 'LAST ACTIVITY', value: (row) => day(row.last_activity_at) },
];

export const branchColumns: ReadonlyArray<Column<Row>> = [
  { header: 'NAME', value: (row) => row.name },
  { header: 'DEFAULT', value: (row) => flag(row.default) },
  { header: 'PROTECTED', value: (row) => flag(row.protected) },
  { header: 'MERGED', value: (row) => flag(row.merged) },
  { header: 'COMMIT', value: (row) => at(row, 'commit', 'short_id') },
  { header: 'TITLE', value: (row) => at(row, 'commit', 'title') },
];

export const tagColumns: ReadonlyArray<Column<Row>> = [
  { header: 'NAME', value: (row) => row.name },
  { header: 'COMMIT', value: (row) => at(row, 'commit', 'short_id') },
  { header: 'CREATED', value: (row) => day(at(row, 'commit', 'created_at')) },
  { header: 'MESSAGE', value: (row) => row.message },
];

export const commitColumns: ReadonlyArray<Column<Row>> = [
  { header: 'SHA', value: (row) => row.short_id },
  { header: 'DATE', value: (row) => day(row.created_at) },
  { header: 'AUTHOR', value: (row) => row.author_name },
  { header: 'TITLE', value: (row) => row.title },
];

export const mergeRequestColumns: ReadonlyArray<Column<Row>> = [
  { header: 'IID', value: (row) => row.iid },
  { header: 'STATE', value: (row) => row.state },
  { header: 'SOURCE', value: (row) => row.source_branch },
  { header: 'TARGET', value: (row) => row.target_branch },
  { header: 'AUTHOR', value: (row) => at(row, 'author', 'username') },
  { header: 'UPDATED', value: (row) => day(row.updated_at) },
  { header: 'TITLE', value: (row) => row.title },
];

export const jobColumns: ReadonlyArray<Column<Row>> = [
  { header: 'ID', value: (row) => row.id },
  { header: 'STATUS', value: (row) => row.status },
  { header: 'STAGE', value: (row) => row.stage },
  { header: 'NAME', value: (row) => row.name },
  { header: 'REF', value: (row) => row.ref },
  { header: 'PIPELINE', value: (row) => at(row, 'pipeline', 'id') },
];

export const variableColumns: ReadonlyArray<Column<Row>> = [
  { header: 'KEY', value: (row) => row.key },
  { header: 'SCOPE', value: (row) => row.environment_scope },
  { header: 'TYPE', value: (row) => row.variable_type },
  { header: 'PROTECTED', value: (row) => flag(row.protected) },
  { header: 'MASKED', value: (row) => flag(row.masked) },
  { header: 'VALUE', value: (row) => row.value },
];

export const environmentColumns: ReadonlyArray<Column<Row>> = [
  { header: 'ID', value: (row) => row.id },
  { header: 'NAME', value: (row) => row.name },
  { header: 'STATE', value: (row) => row.state },
  { header: 'TIER', value: (row) => row.tier },
  { header: 'EXTERNAL URL', value: (row) => row.external_url },
];

export const releaseColumns: ReadonlyArray<Column<Row>> = [
  { header: 'TAG', value: (row) => row.tag_name },
  { header: 'NAME', value: (row) => row.name },
  { header: 'RELEASED', value: (row) => day(row.released_at) },
  { header: 'AUTHOR', value: (row) => at(row, 'author', 'username') },
];
