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
import { assertIid, formatKeyValue } from '@simplysf/simply-gitlab-core';
import { GitLabCommand, projectFlag } from '../../../shared/base-command.js';

interface MergeRequest {
  readonly iid?: number;
  readonly title?: string;
  readonly description?: string;
  readonly state?: string;
  readonly source_branch?: string;
  readonly target_branch?: string;
  readonly author?: { readonly username?: string };
  readonly merge_status?: string;
  readonly detailed_merge_status?: string;
  readonly draft?: boolean;
  readonly has_conflicts?: boolean;
  readonly labels?: string[];
  readonly updated_at?: string;
  readonly web_url?: string;
}

export default class GitlabMrView extends GitLabCommand<typeof GitlabMrView> {
  public static override readonly summary = 'Show one merge request.';
  public static override readonly description =
    'Takes the project-scoped iid — the number in the merge request URL — not the instance-wide ' +
    'id. Use --json for the full payload, which carries the pipeline status, approvals, and diff ' +
    'refs the summary below leaves out.';

  public static override readonly examples = [
    '<%= config.bin %> <%= command.id %> --project group/project --mr 42',
    '<%= config.bin %> <%= command.id %> --project group/project --mr 42 --json',
  ];

  public static override readonly flags = {
    ...projectFlag,
    mr: Flags.integer({ summary: 'Merge request iid.', required: true }),
  };

  public async run(): Promise<unknown> {
    const iid = assertIid(this.flags.mr);
    const mr = (await this.gitlab().getMergeRequest(this.flags.project, iid)) as MergeRequest;

    this.logSafe(
      formatKeyValue([
        ['Merge request', `!${mr.iid ?? iid}`],
        ['Title', mr.title],
        ['State', mr.draft === true ? `${mr.state ?? 'opened'} (draft)` : mr.state],
        ['Branches', `${mr.source_branch ?? '?'} -> ${mr.target_branch ?? '?'}`],
        ['Author', mr.author?.username],
        ['Merge status', mr.detailed_merge_status ?? mr.merge_status],
        ['Conflicts', mr.has_conflicts === true ? 'yes' : undefined],
        ['Labels', mr.labels?.join(', ')],
        ['Updated', mr.updated_at],
        ['URL', mr.web_url],
      ]),
    );
    if (typeof mr.description === 'string' && mr.description.trim() !== '') {
      this.log('');
      this.logSafe(mr.description.trimEnd());
    }

    return mr;
  }
}
