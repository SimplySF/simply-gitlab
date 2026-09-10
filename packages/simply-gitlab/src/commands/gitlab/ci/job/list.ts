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
import { formatTable, jobColumns, type Row } from '@simplysf/simply-gitlab-core';
import { GitLabCommand, limitFlag, projectFlag } from '../../../../shared/base-command.js';

const DEFAULT_LIMIT = 20;

const SCOPES = [
  'created',
  'pending',
  'running',
  'failed',
  'success',
  'canceled',
  'skipped',
  'waiting_for_resource',
  'manual',
] as const;

export default class GitlabCiJobList extends GitLabCommand<typeof GitlabCiJobList> {
  public static override readonly summary = 'List CI jobs for a project.';
  public static override readonly description =
    'Jobs across every pipeline, newest first. --scope is repeatable and the scopes are ORed, so ' +
    '--scope failed --scope running is "either". The ID column is what ci job log takes.';

  public static override readonly examples = [
    '<%= config.bin %> <%= command.id %> --project group/project --scope failed --limit 10',
    '<%= config.bin %> <%= command.id %> --project group/project --scope running --scope pending',
  ];

  public static override readonly flags = {
    ...projectFlag,
    ...limitFlag(DEFAULT_LIMIT, 'jobs'),
    scope: Flags.option({ summary: 'Job states to include. Repeatable.', options: SCOPES, multiple: true })(),
  };

  public async run(): Promise<unknown> {
    const result = await this.gitlab().listJobs(this.flags.project, { scope: this.flags.scope }, this.flags.limit);

    if (result.items.length === 0) {
      this.log('No jobs matched.');
      return result;
    }

    this.logSafe(formatTable(result.items as Row[], jobColumns));
    this.reportList(result.items.length, result.total, result.complete, this.flags.limit, 'job(s)');
    return result;
  }
}
