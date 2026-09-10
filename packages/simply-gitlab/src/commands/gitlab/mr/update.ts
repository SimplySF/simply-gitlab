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
import { assertIid, buildMergeRequestUpdateBody, formatKeyValue, parseBodyInput } from '@simplysf/simply-gitlab-core';
import { GitLabCommand, parseList, projectFlag, writeFlags } from '../../../shared/base-command.js';

interface UpdatedMergeRequest {
  readonly iid?: number;
  readonly title?: string;
  readonly state?: string;
  readonly web_url?: string;
}

export default class GitlabMrUpdate extends GitLabCommand<typeof GitlabMrUpdate> {
  public static override isWrite = true;

  public static override readonly summary = 'Change an existing merge request.';
  public static override readonly description =
    'Only the attributes you name are changed, with one exception worth knowing: --labels replaces ' +
    'the whole label set rather than adding to it.\n\n' +
    'Naming nothing to change is refused rather than sent, because GitLab answers an empty update ' +
    'with a cheerful 200 and an unchanged merge request. --state close and --state reopen do what ' +
    'the buttons of those names do; neither merges anything.';

  public static override readonly examples = [
    '<%= config.bin %> <%= command.id %> --project group/project --mr 42 --title "feat: renamed"',
    '<%= config.bin %> <%= command.id %> --project group/project --mr 42 --state close',
    '<%= config.bin %> <%= command.id %> --project group/project --mr 42 --labels backend,urgent --dry-run',
  ];

  public static override readonly flags = {
    ...projectFlag,
    ...writeFlags,
    mr: Flags.integer({ summary: 'Merge request iid.', required: true }),
    title: Flags.string({ summary: 'New title.' }),
    description: Flags.string({ summary: 'New description, as Markdown.' }),
    'target-branch': Flags.string({ summary: 'New target branch.' }),
    state: Flags.option({
      summary: 'Close or reopen the merge request.',
      options: ['close', 'reopen'] as const,
    })(),
    squash: Flags.boolean({ summary: 'Squash the commits when it merges.', allowNo: true }),
    'remove-source-branch': Flags.boolean({ summary: 'Delete the source branch on merge.', allowNo: true }),
    'assignee-id': Flags.integer({ summary: 'User id to assign, replacing the set. Repeatable.', multiple: true }),
    'reviewer-id': Flags.integer({ summary: 'User id to review, replacing the set. Repeatable.', multiple: true }),
    labels: Flags.string({ summary: 'Comma-separated labels, replacing the existing set.' }),
    'milestone-id': Flags.integer({ summary: 'Milestone id to attach.' }),
    body: Flags.string({ summary: 'Raw JSON request body.', exclusive: ['body-file'] }),
    'body-file': Flags.string({ summary: 'Path to a file holding the raw JSON request body.' }),
  };

  public async run(): Promise<unknown> {
    const iid = assertIid(this.flags.mr);
    const request = buildMergeRequestUpdateBody({
      title: this.flags.title,
      description: this.flags.description,
      targetBranch: this.flags['target-branch'],
      stateEvent: this.flags.state,
      squash: this.flags.squash,
      removeSourceBranch: this.flags['remove-source-branch'],
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

    const updated = (await this.gitlab().updateMergeRequest(this.flags.project, iid, request)) as UpdatedMergeRequest;
    this.logSafe(
      formatKeyValue([
        ['Updated', `!${updated.iid ?? iid}`],
        ['Title', updated.title],
        ['State', updated.state],
        ['URL', updated.web_url],
      ]),
    );
    return updated;
  }
}
