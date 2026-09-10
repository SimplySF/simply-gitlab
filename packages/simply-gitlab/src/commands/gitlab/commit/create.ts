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
import { buildCommitBody, formatKeyValue, parseActionsInput, parseBodyInput } from '@simplysf/simply-gitlab-core';
import { GitLabCommand, projectFlag, writeFlags } from '../../../shared/base-command.js';

interface CreatedCommit {
  readonly id?: string;
  readonly short_id?: string;
  readonly title?: string;
  readonly web_url?: string;
}

export default class GitlabCommitCreate extends GitLabCommand<typeof GitlabCommitCreate> {
  public static override isWrite = true;

  public static override readonly summary = 'Commit several file changes at once.';
  public static override readonly description =
    'Sends one commit containing a batch of actions — create, update, delete, move, chmod — which ' +
    'is how GitLab writes more than one file atomically. The actions are JSON, supplied with ' +
    '--actions or inside a --body-file, because there is no readable flag form for a list of ' +
    'file operations.\n\n' +
    'Each action is an object with an "action" and a "file_path"; create and update also need ' +
    '"content", move needs "previous_path", and chmod needs "execute_filemode". Those rules are ' +
    'checked before anything is sent, so a bad entry names its own index.\n\n' +
    'Use --dry-run to see exactly what would be sent.';

  public static override readonly examples = [
    '<%= config.bin %> <%= command.id %> --project group/project --branch main --message "chore: tidy" --actions \'[{"action":"delete","file_path":"old.txt"}]\'',
    '<%= config.bin %> <%= command.id %> --project group/project --branch main --message "feat: batch" --body-file ./commit.json --dry-run',
  ];

  public static override readonly flags = {
    ...projectFlag,
    ...writeFlags,
    branch: Flags.string({ summary: 'Branch to commit to.' }),
    message: Flags.string({ summary: 'Commit message.' }),
    actions: Flags.string({ summary: 'JSON array of file actions.' }),
    'start-branch': Flags.string({ summary: 'Branch to create --branch from, if it does not exist.' }),
    'start-sha': Flags.string({ summary: 'Commit SHA to start the new commit from.' }),
    'author-email': Flags.string({ summary: 'Commit author email.' }),
    'author-name': Flags.string({ summary: 'Commit author name.' }),
    force: Flags.boolean({ summary: 'Overwrite the branch with the new commit.', default: false }),
    body: Flags.string({ summary: 'Raw JSON request body.', exclusive: ['body-file'] }),
    'body-file': Flags.string({ summary: 'Path to a file holding the raw JSON request body.' }),
  };

  public async run(): Promise<unknown> {
    const request = buildCommitBody({
      branch: this.flags.branch,
      message: this.flags.message,
      actions: parseActionsInput(this.flags.actions),
      startBranch: this.flags['start-branch'],
      startSha: this.flags['start-sha'],
      authorEmail: this.flags['author-email'],
      authorName: this.flags['author-name'],
      force: this.flags.force || undefined,
      body: parseBodyInput(this.flags.body, this.flags['body-file']),
    });

    if (this.flags['dry-run']) {
      this.log('Dry run — not sent. Request body:');
      this.logSafe(JSON.stringify(request, null, 2));
      return request;
    }

    const created = (await this.gitlab().createCommit(this.flags.project, request)) as CreatedCommit;
    this.logSafe(
      formatKeyValue([
        ['Created', created.id],
        ['Title', created.title],
        ['URL', created.web_url],
      ]),
    );
    return created;
  }
}
