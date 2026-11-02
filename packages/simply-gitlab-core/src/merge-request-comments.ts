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

/**
 * What kind of note a merge request note is. GitLab returns all four from one endpoint, and most
 * of a busy merge request's notes are `system` ones ("added 3 commits") that nobody wrote.
 *
 * A `comment` is a plain top-level comment (`type: null`). A `thread` note sits in a discussion
 * that is not attached to the diff (`DiscussionNote`). A `code` note is on the diff — a line, a
 * range of lines, or a whole file (`DiffNote`); replies in a code thread are `DiffNote`s too, and
 * carry the same position. A `system` note is one GitLab wrote itself, whatever its `type`.
 */
export type CommentType = 'comment' | 'thread' | 'code' | 'system';

export function commentType(note: unknown): CommentType {
  if (typeof note !== 'object' || note === null) return 'comment';
  const { system, type } = note as { system?: unknown; type?: unknown };
  if (system === true) return 'system';
  if (type === 'DiffNote') return 'code';
  if (type === 'DiscussionNote') return 'thread';
  return 'comment';
}

/**
 * Where on the diff a code comment sits, as `path:line`, or `undefined` for a note that is not on
 * the diff.
 *
 * A comment on an added or unchanged line has a `new_line`; one on a removed line has only an
 * `old_line`, and is located in the old file, because that is the only place the line exists. A
 * comment on a range reports the line it was anchored to, which is the last line of the range —
 * `position.line_range` in the payload has both ends. A comment on a whole file has no line.
 */
export function commentLocation(note: unknown): string | undefined {
  if (typeof note !== 'object' || note === null) return undefined;
  const position = (note as { position?: unknown }).position;
  if (typeof position !== 'object' || position === null) return undefined;

  const at = position as Record<string, unknown>;
  const newPath = typeof at.new_path === 'string' ? at.new_path : undefined;
  const oldPath = typeof at.old_path === 'string' ? at.old_path : undefined;
  if (typeof at.new_line === 'number' && newPath !== undefined) return `${newPath}:${at.new_line}`;
  if (typeof at.old_line === 'number' && oldPath !== undefined) return `${oldPath}:${at.old_line}`;
  return newPath ?? oldPath;
}

/** Whether a comment is one that "include system" and "code only" selected. */
export function keepComment(note: unknown, options: { includeSystem?: boolean; codeOnly?: boolean }): boolean {
  const type = commentType(note);
  if (options.codeOnly === true) return type === 'code';
  return options.includeSystem === true || type !== 'system';
}
