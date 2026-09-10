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
import { buildMergeRequestCreateBody, formatKeyValue, parseBodyInput } from '@simplysf/simply-gitlab-core';
import { GitLabCommand, parseList, projectFlag, writeFlags } from '../../../shared/base-command.js';

interface CreatedMergeRequest {
  readonly iid?: number;
  readonly title?: string;
  readonly web_url?: string;
}

export default class GitlabMrCreate extends GitLabCommand<typeof GitlabMrCreate> {
  public static override isWrite = true;

  public static override readonly summary = 'Open a merge request.';
  public static override readonly description =
    'Both branches must already exist on the project. --draft prefixes the title with "Draft: ", ' +
    'which is how GitLab itself marks a draft; there is no separate field for it.\n\n' +
    'Assignees and reviewers are numeric user ids, not usernames — GitLab accepts only ids here. ' +
    '--body or --body-file supplies raw JSON for anything the flags do not cover, such as ' +
    'approval rules. Use --dry-run to see exactly what would be sent.';

  public static override readonly examples = [
    '<%= config.bin %> <%= command.id %> --project group/project --source-branch feature --target-branch main --title "feat: the thing"',
    '<%= config.bin %> <%= command.id %> --project group/project --source-branch feature --target-branch main --title wip --draft --squash',
  ];

  public static override readonly flags = {
    ...projectFlag,
    ...writeFlags,
    'source-branch': Flags.string({ summary: 'Branch holding the changes.' }),
    'target-branch': Flags.string({ summary: 'Branch the changes are proposed for.' }),
    title: Flags.string({ summary: 'Merge request title.' }),
    description: Flags.string({ summary: 'Merge request description, as Markdown.' }),
    draft: Flags.boolean({ summary: 'Open it as a draft.', default: false }),
    squash: Flags.boolean({ summary: 'Squash the commits when it merges.', default: false }),
    'remove-source-branch': Flags.boolean({ summary: 'Delete the source branch on merge.', default: false }),
    'assignee-id': Flags.integer({ summary: 'User id to assign. Repeatable.', multiple: true }),
    'reviewer-id': Flags.integer({ summary: 'User id to request review from. Repeatable.', multiple: true }),
    labels: Flags.string({ summary: 'Comma-separated labels to apply.' }),
    'milestone-id': Flags.integer({ summary: 'Milestone id to attach.' }),
    body: Flags.string({ summary: 'Raw JSON request body.', exclusive: ['body-file'] }),
    'body-file': Flags.string({ summary: 'Path to a file holding the raw JSON request body.' }),
  };

  public async run(): Promise<unknown> {
    const request = buildMergeRequestCreateBody({
      sourceBranch: this.flags['source-branch'],
      targetBranch: this.flags['target-branch'],
      title: this.flags.title,
      description: this.flags.description,
      draft: this.flags.draft || undefined,
      squash: this.flags.squash || undefined,
      removeSourceBranch: this.flags['remove-source-branch'] || undefined,
      assigneeIds: this.flags['assignee-id'],
      reviewerIds: this.flags['reviewer-id'],
      labels: parseList(this.flags.labels),
      milestoneId: this.flags['milestone-id'],
      body: parseBodyInput(this.flags.body, this.flags['body-file']),
    });

    if (this.flags['dry-run']) {
      this.log('Dry run — not sent. Request body:');
      this.logSafe(JSON.stringify(request, null, 2));
      return request;
    }

    const created = (await this.gitlab().createMergeRequest(this.flags.project, request)) as CreatedMergeRequest;
    this.logSafe(
      formatKeyValue([
        ['Created', created.iid === undefined ? undefined : `!${created.iid}`],
        ['Title', created.title],
        ['URL', created.web_url],
      ]),
    );
    return created;
  }
}
