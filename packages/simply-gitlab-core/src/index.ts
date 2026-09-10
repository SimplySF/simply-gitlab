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

// Everything exported from this file is this package's public API and is semver-covered: adding
// an export is a minor/patch change, but removing or renaming one is breaking.
// `test/index.test.ts` pins the exported-key list so an accidental removal fails a test instead
// of silently shipping in a patch release. See docs/design/0001-gitlab-client-core.md for why
// this package is split out from `@simplysf/simply-gitlab` (the CLI).
//
// Nothing here touches a terminal or a process: no oclif, no child processes, no `process.argv`,
// nothing written to stdout or stderr. `process.env` is read only through an injectable `env`
// parameter that defaults to it. The repo's lint config enforces the import side of that rule.

// --- Configuration, transport, client, errors ---
export { buildAuthHeaders } from './auth.js';
export {
  DEFAULT_URL,
  resolveGitLabConfig,
  TOKEN_ENV,
  URL_ENV,
  type ConfigOverrides,
  type EnvLike,
  type GitLabConfig,
} from './config.js';
export { loadEnvFile, parseEnvFile } from './env-file.js';
export { AuthError, CliError, ConfigError, HttpError, NetworkError } from './errors.js';
export {
  HttpTransport,
  type JsonCall,
  type Paged,
  type Pagination,
  type QueryValue,
  type TransportTarget,
} from './http.js';
export {
  GitLabClient,
  type CommitAction,
  type FileOptions,
  type JobScope,
  type ListBranchesOptions,
  type ListCommitsOptions,
  type ListEnvironmentsOptions,
  type ListJobsOptions,
  type ListMergeRequestsOptions,
  type ListProjectsOptions,
  type ListResult,
  type ListTagsOptions,
  type MergeRequestState,
  type ProjectRef,
  type SearchOptions,
  type SearchScope,
  type WriteFileInput,
} from './gitlab-client.js';
export { stripControl, stripControlOneLine } from './text.js';

// --- Safety: the read-only guard and credential redaction, shared by every consumer ---
export { assertWritesAllowed, isReadOnly, READ_ONLY_ENV } from './write-safety.js';
export { collectSecrets, redactSecrets, sanitiseDeep, SECRET_ENV, secretValues } from './redaction.js';

// --- Shared input handling and rendering ---
export { assertNotEmpty, mergeBody, parseBodyInput, readTextFile } from './json-input.js';
export { formatKeyValue, formatTable, type Column, type Pair } from './output.js';
export {
  branchColumns,
  commitColumns,
  environmentColumns,
  jobColumns,
  mergeRequestColumns,
  projectColumns,
  releaseColumns,
  tagColumns,
  variableColumns,
  type Row,
} from './tables.js';

// --- Operations: what each command does between parsing its input and rendering its result ---
export { HIDDEN, maskVariables, tailLog } from './cicd.js';
export { buildCommitBody, parseActionsInput, parseCommitActions, type CommitInput } from './commits.js';
export {
  assertIid,
  buildMergeRequestCreateBody,
  buildMergeRequestUpdateBody,
  mergeRequestUrl,
  type MergeRequestCreateInput,
  type MergeRequestUpdateInput,
} from './merge-requests.js';
export {
  buildFileWrite,
  decodeFileContent,
  type DecodedFile,
  type FilePayload,
  type FileWriteInput,
} from './repository-files.js';
export { ADVANCED_SCOPES, BASIC_SCOPES, needsAdvancedSearch, searchColumns } from './search.js';
