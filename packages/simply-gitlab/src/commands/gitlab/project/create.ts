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
import { formatKeyValue, parseBodyInput, prepareProjectCreate } from '@simplysf/simply-gitlab-core';
import { GitLabCommand, parseList, writeFlags } from '../../../shared/base-command.js';

interface CreatedProject {
  readonly id?: number;
  readonly path_with_namespace?: string;
  readonly visibility?: string;
  readonly default_branch?: string;
  readonly import_status?: string;
  readonly web_url?: string;
}

export default class GitlabProjectCreate extends GitLabCommand<typeof GitlabProjectCreate> {
  public static override isWrite = true;

  public static override readonly summary = 'Create a project, blank or from a template.';
  public static override readonly description =
    'Creates the project in --namespace, or in the namespace of the token owner when none is ' +
    'given. Give it --name or --path; GitLab derives whichever one is missing.\n\n' +
    '--template names one of the built-in templates GitLab ships, such as express or rails. To ' +
    'create from a custom template instead, add --custom-template for one the instance ' +
    'administrator registered, --template-group for one in a group, or use --template-project ' +
    'to name the template project itself by id or path — which GitLab prefers, because a name ' +
    'can be ambiguous. Add --template-group to --template-project when the template belongs to ' +
    'a group rather than the instance. Custom templates need a Premium or Ultimate instance.\n\n' +
    'A template is applied asynchronously: this command returns as soon as the project record ' +
    'exists, with an import status of "scheduled", and the files arrive a few seconds later. ' +
    'Check "project view" until its import_status reads "finished" before writing to the ' +
    'repository. --dry-run prints the exact request body; a namespace or template given as a ' +
    'path is still looked up, so the printed ids are the ones that would be sent.';

  public static override readonly examples = [
    '<%= config.bin %> <%= command.id %> --name new-service --namespace platform/apps',
    '<%= config.bin %> <%= command.id %> --name new-service --namespace platform/apps --template express --visibility internal',
    '<%= config.bin %> <%= command.id %> --name new-service --namespace platform/apps --template service-skeleton --template-group platform/templates',
    '<%= config.bin %> <%= command.id %> --path new-service --template-project platform/templates/service-skeleton --dry-run',
    '<%= config.bin %> <%= command.id %> --name new-service --template-project platform/templates/service-skeleton --template-group platform/templates',
  ];

  public static override readonly flags = {
    ...writeFlags,
    name: Flags.string({ summary: 'Project name. The path is derived from it when --path is not given.' }),
    path: Flags.string({
      summary: 'Repository path, the URL slug. The name is derived from it when --name is not given.',
    }),
    namespace: Flags.string({
      summary: 'Group or user namespace to create the project in, by id or full path.',
      description: 'Defaults to the namespace of the token owner.',
    }),
    description: Flags.string({ summary: 'Project description.' }),
    visibility: Flags.option({
      summary: 'Who can see the project.',
      options: ['private', 'internal', 'public'] as const,
    })(),
    'default-branch': Flags.string({ summary: 'Name of the default branch.' }),
    'initialize-with-readme': Flags.boolean({
      summary: 'Create a first commit holding a README, so the repository is not empty.',
      default: false,
    }),
    topics: Flags.string({ summary: 'Comma-separated topics to label the project with.' }),
    template: Flags.string({
      summary: 'Template to create from: a built-in name, or with --custom-template or --template-group a custom one.',
    }),
    'custom-template': Flags.boolean({
      summary: "Look --template up among the instance's custom project templates rather than the built-in ones.",
      default: false,
    }),
    'template-group': Flags.string({
      summary: 'Group whose custom project templates --template or --template-project names, by id or full path.',
    }),
    'template-project': Flags.string({
      summary: 'Custom template project to create from, by id or full path. Cannot be combined with --template.',
    }),
    body: Flags.string({ summary: 'Raw JSON request body.', exclusive: ['body-file'] }),
    'body-file': Flags.string({ summary: 'Path to a file holding the raw JSON request body.' }),
  };

  public async run(): Promise<unknown> {
    const client = this.gitlab();
    const request = await prepareProjectCreate(client, {
      name: this.flags.name,
      path: this.flags.path,
      namespace: this.flags.namespace,
      description: this.flags.description,
      visibility: this.flags.visibility,
      defaultBranch: this.flags['default-branch'],
      initializeWithReadme: this.flags['initialize-with-readme'] || undefined,
      topics: parseList(this.flags.topics),
      template: this.flags.template,
      customTemplate: this.flags['custom-template'] || undefined,
      templateGroup: this.flags['template-group'],
      templateProject: this.flags['template-project'],
      body: parseBodyInput(this.flags.body, this.flags['body-file']),
    });

    if (this.flags['dry-run']) {
      this.log('Dry run — not sent. Request body:');
      this.logSafe(JSON.stringify(request, null, 2));
      return request;
    }

    const created = (await client.createProject(request)) as CreatedProject;
    this.logSafe(
      formatKeyValue([
        ['Created', created.path_with_namespace ?? this.flags.name ?? this.flags.path],
        ['ID', created.id],
        ['Visibility', created.visibility],
        ['Default branch', created.default_branch],
        ['Import status', created.import_status],
        ['URL', created.web_url],
      ]),
    );
    return created;
  }
}
