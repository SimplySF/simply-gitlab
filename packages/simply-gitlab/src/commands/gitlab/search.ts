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

import { Flags } from '@oclif/core';
import {
  formatTable,
  needsAdvancedSearch,
  searchColumns,
  type Row,
  type SearchScope,
} from '@simplysf/simply-gitlab-core';
import { GitLabCommand, limitFlag } from '../../shared/base-command.js';

const DEFAULT_LIMIT = 20;

const SCOPES = [
  'projects',
  'issues',
  'merge_requests',
  'milestones',
  'wiki_blobs',
  'commits',
  'blobs',
  'notes',
  'users',
  'snippet_titles',
] as const;

export default class GitlabSearch extends GitLabCommand<typeof GitlabSearch> {
  public static override readonly summary = 'Search GitLab.';
  public static override readonly description =
    'Searches the whole instance by default, or one project with --project, or one group with ' +
    '--group. These are three different GitLab endpoints, and they do not accept the same scopes: ' +
    'projects and users are instance-wide only, while a project search can look at notes.\n\n' +
    'The blobs, commits, wiki_blobs, notes, and snippet_titles scopes need Advanced Search ' +
    '(Elasticsearch) enabled on the instance. Where it is not, GitLab answers with an empty list ' +
    'and a 200 rather than an error, so an empty result for one of those scopes is reported here ' +
    'as possibly meaning "not enabled" rather than "no matches".';

  public static override readonly examples = [
    '<%= config.bin %> <%= command.id %> --scope projects --query platform',
    '<%= config.bin %> <%= command.id %> --scope blobs --query UMCN_Account --project group/project',
    '<%= config.bin %> <%= command.id %> --scope merge_requests --query "flaky test" --group my-group --json',
  ];

  public static override readonly flags = {
    ...limitFlag(DEFAULT_LIMIT, 'results'),
    scope: Flags.option({ summary: 'What to search.', options: SCOPES, required: true })(),
    query: Flags.string({ summary: 'The search term.', required: true }),
    project: Flags.string({ summary: 'Search within this project id or path.', exclusive: ['group'] }),
    group: Flags.string({ summary: 'Search within this group id or path.' }),
  };

  public async run(): Promise<unknown> {
    const scope: SearchScope = this.flags.scope;
    const result = await this.gitlab().search(
      { scope, search: this.flags.query, project: this.flags.project, group: this.flags.group },
      this.flags.limit,
    );

    if (result.items.length === 0) {
      const caveat = needsAdvancedSearch(scope)
        ? ` The ${scope} scope needs Advanced Search on the instance; without it GitLab returns an empty list rather than an error.`
        : '';
      this.log(`No results.${caveat}`);
      return result;
    }

    this.logSafe(formatTable(result.items as Row[], searchColumns(scope)));
    this.reportList(result.items.length, result.total, result.complete, this.flags.limit, 'result(s)');
    return result;
  }
}
