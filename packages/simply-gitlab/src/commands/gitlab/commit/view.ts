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
import { formatKeyValue } from '@simplysf/simply-gitlab-core';
import { GitLabCommand, projectFlag } from '../../../shared/base-command.js';

interface Commit {
  readonly id?: string;
  readonly short_id?: string;
  readonly title?: string;
  readonly message?: string;
  readonly author_name?: string;
  readonly author_email?: string;
  readonly created_at?: string;
  readonly web_url?: string;
  readonly parent_ids?: string[];
  readonly stats?: { readonly additions?: number; readonly deletions?: number };
}

export default class GitlabCommitView extends GitLabCommand<typeof GitlabCommitView> {
  public static override readonly summary = 'Show one commit.';
  public static override readonly description =
    'Accepts a full or short SHA, or the name of a branch or tag — in which case the commit at ' +
    'its tip is shown, so the answer changes as the branch moves. Use commit diff for the changes ' +
    'themselves.';

  public static override readonly examples = [
    '<%= config.bin %> <%= command.id %> --project group/project --sha 9a1b2c3',
    '<%= config.bin %> <%= command.id %> --project group/project --sha main --json',
  ];

  public static override readonly flags = {
    ...projectFlag,
    sha: Flags.string({ summary: 'Commit SHA, or the name of a branch or tag.', required: true }),
  };

  public async run(): Promise<unknown> {
    const commit = (await this.gitlab().getCommit(this.flags.project, this.flags.sha)) as Commit;

    this.logSafe(
      formatKeyValue([
        ['Commit', commit.id],
        ['Author', commit.author_name],
        ['Date', commit.created_at],
        ['Parents', commit.parent_ids?.join(', ')],
        [
          'Changes',
          commit.stats === undefined ? undefined : `+${commit.stats.additions ?? 0} -${commit.stats.deletions ?? 0}`,
        ],
        ['URL', commit.web_url],
      ]),
    );
    if (typeof commit.message === 'string') {
      this.log('');
      this.logSafe(commit.message.trimEnd());
    }

    return commit;
  }
}
