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
import { decodeFileContent, formatKeyValue, type FilePayload } from '@simplysf/simply-gitlab-core';
import { GitLabCommand, projectFlag } from '../../../shared/base-command.js';

export default class GitlabFileView extends GitLabCommand<typeof GitlabFileView> {
  public static override readonly summary = 'Print a file from a repository.';
  public static override readonly description =
    'Reads one file at a ref and writes its decoded contents to stdout, under a short metadata ' +
    'header. Use --raw for the contents alone, or --json for the API payload, whose "content" is ' +
    'base64 exactly as GitLab sends it.\n\n' +
    'A binary file is not printed: its bytes would emit escape sequences to a terminal and noise ' +
    'to whatever reads this stream. The metadata still is, so you can see what was found.';

  public static override readonly examples = [
    '<%= config.bin %> <%= command.id %> --project group/project --path src/index.ts --ref main',
    '<%= config.bin %> <%= command.id %> --project group/project --path README.md --ref v1.2.0 --raw',
  ];

  public static override readonly flags = {
    ...projectFlag,
    path: Flags.string({ summary: 'Path to the file within the repository.', required: true }),
    ref: Flags.string({ summary: 'Branch, tag, or commit SHA to read from.', required: true }),
    raw: Flags.boolean({ summary: 'Print only the file contents, with no metadata header.', default: false }),
  };

  public async run(): Promise<unknown> {
    const payload = (await this.gitlab().getFile(this.flags.project, this.flags.path, {
      ref: this.flags.ref,
    })) as FilePayload;

    const decoded = decodeFileContent(payload);

    if (!this.flags.raw) {
      this.logSafe(
        formatKeyValue([
          ['File', payload.file_path],
          ['Ref', payload.ref],
          ['Size', decoded.bytes],
          ['Last commit', payload.last_commit_id],
        ]),
      );
      this.log('');
    }

    if (decoded.printable) {
      this.logSafe(decoded.text);
    } else {
      this.log(`(${decoded.bytes} bytes of binary content, not printed)`);
    }

    return payload;
  }
}
