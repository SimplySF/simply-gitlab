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
import { buildFileWrite, formatKeyValue } from '@simplysf/simply-gitlab-core';
import { GitLabCommand, projectFlag, writeFlags } from '../../../shared/base-command.js';

interface FileWriteResult {
  readonly file_path?: string;
  readonly branch?: string;
}

export default class GitlabFileCreate extends GitLabCommand<typeof GitlabFileCreate> {
  public static override isWrite = true;

  public static override readonly summary = 'Create a file in a repository.';
  public static override readonly description =
    'Commits one new file to a branch. GitLab refuses the request if the file already exists — ' +
    'use file update for that — and refuses it if the branch is protected and the token lacks ' +
    'the role to push to it. Use --dry-run to see exactly what would be sent.';

  public static override readonly examples = [
    '<%= config.bin %> <%= command.id %> --project group/project --path docs/new.md --branch main --content-file ./new.md --message "docs: add page"',
    '<%= config.bin %> <%= command.id %> --project group/project --path src/config.json --branch feature --content-file ./config.json --message "feat: add config" --dry-run',
  ];

  public static override readonly flags = {
    ...projectFlag,
    ...writeFlags,
    path: Flags.string({ summary: 'Path the file will have in the repository.', required: true }),
    branch: Flags.string({ summary: 'Branch to commit to.', required: true }),
    content: Flags.string({ summary: 'File contents.', exclusive: ['content-file'] }),
    'content-file': Flags.string({ summary: 'Path to a local file holding the contents.' }),
    message: Flags.string({ summary: 'Commit message.', required: true }),
    'start-branch': Flags.string({ summary: 'Branch to create --branch from, if it does not exist.' }),
    'author-email': Flags.string({ summary: 'Commit author email.' }),
    'author-name': Flags.string({ summary: 'Commit author name.' }),
  };

  public async run(): Promise<unknown> {
    const input = buildFileWrite({
      branch: this.flags.branch,
      content: this.flags.content,
      contentFile: this.flags['content-file'],
      message: this.flags.message,
      startBranch: this.flags['start-branch'],
      authorEmail: this.flags['author-email'],
      authorName: this.flags['author-name'],
    });
    const request = { file_path: this.flags.path, ...input };

    if (this.flags['dry-run']) {
      this.log('Dry run — not sent. Request body:');
      this.logSafe(JSON.stringify(request, null, 2));
      return request;
    }

    const created = (await this.gitlab().createFile(this.flags.project, this.flags.path, input)) as FileWriteResult;
    this.logSafe(
      formatKeyValue([
        ['Created', created.file_path ?? this.flags.path],
        ['Branch', created.branch ?? this.flags.branch],
      ]),
    );
    return created;
  }
}
