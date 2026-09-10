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
import { formatTable, mergeRequestColumns, type Row } from '@simplysf/simply-gitlab-core';
import { GitLabCommand, limitFlag, parseList, projectFlag } from '../../../shared/base-command.js';

const DEFAULT_LIMIT = 20;

export default class GitlabMrList extends GitLabCommand<typeof GitlabMrList> {
  public static override readonly summary = 'List merge requests for a project.';
  public static override readonly description =
    'Defaults to open merge requests, which is what a list is nearly always for; pass --state all ' +
    'to include closed and merged ones. The IID column is the number to pass to the other mr ' +
    'commands — it is per-project, and is not the "id" field in the JSON payload.';

  public static override readonly examples = [
    '<%= config.bin %> <%= command.id %> --project group/project',
    '<%= config.bin %> <%= command.id %> --project group/project --state merged --target-branch main --limit 10',
    '<%= config.bin %> <%= command.id %> --project group/project --author-username someone --json',
  ];

  public static override readonly flags = {
    ...projectFlag,
    ...limitFlag(DEFAULT_LIMIT, 'merge requests'),
    state: Flags.option({
      summary: 'Merge request state to return.',
      options: ['opened', 'closed', 'locked', 'merged', 'all'] as const,
      default: 'opened' as const,
    })(),
    'source-branch': Flags.string({ summary: 'Only merge requests from this source branch.' }),
    'target-branch': Flags.string({ summary: 'Only merge requests into this target branch.' }),
    'author-username': Flags.string({ summary: 'Only merge requests opened by this username.' }),
    'reviewer-username': Flags.string({ summary: 'Only merge requests this username is reviewing.' }),
    labels: Flags.string({ summary: 'Comma-separated labels every result must carry.' }),
    search: Flags.string({ summary: 'Match against the title and description.' }),
  };

  public async run(): Promise<unknown> {
    const result = await this.gitlab().listMergeRequests(
      this.flags.project,
      {
        state: this.flags.state,
        sourceBranch: this.flags['source-branch'],
        targetBranch: this.flags['target-branch'],
        authorUsername: this.flags['author-username'],
        reviewerUsername: this.flags['reviewer-username'],
        labels: parseList(this.flags.labels),
        search: this.flags.search,
      },
      this.flags.limit,
    );

    if (result.items.length === 0) {
      this.log('No merge requests matched.');
      return result;
    }

    this.logSafe(formatTable(result.items as Row[], mergeRequestColumns));
    this.reportList(result.items.length, result.total, result.complete, this.flags.limit, 'merge request(s)');
    return result;
  }
}
