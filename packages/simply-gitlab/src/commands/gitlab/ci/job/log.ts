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
import { tailLog } from '@simplysf/simply-gitlab-core';
import { GitLabCommand, projectFlag } from '../../../../shared/base-command.js';

const DEFAULT_TAIL = 200;

export default class GitlabCiJobLog extends GitLabCommand<typeof GitlabCiJobLog> {
  public static override readonly summary = 'Print a job log.';
  public static override readonly description =
    'A job trace regularly runs to tens of megabytes, and what matters about a failed job is at ' +
    'the end, so only the last 200 lines are printed. --tail changes that number and --tail 0 ' +
    'prints the whole thing.\n\n' +
    'The trace is written by whatever the job ran, which means it is arbitrary text from an ' +
    'untrusted source. Control characters are stripped before it is printed, so the coloured ' +
    'output a runner emits arrives here plain.';

  public static override readonly examples = [
    '<%= config.bin %> <%= command.id %> --project group/project --job 12345',
    '<%= config.bin %> <%= command.id %> --project group/project --job 12345 --tail 0',
  ];

  public static override readonly flags = {
    ...projectFlag,
    job: Flags.integer({ summary: 'Job id, as listed by ci job list.', required: true }),
    tail: Flags.integer({
      summary: 'Print only the last N lines. 0 prints the whole trace.',
      default: DEFAULT_TAIL,
      min: 0,
    }),
  };

  public async run(): Promise<unknown> {
    const log = await this.gitlab().getJobLog(this.flags.project, this.flags.job);

    if (log.trim() === '') {
      this.log('This job has no log yet.');
      return { job: this.flags.job, log: '', truncated: false };
    }

    const { text, truncated } = tailLog(log, this.flags.tail);
    if (truncated) this.log(`(showing the last ${this.flags.tail} lines; pass --tail 0 for the whole trace)\n`);
    this.logSafe(text.trimEnd());

    return { job: this.flags.job, log: text, truncated };
  }
}
