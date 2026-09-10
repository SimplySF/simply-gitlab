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
import { readTextFile } from './json-input.js';

/**
 * The baseline configuration file: what a set of projects should have in common.
 *
 * Everything here is data. Reading it, diffing against an instance, and converging are three other
 * modules; this one only turns a file into a validated, merged description of intent — which is
 * what makes the merge semantics below testable without a server.
 *
 * See docs/design/0007-configuration-baselines.md.
 */
export interface BaselineConfig {
  readonly version: 1;
  readonly targets?: BaselineTargets;
  readonly group?: GroupDesired;
  readonly project?: ProjectDesired;
  readonly overrides?: Readonly<Record<string, TargetOverride>>;
}

export interface BaselineTargets {
  /** Group paths or ids. Expands to every project in the group and its subgroups. */
  readonly groups?: readonly string[];
  /** Individual project paths or ids, added to whatever the groups expanded to. */
  readonly projects?: readonly string[];
  /** Removed from the union. A trailing `*` drops a whole subtree. */
  readonly exclude?: readonly string[];
}

export interface TargetOverride {
  readonly project?: ProjectDesired;
  readonly group?: GroupDesired;
}

export interface GroupDesired {
  readonly settings?: Readonly<Record<string, unknown>>;
}

export interface ProjectDesired {
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly protectedBranches?: Section;
  readonly protectedTags?: Section;
  readonly approvals?: Readonly<Record<string, unknown>>;
  readonly approvalRules?: Section;
  readonly pushRules?: Readonly<Record<string, unknown>>;
  readonly variables?: Section;
}

/** An entry in a keyed section. Fields are GitLab's own, so this stays deliberately open. */
export type Entry = Readonly<Record<string, unknown>>;

/**
 * A list section, in either of the two shapes the file accepts: a bare array, or an object that
 * can also turn on pruning or wholesale replacement.
 */
export type Section = readonly Entry[] | SectionObject;

export interface SectionObject {
  /** Delete entries that exist on the instance but are not declared here. Off by default. */
  readonly prune?: boolean;
  /** Replace the baseline's entries entirely instead of merging into them, in an override. */
  readonly $replace?: boolean;
  readonly entries: readonly Entry[];
}

/** A section reduced to the three things every consumer needs. */
export interface NormalizedSection {
  readonly prune: boolean;
  readonly replace: boolean;
  readonly entries: readonly Entry[];
}

/** The list sections, in the order `apply` reconciles them. */
export const LIST_SECTIONS = ['protectedBranches', 'protectedTags', 'approvalRules', 'variables'] as const;
export type ListSection = (typeof LIST_SECTIONS)[number];

/** The object sections, which merge key by key rather than by entry. */
export const OBJECT_SECTIONS = ['settings', 'approvals', 'pushRules'] as const;

/**
 * What identifies an entry within its section, for merging an override onto a baseline and for
 * matching a declared entry against one that already exists on the instance.
 *
 * Every section has a natural key, which is what makes a two-line override possible: restating a
 * whole array to change one number is how these files rot.
 */
const SECTION_KEYS: Readonly<Record<ListSection, readonly string[]>> = {
  protectedBranches: ['name'],
  protectedTags: ['name'],
  approvalRules: ['name'],
  variables: ['key', 'environment_scope'],
};

/** GitLab treats an unset environment scope as `*`, so the merge key has to agree with it. */
const SCOPE_DEFAULTS: Readonly<Record<string, string>> = { environment_scope: '*' };

/**
 * Renders a key field as text.
 *
 * Key fields come out of parsed JSON, so they are `unknown` until proven otherwise. Coercing an
 * object with `String()` would key every such entry as `[object Object]` and silently collide
 * entries that are not the same thing at all.
 */
function keyText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value) ?? '';
}

/** The identity of one entry, as a string, for keying a map. */
export function entryKey(section: ListSection, entry: Entry): string {
  return SECTION_KEYS[section].map((field) => keyText(entry[field] ?? SCOPE_DEFAULTS[field])).join(' ');
}

