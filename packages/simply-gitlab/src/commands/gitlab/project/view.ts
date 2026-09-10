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

import { formatKeyValue } from '@simplysf/simply-gitlab-core';
import { GitLabCommand, projectFlag } from '../../../shared/base-command.js';

interface Project {
  readonly id?: number;
  readonly path_with_namespace?: string;
  readonly description?: string;
  readonly visibility?: string;
  readonly default_branch?: string;
  readonly web_url?: string;
  readonly last_activity_at?: string;
  readonly star_count?: number;
  readonly forks_count?: number;
  readonly open_issues_count?: number;
}

export default class GitlabProjectView extends GitLabCommand<typeof GitlabProjectView> {
  public static override readonly summary = 'Show one project.';
  public static override readonly description =
    'Accepts either the numeric id or the full path. Use --json for the complete, unmodified API ' +
    'payload, which carries far more than the summary below — permissions, statistics, and every ' +
    'feature toggle on the project.';

  public static override readonly examples = [
    '<%= config.bin %> <%= command.id %> --project group/project',
    '<%= config.bin %> <%= command.id %> --project 1234 --json',
  ];

  public static override readonly flags = { ...projectFlag };

  public async run(): Promise<unknown> {
    const project = (await this.gitlab().getProject(this.flags.project)) as Project;

    this.logSafe(
      formatKeyValue([
        ['Project', project.path_with_namespace],
        ['ID', project.id],
        ['Description', project.description],
        ['Visibility', project.visibility],
        ['Default branch', project.default_branch],
        ['Open issues', project.open_issues_count],
        ['Stars', project.star_count],
        ['Forks', project.forks_count],
        ['Last activity', project.last_activity_at],
        ['URL', project.web_url],
      ]),
    );

    return project;
  }
}
