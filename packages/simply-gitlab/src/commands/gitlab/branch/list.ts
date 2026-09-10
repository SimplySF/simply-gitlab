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
import { branchColumns, formatTable, type Row } from '@simplysf/simply-gitlab-core';
import { GitLabCommand, limitFlag, projectFlag } from '../../../shared/base-command.js';

const DEFAULT_LIMIT = 20;

export default class GitlabBranchList extends GitLabCommand<typeof GitlabBranchList> {
  public static override readonly summary = 'List repository branches.';
  public static override readonly description =
    'Branches come back in GitLab order, which is alphabetical rather than by recency, so on a ' +
    'busy repository --search is usually what you want. The MERGED column reflects whether the ' +
    'branch is merged into the default branch, not into whatever you are working on.';

  public static override readonly examples = [
    '<%= config.bin %> <%= command.id %> --project group/project',
    '<%= config.bin %> <%= command.id %> --project group/project --search release --limit 50',
  ];

  public static override readonly flags = {
    ...projectFlag,
    ...limitFlag(DEFAULT_LIMIT, 'branches'),
    search: Flags.string({ summary: 'Return only branches whose name contains this term.' }),
  };

  public async run(): Promise<unknown> {
    const result = await this.gitlab().listBranches(
      this.flags.project,
      { search: this.flags.search },
      this.flags.limit,
    );

    if (result.items.length === 0) {
      this.log('No branches matched.');
      return result;
    }

    this.logSafe(formatTable(result.items as Row[], branchColumns));
    this.reportList(result.items.length, result.total, result.complete, this.flags.limit, 'branch(es)');
    return result;
  }
}
