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
import { formatTable, tagColumns, type Row } from '@simplysf/simply-gitlab-core';
import { GitLabCommand, limitFlag, projectFlag } from '../../../shared/base-command.js';

const DEFAULT_LIMIT = 20;

export default class GitlabTagList extends GitLabCommand<typeof GitlabTagList> {
  public static override readonly summary = 'List repository tags.';
  public static override readonly description =
    'Tags come back newest first by the commit date they point at. That is the commit date, not ' +
    'the tag creation date, so a tag cut today on an old commit sorts by the old commit — use ' +
    '--order-by name if you need a deterministic order instead.';

  public static override readonly examples = [
    '<%= config.bin %> <%= command.id %> --project group/project',
    '<%= config.bin %> <%= command.id %> --project group/project --search v1. --limit 50',
  ];

  public static override readonly flags = {
    ...projectFlag,
    ...limitFlag(DEFAULT_LIMIT, 'tags'),
    search: Flags.string({ summary: 'Return only tags whose name contains this term.' }),
    'order-by': Flags.option({
      summary: 'Field to sort by.',
      options: ['name', 'updated', 'version'] as const,
    })(),
    sort: Flags.option({ summary: 'Sort direction.', options: ['asc', 'desc'] as const })(),
  };

  public async run(): Promise<unknown> {
    const result = await this.gitlab().listTags(
      this.flags.project,
      { search: this.flags.search, orderBy: this.flags['order-by'], sort: this.flags.sort },
      this.flags.limit,
    );

    if (result.items.length === 0) {
      this.log('No tags matched.');
      return result;
    }

    this.logSafe(formatTable(result.items as Row[], tagColumns));
    this.reportList(result.items.length, result.total, result.complete, this.flags.limit, 'tag(s)');
    return result;
  }
}
