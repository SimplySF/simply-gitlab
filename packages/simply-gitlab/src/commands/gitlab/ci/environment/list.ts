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
import { environmentColumns, formatTable, type Row } from '@simplysf/simply-gitlab-core';
import { GitLabCommand, limitFlag, projectFlag } from '../../../../shared/base-command.js';

const DEFAULT_LIMIT = 20;

export default class GitlabCiEnvironmentList extends GitLabCommand<typeof GitlabCiEnvironmentList> {
  public static override readonly summary = 'List a project deployment environments.';
  public static override readonly description =
    'Environments are what CI deploys to and what review apps create. Both available and stopped ' +
    'ones are listed; --state narrows to one. Use --json for the last deployment on each, which ' +
    'is the field worth having when you are answering "what is running where".';

  public static override readonly examples = [
    '<%= config.bin %> <%= command.id %> --project group/project',
    '<%= config.bin %> <%= command.id %> --project group/project --state available --search prod',
  ];

  public static override readonly flags = {
    ...projectFlag,
    ...limitFlag(DEFAULT_LIMIT, 'environments'),
    name: Flags.string({ summary: 'Return the environment with exactly this name.' }),
    search: Flags.string({ summary: 'Return environments whose name contains this term.' }),
    state: Flags.option({ summary: 'Environment state.', options: ['available', 'stopped'] as const })(),
  };

  public async run(): Promise<unknown> {
    const result = await this.gitlab().listEnvironments(
      this.flags.project,
      { name: this.flags.name, search: this.flags.search, states: this.flags.state },
      this.flags.limit,
    );

    if (result.items.length === 0) {
      this.log('No environments matched.');
      return result;
    }

    this.logSafe(formatTable(result.items as Row[], environmentColumns));
    this.reportList(result.items.length, result.total, result.complete, this.flags.limit, 'environment(s)');
    return result;
  }
}
