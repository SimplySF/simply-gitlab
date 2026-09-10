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
import { DEFAULT_CONCURRENCY } from '@simplysf/simply-gitlab-core';

/**
 * The flags `config plan` and `config apply` share, defined once so the two cannot disagree about
 * what a run means. Both commands read the same file and resolve the same targets; only what they
 * do afterwards differs.
 */
export const baselineFlags = {
  config: Flags.string({
    char: 'c',
    summary: 'Path to the baseline configuration file.',
    required: true,
  }),
  target: Flags.string({
    summary: 'Limit the run to this project path. Repeatable.',
    description:
      'Narrows a run without editing the config, for the loop of fixing one project and checking ' +
      'it again. Naming a project the config does not target is an error rather than a silent ' +
      'no-op.',
    multiple: true,
  }),
  concurrency: Flags.integer({
    summary: 'How many targets to work on at once.',
    description:
      'Small by default. The client already retries a rate-limited request with a capped ' +
      'Retry-After, so raising this trades a shared instance responsiveness for very little ' +
      'wall-clock time.',
    default: DEFAULT_CONCURRENCY,
    min: 1,
    max: 16,
  }),
  'fail-fast': Flags.boolean({
    summary: 'Stop at the first target that fails instead of continuing.',
    default: false,
  }),
};
