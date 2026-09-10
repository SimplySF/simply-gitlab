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

import { Buffer } from 'node:buffer';
import { ConfigError } from './errors.js';
import { readTextFile } from './json-input.js';
import type { WriteFileInput } from './gitlab-client.js';

/** The envelope GitLab answers a file read with; `content` is base64 unless it says otherwise. */
export interface FilePayload {
  readonly file_name?: string;
  readonly file_path?: string;
  readonly size?: number;
  readonly encoding?: string;
  readonly content?: string;
  readonly ref?: string;
  readonly blob_id?: string;
  readonly commit_id?: string;
  readonly last_commit_id?: string;
}

/** A decoded file, and whether decoding produced something a terminal can show. */
export interface DecodedFile {
  readonly text: string;
  readonly bytes: number;
  /**
   * False when the file is binary. A caller then has the bytes but must not print them: a PNG
   * written to a terminal emits escape sequences, and written to an agent's context it is noise
   * that can carry an instruction.
   */
  readonly printable: boolean;
}

/** A NUL byte does not occur in valid UTF-8 text, and is the cheapest binary tell there is. */
function looksBinary(text: string): boolean {
  return text.includes('\u0000');
}

/**
 * Decodes the base64 body of a file read.
 *
 * GitLab has answered with `encoding: "text"` on some self-managed versions, so the encoding is
 * honoured rather than assumed — decoding plain text as base64 yields silent garbage, which is
 * exactly the failure a user cannot diagnose from the output.
 */
export function decodeFileContent(payload: FilePayload): DecodedFile {
  const content = payload.content;
  if (typeof content !== 'string') {
    throw new ConfigError('The response carried no file content. Check the ref and the file path.');
  }

  const buffer = payload.encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8');
  const text = buffer.toString('utf8');
  return { text, bytes: buffer.byteLength, printable: !looksBinary(text) };
}

export interface FileWriteInput {
  readonly branch?: string;
  readonly content?: string;
  readonly contentFile?: string;
  readonly message?: string;
  readonly authorEmail?: string;
  readonly authorName?: string;
  readonly startBranch?: string;
  readonly lastCommitId?: string;
}

/**
 * Turns the flags (or tool inputs) of a file write into the client's input.
 *
 * Content comes from either a literal or a file, never both, and the branch and commit message
 * are required by GitLab — checked here so the refusal names the missing flag instead of arriving
 * as a 400 whose body says `branch is missing`.
 */
export function buildFileWrite(input: FileWriteInput): WriteFileInput {
  if (input.content !== undefined && input.contentFile !== undefined) {
    throw new ConfigError('Pass --content or --content-file, not both.');
  }

  const content =
    input.content ?? (input.contentFile === undefined ? undefined : readTextFile(input.contentFile, 'Content file'));
  if (content === undefined) {
    throw new ConfigError('File content is required: pass --content or --content-file.');
  }
  if (input.branch === undefined || input.branch === '') {
    throw new ConfigError('A branch is required: pass --branch.');
  }
  if (input.message === undefined || input.message === '') {
    throw new ConfigError('A commit message is required: pass --message.');
  }

  return {
    branch: input.branch,
    content,
    commitMessage: input.message,
    authorEmail: input.authorEmail,
    authorName: input.authorName,
    startBranch: input.startBranch,
    lastCommitId: input.lastCommitId,
  };
}
