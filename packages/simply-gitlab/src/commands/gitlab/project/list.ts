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
import { formatTable, projectColumns, type Row } from '@simplysf/simply-gitlab-core';
import { GitLabCommand, limitFlag } from '../../../shared/base-command.js';

const DEFAULT_LIMIT = 20;

export default class GitlabProjectList extends GitLabCommand<typeof GitlabProjectList> {
  public static override readonly summary = 'List projects you can see.';
  public static override readonly description =
    'Without --search this lists every project the token can reach, newest activity first, which ' +
    'on a large instance is not a useful answer — narrow it with --search or --membership. Use ' +
    '--simple for a much smaller payload when you only need ids and paths.';

  public static override readonly examples = [
    '<%= config.bin %> <%= command.id %> --membership',
    '<%= config.bin %> <%= command.id %> --search platform --limit 10',
    '<%= config.bin %> <%= command.id %> --search platform --simple --json',
  ];

  public static override readonly flags = {
    ...limitFlag(DEFAULT_LIMIT, 'projects'),
    search: Flags.string({ summary: 'Match against the project name and path.' }),
    membership: Flags.boolean({ summary: 'Only projects you are a member of.', default: false }),
    owned: Flags.boolean({ summary: 'Only projects you own.', default: false }),
    simple: Flags.boolean({
      summary: 'Return only the core fields, for a much smaller payload.',
      default: false,
    }),
  };

  public async run(): Promise<unknown> {
    const result = await this.gitlab().listProjects(
      {
        search: this.flags.search,
        membership: this.flags.membership || undefined,
        owned: this.flags.owned || undefined,
        simple: this.flags.simple || undefined,
      },
      this.flags.limit,
    );

    if (result.items.length === 0) {
      this.log('No projects matched.');
      return result;
    }

    this.log(formatTable(result.items as Row[], projectColumns));
    this.reportList(result.items.length, result.total, result.complete, this.flags.limit, 'project(s)');
    return result;
  }
}
