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

/** What a hidden CI variable's value is replaced with, in both the table and the JSON. */
export const HIDDEN = '<hidden>';

/**
 * Replaces the value of every CI/CD variable with a placeholder.
 *
 * `GET /projects/:id/variables` returns every variable's value in clear text — including the ones
 * marked "masked", because masking only applies to job logs. Those values are deploy keys, signing
 * certificates, and production credentials, and the endpoint's usual caller is a person listing
 * variables to see *which* exist, not to read them.
 *
 * So the values are hidden by default and revealed only on an explicit request. This is the one
 * place the CLI and the MCP server deliberately differ: `--reveal` exists on the command, and
 * there is no equivalent tool input, because a value revealed to an agent is a value copied into
 * a context window, a transcript, and whatever the agent writes next. A person who needs the
 * value can run the command; nothing about the tool catalogue should make exfiltrating a
 * production secret a one-call operation.
 */
export function maskVariables(items: readonly unknown[]): unknown[] {
  return items.map((item) => {
    if (typeof item !== 'object' || item === null) return item;
    const variable = item as Record<string, unknown>;
    return 'value' in variable ? { ...variable, value: HIDDEN } : variable;
  });
}

/**
 * Trims a job trace to its last `lines` lines.
 *
 * A trace is regularly tens of megabytes, and the interesting part of a failed job is at the end.
 * Returning the whole thing by default would blow a terminal's scrollback and an agent's context
 * for a question that is almost always "why did it fail".
 */
export function tailLog(log: string, lines: number): { readonly text: string; readonly truncated: boolean } {
  if (!Number.isInteger(lines) || lines < 1) return { text: log, truncated: false };
  const all = log.split('\n');
  if (all.length <= lines) return { text: log, truncated: false };
  return { text: all.slice(-lines).join('\n'), truncated: true };
}
