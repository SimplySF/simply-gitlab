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
import { assertIid, CliError, describeMergeOutcome, executeMerge, prepareMerge } from '@simplysf/simply-gitlab-core';
import { GitLabCommand, projectFlag, writeFlags } from '../../../shared/base-command.js';

export default class GitlabMrMerge extends GitLabCommand<typeof GitlabMrMerge> {
  public static override isWrite = true;

  public static override readonly summary = 'Merge a merge request, or add it to the merge train.';
  public static override readonly description =
    'Merging cannot be undone by any other command, so this one refuses to send anything without ' +
    '--confirm. Without it, it prints the request it would send and exits 1.\n\n' +
    'Pass --sha with the head you reviewed (the "Head" line of mr view): GitLab then refuses if ' +
    'anything was pushed since. --auto-merge merges once checks pass, and on a project with merge ' +
    'trains it joins the train. --skip-merge-train uses GitLab\'s experimental "merge immediately ' +
    'without restarting the merge train", which merges changes the train has not tested against ' +
    'the merge requests queued ahead of it; it requires --sha.\n\n' +
    'When GitLab refuses with a bare 405, the merge request is read back and the reason is named.';

  public static override readonly examples = [
    '<%= config.bin %> <%= command.id %> --project group/project --mr 42 --sha <head-sha> --confirm',
    '<%= config.bin %> <%= command.id %> --project group/project --mr 42 --auto-merge --confirm',
    '<%= config.bin %> <%= command.id %> --project group/project --mr 42 --skip-merge-train --sha <head-sha> --confirm',
    '<%= config.bin %> <%= command.id %> --project group/project --mr 42 --squash --dry-run',
  ];

  public static override readonly flags = {
    ...projectFlag,
    ...writeFlags,
    mr: Flags.integer({ summary: 'Merge request iid.', required: true }),
    sha: Flags.string({
      summary: 'Full sha of the source branch head you reviewed. Recommended; required with --skip-merge-train.',
    }),
    'auto-merge': Flags.boolean({
      summary: 'Merge when checks pass. On a project with merge trains, this joins the train.',
      exclusive: ['skip-merge-train'],
    }),
    'skip-merge-train': Flags.boolean({
      summary: 'Merge now without restarting the merge train. Experimental in GitLab.',
      exclusive: ['auto-merge'],
    }),
    squash: Flags.boolean({ summary: 'Squash the commits into one.', allowNo: true }),
    'remove-source-branch': Flags.boolean({ summary: 'Delete the source branch after merging.', allowNo: true }),
    'merge-commit-message': Flags.string({ summary: 'Custom merge commit message.' }),
    'squash-commit-message': Flags.string({ summary: 'Custom squash commit message.' }),
    confirm: Flags.boolean({ summary: 'Send the merge. Without it, nothing is sent.', default: false }),
  };

  public async run(): Promise<unknown> {
    const iid = assertIid(this.flags.mr);
    const client = this.gitlab();
    const prepared = await prepareMerge(client, this.flags.project, iid, {
      sha: this.flags.sha,
      autoMerge: this.flags['auto-merge'],
      skipMergeTrain: this.flags['skip-merge-train'],
      squash: this.flags.squash,
      removeSourceBranch: this.flags['remove-source-branch'],
      mergeCommitMessage: this.flags['merge-commit-message'],
      squashCommitMessage: this.flags['squash-commit-message'],
    });

    if (this.flags['dry-run'] || !this.flags.confirm) {
      this.log(`${this.flags['dry-run'] ? 'Dry run' : 'Not confirmed'} — not sent. Merge !${iid} with request body:`);
      this.logSafe(JSON.stringify(prepared.body, null, 2));
      if (this.flags['dry-run']) return prepared.body;
      throw new CliError('Merging cannot be undone. Pass --confirm to send it, or --dry-run to only preview.');
    }

    const outcome = await executeMerge(client, this.flags.project, prepared);
    this.logSafe(describeMergeOutcome(outcome));
    return outcome.mergeRequest;
  }
}
