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

import type { ApplyResult } from './baseline-apply.js';
import type { BaselinePlan, Change, SectionPlan, TargetPlan } from './baseline-plan.js';
import { summarise } from './baseline-run.js';
import { stripControlOneLine } from './text.js';

/**
 * Renders a plan for a person to read before deciding to apply it.
 *
 * Lives in core rather than in the command for the same reason the table column sets do: the MCP
 * server publishes this plan too, and a renderer only the CLI knew about would drift from what the
 * tool describes. Nothing here writes to a stream; it returns a string.
 */

/** Values in a plan are whatever GitLab returned, so they are rendered defensively. */
function value(input: unknown): string {
  if (input === undefined) return 'unset';
  if (input === null) return 'null';
  if (typeof input === 'string') return stripControlOneLine(input) || "''";
  if (Array.isArray(input)) return input.length === 0 ? '[]' : `[${input.map((item) => value(item)).join(', ')}]`;
  if (typeof input === 'object') return stripControlOneLine(JSON.stringify(input));
  if (typeof input === 'number' || typeof input === 'boolean') return String(input);
  // Anything else came from server JSON; serialise rather than coerce it to [object Object].
  return stripControlOneLine(JSON.stringify(input) ?? '');
}

const MARKS: Readonly<Record<Change['op'], string>> = {
  create: '+',
  update: '~',
  delete: '-',
  recreate: '±',
  report: '!',
};

function renderChange(change: Change): string {
  const mark = MARKS[change.op];
  const key = stripControlOneLine(change.key);

  if (change.op === 'update') {
    const detail = change.detail === undefined ? '' : `   (${change.detail})`;
    return `    ${mark} ${key}  ${value(change.from)} → ${value(change.to)}${detail}`;
  }
  if (change.op === 'report') {
    const shift = change.to === undefined ? '' : `  ${value(change.from)} → ${value(change.to)}`;
    return `    ${mark} ${key}${shift}   (${change.detail ?? 'reported only'})`;
  }
  const detail = change.detail === undefined ? '' : `   (${change.detail})`;
  const extra = change.to === undefined ? '' : `  ${value(change.to)}`;
  return `    ${mark} ${key}${extra}${detail}`;
}

function renderSection(section: SectionPlan): string[] {
  if (!section.supported) {
    return [`  ${section.section}`, `    ! ${section.unsupportedReason ?? 'unsupported on this instance'}`];
  }
  if (section.changes.length === 0) return [];
  return [`  ${section.section}`, ...section.changes.map(renderChange)];
}

function renderTarget(target: TargetPlan): string[] {
  const heading = target.kind === 'group' ? `${target.path}  (group)` : target.path;

  if (target.error !== undefined) {
    return [heading, `    ✗ ${stripControlOneLine(target.error)}`];
  }

  const body = target.sections.flatMap(renderSection);
  if (body.length === 0) return [heading, '  ✓ matches the baseline'];
  return [heading, ...body];
}

/** The whole plan, target by target, with a closing summary. */
export function renderPlan(plan: BaselinePlan): string {
  const blocks = plan.targets.map((target) => renderTarget(target).join('\n'));
  const counts = summarise(plan);

  const parts = [
    `${counts.targets} target(s): ${counts.matching} match, ${counts.differing} differ`,
    counts.failed > 0 ? `${counts.failed} failed` : undefined,
    counts.unsupported > 0 ? `${counts.unsupported} with an unsupported section` : undefined,
  ].filter((part): part is string => part !== undefined);

  return [blocks.join('\n\n'), `${parts.join(', ')}.`].join('\n\n');
}

/**
 * The plan as data, for `--json` and for the MCP tool.
 *
 * `actions` are deliberately dropped: they are how apply executes, not something a caller should
 * depend on, and publishing them would make an internal shape part of the contract.
 */
export function planToJson(plan: BaselinePlan): unknown {
  return {
    targets: plan.targets.map((target) => ({
      kind: target.kind,
      path: target.path,
      id: target.id,
      ...(target.error === undefined ? {} : { error: target.error }),
      sections: target.sections.map((section) => ({
        section: section.section,
        supported: section.supported,
        ...(section.unsupportedReason === undefined ? {} : { unsupportedReason: section.unsupportedReason }),
        changes: section.changes,
        willChange: section.actions.length > 0,
      })),
    })),
    summary: summarise(plan),
  };
}

/** What an apply actually did, after the fact. */
export function renderApply(result: ApplyResult): string {
  const lines: string[] = [];
  let applied = 0;
  let failed = 0;

  for (const target of result.targets) {
    applied += target.applied;
    if (target.error !== undefined) {
      failed += 1;
      const where = target.failedSection === undefined ? '' : ` in ${target.failedSection}`;
      lines.push(`${target.path}`);
      lines.push(`    ✗ stopped${where} after ${target.applied} change(s): ${stripControlOneLine(target.error)}`);
      continue;
    }
    if (target.applied > 0) lines.push(`${target.path}  ✓ ${target.applied} change(s)`);
  }

  const summary =
    failed === 0
      ? `Applied ${applied} change(s) across ${result.targets.length} target(s).`
      : `Applied ${applied} change(s); ${failed} target(s) failed. Run plan again to see what is left.`;

  return lines.length === 0 ? summary : [lines.join('\n'), summary].join('\n\n');
}
