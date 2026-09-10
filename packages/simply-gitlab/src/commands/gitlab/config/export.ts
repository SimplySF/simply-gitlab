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
import { EXPORTABLE_SECTIONS, exportConfig, type ExportableSection } from '@simplysf/simply-gitlab-core';
import { GitLabCommand, projectFlag } from '../../../shared/base-command.js';

export default class GitlabConfigExport extends GitLabCommand<typeof GitlabConfigExport> {
  public static override readonly summary = 'Write a baseline config describing an existing project.';
  public static override readonly description =
    'Reads one project and prints a configuration file that describes it, ready to be edited and ' +
    'pointed at the rest of your projects. Writing a baseline by hand against forty attributes is ' +
    'miserable and the first draft is wrong; exporting the project that already looks right and ' +
    'deleting what you do not care about is the way to start.\n\n' +
    'The output is deliberately verbose — every supported key, not a curated subset — because ' +
    'deleting a line is easier than discovering that a key exists. Variables are exported as ' +
    'metadata only: keys, scopes, and flags, never values.\n\n' +
    'The exported targets name only the project it came from. Widen that on purpose rather than ' +
    'inheriting a blast radius from an export.';

  public static override readonly examples = [
    '<%= config.bin %> <%= command.id %> --project group/project > baseline.json',
    '<%= config.bin %> <%= command.id %> --project group/project --section settings,protectedBranches',
  ];

  public static override readonly flags = {
    ...projectFlag,
    section: Flags.string({
      summary: 'Comma-separated sections to export. Defaults to all of them.',
      options: [...EXPORTABLE_SECTIONS],
      multiple: true,
      delimiter: ',',
      multipleNonGreedy: true,
    }),
  };

  public async run(): Promise<unknown> {
    const sections = this.flags.section as ExportableSection[] | undefined;
    const config = await exportConfig(this.gitlab(), this.flags.project, {
      sections: sections === undefined || sections.length === 0 ? undefined : sections,
    });

    // Straight to stdout, formatted, because the point of this command is to be redirected to a
    // file. Under --json oclif prints the same object itself.
    if (!this.jsonEnabled()) this.logSafe(JSON.stringify(config, null, 2));
    return config;
  }
}
