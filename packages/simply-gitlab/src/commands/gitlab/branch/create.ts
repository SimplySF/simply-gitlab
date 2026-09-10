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
import { GitLabCommand, projectFlag, writeFlags } from '../../../shared/base-command.js';

interface CreatedBranch {
  readonly name?: string;
  readonly web_url?: string;
  readonly commit?: { readonly short_id?: string };
}

export default class GitlabBranchCreate extends GitLabCommand<typeof GitlabBranchCreate> {
  public static override isWrite = true;

  public static override readonly summary = 'Create a branch.';
  public static override readonly description =
    'Points a new branch at an existing branch, tag, or commit SHA. GitLab refuses a name that ' +
    'already exists rather than moving it, so this can never rewrite a branch someone else is using.';

  public static override readonly examples = [
    '<%= config.bin %> <%= command.id %> --project group/project --branch feature/thing --ref main',
    '<%= config.bin %> <%= command.id %> --project group/project --branch hotfix --ref v1.2.0',
  ];

  public static override readonly flags = {
    ...projectFlag,
    ...writeFlags,
    branch: Flags.string({ summary: 'Name of the new branch.', required: true }),
    ref: Flags.string({ summary: 'Branch, tag, or commit SHA to branch from.', required: true }),
  };

  public async run(): Promise<unknown> {
    const request = { branch: this.flags.branch, ref: this.flags.ref };

    if (this.flags['dry-run']) {
      this.log('Dry run — not sent. Request body:');
      this.log(JSON.stringify(request, null, 2));
      return request;
    }

    const created = (await this.gitlab().createBranch(
      this.flags.project,
      this.flags.branch,
      this.flags.ref,
    )) as CreatedBranch;

    this.logSafe(
      formatKeyValue([
        ['Created', created.name ?? this.flags.branch],
        ['Commit', created.commit?.short_id],
        ['URL', created.web_url],
      ]),
    );
    return created;
  }
}
