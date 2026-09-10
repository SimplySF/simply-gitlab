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
import { CliError, hasDrift, loadBaselineConfig, planRun, planToJson, renderPlan } from '@simplysf/simply-gitlab-core';
import { GitLabCommand } from '../../../shared/base-command.js';
import { baselineFlags } from '../../../shared/baseline-flags.js';

export default class GitlabConfigPlan extends GitLabCommand<typeof GitlabConfigPlan> {
  public static override readonly summary = 'Report how projects differ from a baseline config.';
  public static override readonly description =
    'Reads the baseline, expands its targets, and prints what differs on each one. Nothing is ' +
    'sent that changes anything, so this is safe to run against every project you have.\n\n' +
    'Only the attributes the config declares are compared. A project with forty settings the ' +
    'config never mentions shows nothing for them — that is what makes a baseline safe to point ' +
    'at projects that already exist.\n\n' +
    'Entries that exist on the instance but are not in the config are shown as removals, marked ' +
    'as not pruned unless that section opts into pruning. Seeing what you are choosing not to fix ' +
    'is most of the value of running this across fifty projects.\n\n' +
    'Use --fail-on-drift in a scheduled job: it exits 1 when anything differs, so CI can tell you ' +
    'that something drifted without anyone having to read the output.';

  public static override readonly examples = [
    '<%= config.bin %> <%= command.id %> --config ./baseline.json',
    '<%= config.bin %> <%= command.id %> --config ./baseline.json --target group/project',
    '<%= config.bin %> <%= command.id %> --config ./baseline.json --fail-on-drift',
    '<%= config.bin %> <%= command.id %> --config ./baseline.json --json | jq .summary',
  ];

  public static override readonly flags = {
    ...baselineFlags,
    'fail-on-drift': Flags.boolean({
      summary: 'Exit 1 when any target differs from the baseline.',
      default: false,
    }),
  };

  public async run(): Promise<unknown> {
    const config = loadBaselineConfig(this.flags.config);
    const { targets, plan } = await planRun(this.gitlab(), config, {
      concurrency: this.flags.concurrency,
      failFast: this.flags['fail-fast'],
      only: this.flags.target,
    });

    if (!this.jsonEnabled()) {
      // What a run is about to touch is the first question anyone should ask and the last one
      // they should have to guess at.
      this.log(`Targets: ${targets.projects.length} project(s), ${targets.groups.length} group(s).`);
      if (targets.excluded.length > 0) this.logSafe(`Excluded: ${targets.excluded.join(', ')}`);
      this.log('');
      this.logSafe(renderPlan(plan));
    }

    const drifted = hasDrift(plan);
    if (this.flags['fail-on-drift'] && drifted) {
      // Deliberately after the output: the point of the flag is to fail a job, not to hide why.
      throw new CliError('The baseline does not match. Run without --fail-on-drift to see the plan.');
    }

    return planToJson(plan);
  }
}
