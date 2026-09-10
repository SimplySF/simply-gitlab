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
import { formatTable, maskVariables, variableColumns, type Row } from '@simplysf/simply-gitlab-core';
import { GitLabCommand, limitFlag, projectFlag } from '../../../../shared/base-command.js';

const DEFAULT_LIMIT = 50;

export default class GitlabCiVariableList extends GitLabCommand<typeof GitlabCiVariableList> {
  public static override readonly summary = 'List a project CI/CD variables.';
  public static override readonly description =
    'Variable values are hidden by default, including under --json. GitLab returns every value in ' +
    'clear text on this endpoint — the "masked" attribute only hides a value in job logs, not from ' +
    'the API — and those values are deploy keys and production credentials.\n\n' +
    'Pass --reveal to print them. Doing so puts live secrets on stdout, into your shell history if ' +
    'you redirect it, and into the context of anything reading this output, so it is a deliberate ' +
    'step rather than the default.';

  public static override readonly examples = [
    '<%= config.bin %> <%= command.id %> --project group/project',
    '<%= config.bin %> <%= command.id %> --project group/project --reveal',
  ];

  public static override readonly flags = {
    ...projectFlag,
    ...limitFlag(DEFAULT_LIMIT, 'variables'),
    reveal: Flags.boolean({
      summary: 'Print the variable values in clear text.',
      description:
        'Off by default. Every value on this endpoint is a live secret, so revealing them is worth ' +
        'a moment of thought about where this output is going.',
      default: false,
    }),
  };

  public async run(): Promise<unknown> {
    const result = await this.gitlab().listVariables(this.flags.project, this.flags.limit);
    const items = this.flags.reveal ? result.items : maskVariables(result.items);

    if (items.length === 0) {
      this.log('This project has no CI/CD variables.');
      return { ...result, items };
    }

    this.logSafe(formatTable(items as Row[], variableColumns));
    this.reportList(items.length, result.total, result.complete, this.flags.limit, 'variable(s)');
    if (!this.flags.reveal) this.log('Values are hidden. Pass --reveal to print them.');

    return { ...result, items };
  }
}
