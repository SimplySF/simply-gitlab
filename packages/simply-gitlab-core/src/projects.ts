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

import { ConfigError } from './errors.js';
import type { GitLabClient, ProjectRef } from './gitlab-client.js';
import { mergeBody } from './json-input.js';

export type ProjectVisibility = 'private' | 'internal' | 'public';

/**
 * Everything `POST /projects` takes that has a flag, with the ids already numeric. A caller holding
 * a path rather than an id goes through `prepareProjectCreate`, which resolves them first.
 */
export interface ProjectCreateInput {
  readonly name?: string;
  readonly path?: string;
  readonly namespaceId?: number;
  readonly description?: string;
  readonly visibility?: ProjectVisibility;
  readonly defaultBranch?: string;
  readonly initializeWithReadme?: boolean;
  readonly topics?: readonly string[];
  /** A built-in template's name, or — with `customTemplate` or `templateGroupId` — a custom one's. */
  readonly template?: string;
  /** Look `template` up among the instance's custom project templates rather than the built-in ones. */
  readonly customTemplate?: boolean;
  /** A custom template by project id. GitLab prefers this to a name, which can be ambiguous. */
  readonly templateProjectId?: number;
  /** The group whose custom templates `template` or `templateProjectId` names; unset means the instance-level group. */
  readonly templateGroupId?: number;
  readonly body?: Record<string, unknown>;
}

/** The same input, with the three ids accepted as an id *or* a full path. */
export interface ProjectCreateRefs extends Omit<
  ProjectCreateInput,
  'namespaceId' | 'templateProjectId' | 'templateGroupId'
> {
  readonly namespace?: ProjectRef;
  readonly templateProject?: ProjectRef;
  readonly templateGroup?: ProjectRef;
}

/**
 * The template flags only make sense in certain combinations, and GitLab's 400 for a wrong one
 * does not say which flag to drop. Checked up front — before any id is looked up — so a refused
 * combination costs no request.
 */
function assertTemplateSelection(input: {
  readonly template?: string;
  readonly customTemplate?: boolean;
  readonly templateProject?: unknown;
  readonly templateGroup?: unknown;
}): void {
  if (input.template !== undefined && input.templateProject !== undefined) {
    throw new ConfigError('Pass --template or --template-project, not both.');
  }
  // A group scopes the lookup of either a name or a project id: GitLab searches a group's custom
  // templates only when told the group, so a group-level template by id needs both.
  if (input.templateGroup !== undefined && input.template === undefined && input.templateProject === undefined) {
    throw new ConfigError(
      "--template-group needs --template or --template-project: it names which of that group's custom templates to create from.",
    );
  }
  if (input.customTemplate === true && input.template === undefined) {
    throw new ConfigError('--custom-template needs --template: it names which custom template to create from.');
  }
}

/**
 * Builds the body of `POST /projects`.
 *
 * GitLab cannot tell a built-in template name from a custom one — that is why `use_custom_template`
 * exists — so it is set exactly when the caller chose one of the three custom routes: by name on the
 * instance, by name within a group, or by project id. A plain `template` stays built-in.
 */
export function buildProjectCreateBody(input: ProjectCreateInput): Record<string, unknown> {
  assertTemplateSelection({
    template: input.template,
    customTemplate: input.customTemplate,
    templateProject: input.templateProjectId,
    templateGroup: input.templateGroupId,
  });

  const custom =
    input.customTemplate === true || input.templateGroupId !== undefined || input.templateProjectId !== undefined;

  const merged = mergeBody(input.body, {
    name: input.name,
    path: input.path,
    namespace_id: input.namespaceId,
    description: input.description,
    visibility: input.visibility,
    default_branch: input.defaultBranch,
    initialize_with_readme: input.initializeWithReadme,
    topics: input.topics === undefined ? undefined : [...input.topics],
    template_name: input.template,
    use_custom_template: custom ? true : undefined,
    template_project_id: input.templateProjectId,
    group_with_project_templates_id: input.templateGroupId,
  });

  // Checked here so the refusal names the flags. GitLab's own 400 is `{"error":"name is missing"}`,
  // which does not mention that a path alone would have done.
  const named = (key: 'name' | 'path'): boolean => typeof merged[key] === 'string' && merged[key] !== '';
  if (!named('name') && !named('path')) {
    throw new ConfigError('A project needs a name or a path: pass --name or --path.');
  }

  return merged;
}

/** A reference that is already a number, or a string of digits, needs no lookup. */
function numericId(ref: ProjectRef): number | undefined {
  if (typeof ref === 'number') return ref;
  const text = ref.trim();
  return /^\d+$/.test(text) ? Number(text) : undefined;
}

async function resolveId(ref: ProjectRef, lookup: () => Promise<unknown>, what: string): Promise<number> {
  const direct = numericId(ref);
  if (direct !== undefined) return direct;

  const found = await lookup();
  const id = typeof found === 'object' && found !== null ? (found as { id?: unknown }).id : undefined;
  if (typeof id !== 'number') {
    throw new ConfigError(`The ${what} ${String(ref)} was found, but the response carried no numeric id.`);
  }
  return id;
}

/**
 * `namespace_id` is an integer, while everything else in this CLI addresses things by path. A
 * numeric reference is used as is; a path is looked up through `GET /namespaces/:path`, which
 * covers both groups and user namespaces.
 */
export function resolveNamespaceId(client: GitLabClient, namespace: ProjectRef): Promise<number> {
  return resolveId(namespace, () => client.getNamespace(namespace), 'namespace');
}

export function resolveGroupId(client: GitLabClient, group: ProjectRef): Promise<number> {
  return resolveId(group, () => client.getGroup(group), 'group');
}

export function resolveProjectId(client: GitLabClient, project: ProjectRef): Promise<number> {
  return resolveId(project, () => client.getProject(project), 'project');
}

/**
 * Resolves any path the caller gave for the namespace, template group, or template project to its
 * id, then builds the request body. The lookups are reads, and they happen on a dry run too: the
 * point of a dry run is that the printed body is exactly the one that would be sent, and
 * `"namespace_id": "platform/apps"` never could be.
 */
export async function prepareProjectCreate(
  client: GitLabClient,
  input: ProjectCreateRefs,
): Promise<Record<string, unknown>> {
  assertTemplateSelection(input);

  const { namespace, templateProject, templateGroup, ...rest } = input;
  const [namespaceId, templateProjectId, templateGroupId] = await Promise.all([
    namespace === undefined ? undefined : resolveNamespaceId(client, namespace),
    templateProject === undefined ? undefined : resolveProjectId(client, templateProject),
    templateGroup === undefined ? undefined : resolveGroupId(client, templateGroup),
  ]);

  return buildProjectCreateBody({ ...rest, namespaceId, templateProjectId, templateGroupId });
}
