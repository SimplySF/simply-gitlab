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

import { formatTable, releaseColumns, type Row } from '@simplysf/simply-gitlab-core';
import { GitLabCommand, limitFlag, projectFlag } from '../../../shared/base-command.js';

const DEFAULT_LIMIT = 20;

export default class GitlabReleaseList extends GitLabCommand<typeof GitlabReleaseList> {
  public static override readonly summary = 'List releases for a project.';
  public static override readonly description =
    'Releases are tags with notes and assets attached, so a project can have many tags and no ' +
    'releases at all. Use --json for the release notes, asset links, and the commit each release ' +
    'points at.';

  public static override readonly examples = [
    '<%= config.bin %> <%= command.id %> --project group/project',
    '<%= config.bin %> <%= command.id %> --project group/project --limit 5 --json',
  ];

  public static override readonly flags = {
    ...projectFlag,
    ...limitFlag(DEFAULT_LIMIT, 'releases'),
  };

  public async run(): Promise<unknown> {
    const result = await this.gitlab().listReleases(this.flags.project, this.flags.limit);

    if (result.items.length === 0) {
      this.log('No releases found.');
      return result;
    }

    this.logSafe(formatTable(result.items as Row[], releaseColumns));
    this.reportList(result.items.length, result.total, result.complete, this.flags.limit, 'release(s)');
    return result;
  }
}
