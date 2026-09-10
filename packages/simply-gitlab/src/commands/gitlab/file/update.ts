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

export default class GitlabFileUpdate extends GitLabCommand<typeof GitlabFileUpdate> {
  public static override isWrite = true;

  public static override readonly summary = 'Replace a file in a repository.';
  public static override readonly description =
    'Commits new contents over an existing file. The whole file is replaced; there is no partial ' +
    'edit. Pass --last-commit-id with the value file view reported to have GitLab reject the ' +
    'write if someone else changed the file meanwhile, instead of silently overwriting them.';

  public static override readonly examples = [
    '<%= config.bin %> <%= command.id %> --project group/project --path README.md --branch main --content-file ./README.md --message "docs: refresh readme"',
    '<%= config.bin %> <%= command.id %> --project group/project --path README.md --branch main --content-file ./README.md --message "docs: refresh" --last-commit-id 9a1b2c3',
  ];

  public static override readonly flags = {
    ...projectFlag,
    ...writeFlags,
    path: Flags.string({ summary: 'Path to the file within the repository.', required: true }),
    branch: Flags.string({ summary: 'Branch to commit to.', required: true }),
    content: Flags.string({ summary: 'New file contents.', exclusive: ['content-file'] }),
    'content-file': Flags.string({ summary: 'Path to a local file holding the new contents.' }),
    message: Flags.string({ summary: 'Commit message.', required: true }),
    'start-branch': Flags.string({ summary: 'Branch to create --branch from, if it does not exist.' }),
    'last-commit-id': Flags.string({ summary: 'Reject the write if the file changed since this commit.' }),
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
      lastCommitId: this.flags['last-commit-id'],
      authorEmail: this.flags['author-email'],
      authorName: this.flags['author-name'],
    });
    const request = { file_path: this.flags.path, ...input };

    if (this.flags['dry-run']) {
      this.log('Dry run — not sent. Request body:');
      this.logSafe(JSON.stringify(request, null, 2));
      return request;
    }

    const updated = (await this.gitlab().updateFile(this.flags.project, this.flags.path, input)) as FileWriteResult;
    this.logSafe(
      formatKeyValue([
        ['Updated', updated.file_path ?? this.flags.path],
        ['Branch', updated.branch ?? this.flags.branch],
      ]),
    );
    return updated;
  }
}
