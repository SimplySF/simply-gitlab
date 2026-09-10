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

import {
  applyFailures,
  applyPlan,
  CliError,
  hasChanges,
  loadBaselineConfig,
  planRun,
  planToJson,
  renderApply,
  renderPlan,
} from '@simplysf/simply-gitlab-core';
import { GitLabCommand, writeFlags } from '../../../shared/base-command.js';
import { baselineFlags } from '../../../shared/baseline-flags.js';

export default class GitlabConfigApply extends GitLabCommand<typeof GitlabConfigApply> {
  public static override isWrite = true;

  public static override readonly summary = 'Bring projects onto a baseline config.';
  public static override readonly description =
    'Computes the same plan as config plan, then executes it. Only what the plan showed is sent, ' +
    'so a preview is a guarantee rather than an approximation, and a second run against a ' +
    'converged project sends no requests at all.\n\n' +
    'Sections are applied in a fixed order — settings, protected branches, protected tags, ' +
    'approval settings, approval rules, push rules — because an approval rule scoped to a branch ' +
    'needs that branch protected before it can reference it.\n\n' +
    'By default the config only adds and corrects what it declares. A section that sets ' +
    '"prune": true also deletes entries the config does not mention.\n\n' +
    'One target failing does not abandon the rest; the summary says which ones failed and where ' +
    'they stopped. There is no transaction across GitLab endpoints, so a target that failed ' +
    'part-way keeps the sections already applied — run config plan afterwards to see what is left.';

  public static override readonly examples = [
    '<%= config.bin %> <%= command.id %> --config ./baseline.json --dry-run',
    '<%= config.bin %> <%= command.id %> --config ./baseline.json',
    '<%= config.bin %> <%= command.id %> --config ./baseline.json --target group/project',
  ];

  public static override readonly flags = {
    ...baselineFlags,
    ...writeFlags,
  };

  public async run(): Promise<unknown> {
    const config = loadBaselineConfig(this.flags.config);
    const options = {
      concurrency: this.flags.concurrency,
      failFast: this.flags['fail-fast'],
      only: this.flags.target,
    };

    const { targets, plan } = await planRun(this.gitlab(), config, options);

    if (!this.jsonEnabled()) {
      this.log(`Targets: ${targets.projects.length} project(s), ${targets.groups.length} group(s).`);
      if (targets.excluded.length > 0) this.logSafe(`Excluded: ${targets.excluded.join(', ')}`);
      this.log('');
      this.logSafe(renderPlan(plan));
      this.log('');
    }

    if (this.flags['dry-run']) {
      if (!this.jsonEnabled()) this.log('Dry run — nothing sent.');
      return planToJson(plan);
    }

    if (!hasChanges(plan)) {
      if (!this.jsonEnabled()) this.log('Nothing to apply.');
      return { ...(planToJson(plan) as object), applied: [] };
    }

    const result = await applyPlan(this.gitlab(), plan, options);
    if (!this.jsonEnabled()) this.logSafe(renderApply(result));

    const failed = applyFailures(result);
    if (failed.length > 0) {
      throw new CliError(`${failed.length} of ${result.targets.length} target(s) failed. See the output above.`);
    }

    return { ...(planToJson(plan) as object), applied: result.targets };
  }
}