/** The human-readable identity of one entry, for plan output. */
export function entryLabel(section: ListSection, entry: Entry): string {
  return SECTION_KEYS[section]
    .map((field) => keyText(entry[field] ?? SCOPE_DEFAULTS[field]))
    .filter((part) => part !== '')
    .join(' @ ');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeSection(section: Section | undefined): NormalizedSection | undefined {
  if (section === undefined) return undefined;
  if (Array.isArray(section)) return { prune: false, replace: false, entries: section };
  const object = section as SectionObject;
  return { prune: object.prune === true, replace: object.$replace === true, entries: object.entries };
}

// --- Validation ---------------------------------------------------------------------------------

/**
 * Validates the parsed file, reporting the JSON path of whatever is wrong.
 *
 * Hand-written rather than schema-driven because the error is the product: a caller who wrote
 * `"targets": {"group": "x"}` needs to be told that the key is `groups` and that it takes an array,
 * at that path, not that the document failed to match a schema. The published JSON Schema gives an
 * editor completion and hover text; this is what runs.
 */
export function validateBaselineConfig(value: unknown, label = 'config'): BaselineConfig {
  const problems: string[] = [];
  const at = (path: string, message: string): void => {
    problems.push(`${path}: ${message}`);
  };

  if (!isPlainObject(value)) {
    throw new ConfigError(`${label} must be a JSON object.`);
  }

  if (value.version !== 1) {
    at('version', `must be 1, got ${JSON.stringify(value.version)}`);
  }

  const known = new Set(['$schema', 'version', 'targets', 'group', 'project', 'overrides']);
  for (const key of Object.keys(value)) {
    if (!known.has(key)) at(key, `is not a known top-level key (expected one of ${[...known].join(', ')})`);
  }

  if (value.targets !== undefined) validateTargets(value.targets, 'targets', at);
  if (value.group !== undefined) validateGroupDesired(value.group, 'group', at);
  if (value.project !== undefined) validateProjectDesired(value.project, 'project', at);

  if (value.overrides !== undefined) {
    if (!isPlainObject(value.overrides)) {
      at('overrides', 'must be an object keyed by project or group path');
    } else {
      for (const [path, override] of Object.entries(value.overrides)) {
        const where = `overrides["${path}"]`;
        if (!isPlainObject(override)) {
          at(where, 'must be an object');
          continue;
        }
        for (const key of Object.keys(override)) {
          if (key !== 'project' && key !== 'group') at(`${where}.${key}`, 'must be "project" or "group"');
        }
        if (override.project !== undefined) validateProjectDesired(override.project, `${where}.project`, at);
        if (override.group !== undefined) validateGroupDesired(override.group, `${where}.group`, at);
      }
    }
  }

  if (problems.length > 0) {
    // Every problem at once. Fixing a config one error per run, fifty projects into a change, is
    // the kind of loop that makes people stop using the tool.
    throw new ConfigError(`${label} is not valid:\n  ${problems.join('\n  ')}`);
  }

  return value as unknown as BaselineConfig;
}

type Report = (path: string, message: string) => void;

function validateStringArray(value: unknown, path: string, at: Report): void {
  if (!Array.isArray(value)) {
    at(path, 'must be an array of strings');
    return;
  }
  for (const [index, item] of value.entries()) {
    if (typeof item !== 'string' || item.trim() === '') {
      at(`${path}[${index}]`, `must be a non-empty string, got ${JSON.stringify(item)}`);
    }
  }
}

function validateTargets(value: unknown, path: string, at: Report): void {
  if (!isPlainObject(value)) {
    at(path, 'must be an object');
    return;
  }
  const known = new Set(['groups', 'projects', 'exclude']);
  for (const key of Object.keys(value)) {
    if (!known.has(key)) at(`${path}.${key}`, `is not a known key (expected ${[...known].join(', ')})`);
  }
  for (const key of known) {
    if (value[key] !== undefined) validateStringArray(value[key], `${path}.${key}`, at);
  }
  if (value.groups === undefined && value.projects === undefined) {
    at(path, 'must name at least one of "groups" or "projects"');
  }
}

function validateGroupDesired(value: unknown, path: string, at: Report): void {
  if (!isPlainObject(value)) {
    at(path, 'must be an object');
    return;
  }
  for (const key of Object.keys(value)) {
    if (key !== 'settings') at(`${path}.${key}`, 'is not a known key (expected "settings")');
  }
  if (value.settings !== undefined && !isPlainObject(value.settings)) {
    at(`${path}.settings`, 'must be an object of GitLab group attributes');
  }
}

function validateProjectDesired(value: unknown, path: string, at: Report): void {
  if (!isPlainObject(value)) {
    at(path, 'must be an object');
    return;
  }

  const known = new Set<string>([...OBJECT_SECTIONS, ...LIST_SECTIONS]);
  for (const key of Object.keys(value)) {
    if (!known.has(key)) at(`${path}.${key}`, `is not a known section (expected ${[...known].join(', ')})`);
  }

  for (const section of OBJECT_SECTIONS) {
    const entry = value[section];
    if (entry !== undefined && !isPlainObject(entry)) {
      at(`${path}.${section}`, 'must be an object of GitLab attributes');
    }
  }

  for (const section of LIST_SECTIONS) {
    if (value[section] !== undefined) validateListSection(value[section], `${path}.${section}`, section, at);
  }
}

function validateListSection(value: unknown, path: string, section: ListSection, at: Report): void {
  let entries: unknown;

  if (Array.isArray(value)) {
    entries = value;
  } else if (isPlainObject(value)) {
    const known = new Set(['prune', '$replace', 'entries']);
    for (const key of Object.keys(value)) {
      if (!known.has(key)) at(`${path}.${key}`, `is not a known key (expected ${[...known].join(', ')})`);
    }
    for (const flag of ['prune', '$replace'] as const) {
      if (value[flag] !== undefined && typeof value[flag] !== 'boolean') at(`${path}.${flag}`, 'must be a boolean');
    }
    if (value.entries === undefined) {
      at(`${path}.entries`, 'is required when the section is written as an object');
      return;
    }
    entries = value.entries;
  } else {
    at(path, 'must be an array of entries, or an object with an "entries" array');
    return;
  }

  if (!Array.isArray(entries)) {
    at(Array.isArray(value) ? path : `${path}.entries`, 'must be an array');
    return;
  }

  const base = Array.isArray(value) ? path : `${path}.entries`;
  const seen = new Map<string, number>();
  for (const [index, entry] of entries.entries()) {
    const where = `${base}[${index}]`;
    if (!isPlainObject(entry)) {
      at(where, 'must be an object');
      continue;
    }
    for (const field of SECTION_KEYS[section]) {
      // Only the first key field is required; `environment_scope` defaults to `*`, as GitLab does.
      if (field !== SECTION_KEYS[section][0]) continue;
      if (typeof entry[field] !== 'string' || entry[field].trim() === '') {
        at(`${where}.${field}`, `is required and must be a non-empty string`);
      }
    }
    const key = entryKey(section, entry);
    const first = seen.get(key);
    if (first !== undefined) {
      // Two entries with the same identity would silently reconcile against each other.
      at(where, `duplicates ${base}[${first}] (same ${SECTION_KEYS[section].join(' + ')})`);
    } else {
      seen.set(key, index);
    }
  }
}

// --- Merging ------------------------------------------------------------------------------------

/**
 * The effective configuration for one project: the baseline with its override merged over it.
 *
 * Objects merge key by key. Lists merge by the section's natural key, so an override adjusts one
 * entry rather than restating the array — unless it sets `$replace`, which swaps the list wholesale
 * for the project that genuinely needs different rules rather than adjusted ones.
 */
export function mergeProjectDesired(base: ProjectDesired = {}, override: ProjectDesired = {}): ProjectDesired {
  const merged: Record<string, unknown> = {};

  for (const section of OBJECT_SECTIONS) {
    const value = mergeObjects(base[section], override[section]);
    if (value !== undefined) merged[section] = value;
  }

  for (const section of LIST_SECTIONS) {
    const value = mergeSections(section, base[section], override[section]);
    if (value !== undefined) merged[section] = value;
  }

  return merged;
}

export function mergeGroupDesired(base: GroupDesired = {}, override: GroupDesired = {}): GroupDesired {
  const settings = mergeObjects(base.settings, override.settings);
  return settings === undefined ? {} : { settings };
}

function mergeObjects(
  base: Readonly<Record<string, unknown>> | undefined,
  override: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> | undefined {
  if (base === undefined && override === undefined) return undefined;
  return { ...(base ?? {}), ...(override ?? {}) };
}

function mergeSections(section: ListSection, base?: Section, override?: Section): SectionObject | undefined {
  const left = normalizeSection(base);
  const right = normalizeSection(override);
  if (left === undefined && right === undefined) return undefined;
  if (left === undefined) return { prune: right!.prune, entries: right!.entries };
  if (right === undefined) return { prune: left.prune, entries: left.entries };

  // Pruning is a property of the section as configured, so an override can turn it on for one
  // project without the baseline turning it on for all fifty.
  if (right.replace) return { prune: right.prune, entries: right.entries };

  const byKey = new Map<string, Entry>();
  const order: string[] = [];
  for (const entry of left.entries) {
    const key = entryKey(section, entry);
    if (!byKey.has(key)) order.push(key);
    byKey.set(key, entry);
  }
  for (const entry of right.entries) {
    const key = entryKey(section, entry);
    const existing = byKey.get(key);
    if (existing === undefined) order.push(key);
    byKey.set(key, existing === undefined ? entry : { ...existing, ...entry });
  }

  return { prune: right.prune || left.prune, entries: order.map((key) => byKey.get(key)!) };
}

/** The effective project configuration for one path, baseline merged with any override for it. */
export function effectiveProject(config: BaselineConfig, path: string): ProjectDesired {
  return mergeProjectDesired(config.project, config.overrides?.[path]?.project);
}

/** The effective group configuration for one path. */
export function effectiveGroup(config: BaselineConfig, path: string): GroupDesired {
  return mergeGroupDesired(config.group, config.overrides?.[path]?.group);
}

/**
 * Reads and validates a baseline config file.
 *
 * A parse failure reports only the position, never the parser's snippet of the content — the same
 * rule the rest of this package follows, because a caller can name any path and the snippet would
 * echo the first bytes of whatever file that was.
 */
export function loadBaselineConfig(path: string): BaselineConfig {
  const source = readTextFile(path, 'Config file');
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    const position =
      error instanceof Error ? /position \d+(?::? line \d+ column \d+)?/.exec(error.message)?.[0] : undefined;
    throw new ConfigError(`${path} is not valid JSON${position === undefined ? '' : ` at ${position}`}.`);
  }
  return validateBaselineConfig(parsed, path);
}
