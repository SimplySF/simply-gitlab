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

import process from 'node:process';
import { Command, Flags, type Interfaces } from '@oclif/core';
import {
  assertWritesAllowed,
  AuthError,
  CliError,
  collectSecrets,
  type ConfigOverrides,
  GitLabClient,
  type GitLabConfig,
  HttpError,
  loadEnvFile,
  redactSecrets,
  resolveGitLabConfig,
  sanitiseDeep,
  SECRET_ENV,
  stripControl,
} from '@simplysf/simply-gitlab-core';

/**
 * Splits a comma-separated flag value, dropping blanks. `--labels ''` and `--labels 'a,'` would
 * otherwise yield an empty label, which GitLab stores as one.
 */
export function parseList(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  return items.length === 0 ? undefined : items;
}

/** Credential flags, used both to declare them and to scrub their values out of any output. */
const SECRET_FLAGS = new Set(['gitlab-token']);

/**
 * Every credential that could otherwise ride along in an error message. Values are collected
 * from the process arguments and environment rather than parsed flags, because the errors most
 * likely to echo an argument are the ones thrown before parsing finishes. The redaction itself
 * is the core package's, shared with the MCP server; only the argv half is this CLI's.
 */
function secrets(): Set<string> {
  const values: Array<string | undefined> = [];
  const argv = process.argv;
  for (const [index, arg] of argv.entries()) {
    if (arg.startsWith('--') && SECRET_FLAGS.has(arg.slice(2))) values.push(argv[index + 1]);
    const inline = /^--([a-z-]+)=(.+)$/.exec(arg);
    if (inline?.[1] !== undefined && SECRET_FLAGS.has(inline[1])) values.push(inline[2]);
  }
  for (const name of SECRET_ENV) values.push(process.env[name]);
  return collectSecrets(values);
}

/** Names the failure for a machine reader: our own errors keep their class name. */
function errorName(error: unknown, oclifExit: number | undefined): string {
  if (error instanceof CliError) return error.name;
  return oclifExit === undefined ? 'Error' : 'UsageError';
}

/**
 * Flags every write command shares, defined once so the wording cannot drift between them.
 *
 * There is no `--confirm` here, because no command in this CLI destroys anything yet — every
 * write either creates something or edits a merge request, and both are recoverable. Requiring
 * a confirmation for those would train a caller to pass it always, at which point it protects
 * nothing while still implying that it does. The first command that deletes a branch, a tag, or
 * a file is the one that brings the flag back.
 */
export const writeFlags = {
  'dry-run': Flags.boolean({
    summary: 'Print the request that would be sent and exit without sending it.',
    default: false,
  }),
};

/** The project selector, on every command that is scoped to one. */
export const projectFlag = {
  project: Flags.string({
    char: 'p',
    summary: 'Project id, or its full path such as group/subgroup/project.',
    required: true,
    env: 'GITLAB_PROJECT',
  }),
};

/** The paging ceiling, worded once so every list command reads the same. */
export function limitFlag(fallback: number, what: string): { limit: Interfaces.OptionFlag<number> } {
  return {
    limit: Flags.integer({
      summary: `Maximum number of ${what} to return across all pages.`,
      default: fallback,
      min: 1,
    }),
  };
}

const envFileFlag = {
  'env-file': Flags.string({
    char: 'e',
    summary: 'Path to a .env file holding connection settings.',
    description:
      'Loaded before anything else. Variables already present in the environment win, so the ' +
      'file never overrides an explicit export, and only GitLab connection variables are read ' +
      'from it. A path that cannot be read is an error.',
    helpGroup: 'CONNECTION',
  }),
};

const gitlabFlags = {
  ...envFileFlag,
  'gitlab-url': Flags.string({
    summary: 'Base URL of the GitLab instance. Defaults to https://gitlab.com.',
    env: 'GITLAB_URL',
    helpGroup: 'CONNECTION',
  }),
  'gitlab-token': Flags.string({
    summary: 'Personal, project, or group access token.',
    env: 'GITLAB_TOKEN',
    helpGroup: 'CONNECTION',
  }),
};

export type GitLabFlags<T extends typeof Command> = Interfaces.InferredFlags<typeof gitlabFlags & T['flags']>;
export type CommandArgs<T extends typeof Command> = Interfaces.InferredArgs<T['args']>;

/**
 * Everything every command shares: `--json` (oclif prints whatever `run()` returns, verbatim),
 * the `--gitlab-*` connection flags, `--env-file` loading, and turning failures into stable exit
 * codes without letting anything reach stdout.
 *
 * GitLab is one product with one API, so unlike the Atlassian CLI this repo is modelled on there
 * is no second base class per product — the connection flags live here directly.
 */
export abstract class GitLabCommand<T extends typeof Command> extends Command {
  public static override enableJsonFlag = true;
  public static override baseFlags = gitlabFlags;

  /**
   * Set by any command that changes data. The read-only guard is then enforced centrally in
   * `init()`, so a future write command cannot forget to call it — which is exactly the kind
   * of omission that would go unnoticed until it mattered.
   */
  public static isWrite = false;

  protected args!: CommandArgs<T>;
  protected rawFlags: Record<string, unknown> = {};

  protected get flags(): GitLabFlags<T> {
    return this.rawFlags as GitLabFlags<T>;
  }

  public override async init(): Promise<void> {
    await super.init();
    const { args, flags } = await this.parse({
      baseFlags: (this.constructor as typeof GitLabCommand).baseFlags,
      flags: this.ctor.flags,
      enableJsonFlag: this.ctor.enableJsonFlag,
      args: this.ctor.args,
      strict: this.ctor.strict,
    });
    this.args = args as CommandArgs<T>;
    this.rawFlags = flags;

    // Applied here, before anything reads configuration, so every later lookup sees the file.
    const envFile = this.rawFlags['env-file'];
    if (typeof envFile === 'string') loadEnvFile(envFile);

    // After the env file, so a read-only guard carried in a credential file is honoured, and
    // before run(), so no write command can issue a request first.
    if ((this.constructor as typeof GitLabCommand).isWrite) assertWritesAllowed();
  }

  protected gitlab(): GitLabClient {
    return new GitLabClient(this.gitlabConfig());
  }

  /** Explicit flags outrank the environment, which outranks the `--env-file` contents. */
  protected gitlabConfig(): GitLabConfig {
    const overrides: ConfigOverrides = {
      url: this.flagValue('gitlab-url'),
      token: this.flagValue('gitlab-token'),
    };
    return resolveGitLabConfig(overrides);
  }

  /**
   * Turns any failure into one compact, machine-readable line on stderr plus a stable exit
   * code, and never lets a failure reach stdout.
   *
   * This has to cover *every* error, not just this CLI's own: oclif's default `--json` error
   * path serializes its whole parse context — including the raw argv, and therefore any token
   * passed as a flag — to stdout. For a caller that captures stdout into an AI agent's
   * context, that is a credential disclosure, so the default path is never taken here.
   *
   * Exit codes stay identical with and without `--json`: 2 config or usage, 3 auth, 1
   * everything else.
   */
  protected override async catch(error: Interfaces.CommandError): Promise<unknown> {
    // oclif attaches its own exit code to usage errors; reuse it so --json and plain runs agree.
    const oclifExit = (error as { oclif?: { exit?: number } }).oclif?.exit;
    const exitCode = error instanceof CliError ? error.exitCode : (oclifExit ?? 1);
    // Error text can quote a server response body, which is as attacker-influenced as any other
    // field the instance returns. Control-stripped but NOT collapsed to one line: newlines here
    // are this CLI's own. Server-supplied text is made single-line where it is interpolated
    // instead — see `formatSnippet` in core/http.ts.
    const redact = secrets();
    const message = stripControl(redactSecrets(error.message, redact));

    if (this.jsonEnabled()) {
      // Written straight to the stream: oclif silences this.log/logToStderr under --json.
      process.stderr.write(
        `${JSON.stringify({
          error: {
            name: errorName(error, oclifExit),
            message,
            exitCode,
            ...(error instanceof HttpError ? { status: error.status, body: sanitiseDeep(error.body, redact) } : {}),
            ...(error instanceof AuthError ? { status: error.status } : {}),
          },
        })}\n`,
      );
      this.exit(exitCode);
    }

    if (error instanceof CliError) {
      this.error(message, { exit: exitCode, code: error.name });
    }
    // An unexpected error — a TypeError from a malformed payload, say — would otherwise reach
    // oclif's default handler carrying the original, unsanitised and unredacted text. Rethrow
    // the sanitised message instead, preserving the exit code oclif attached.
    const sanitised = new Error(message);
    Object.assign(sanitised, { oclif: { exit: exitCode } });
    return super.catch(sanitised);
  }

  /**
   * Logs a line that contains server-supplied text. Everything the instance chose is stripped of
   * control characters first — the same treatment error output gets, and for the same reason:
   * this stream is parsed by an agent, and a bare escape sequence can make what a person sees
   * differ from what the agent ingests.
   *
   * Repository file contents and job traces come through here too. Those are the widest input of
   * all: anyone who can open a merge request controls them.
   */
  protected logSafe(message: string): void {
    // Redacted as well as stripped. `--body-file` reads any readable path and `--dry-run` prints
    // what would be sent, so a caller who points it at a `.env` by mistake would otherwise put a
    // live token on stdout — and, without --dry-run, into a commit other people fetch.
    this.log(stripControl(redactSecrets(message, secrets())));
  }

  /** Renders a list result and says plainly whether the limit cut it short. */
  protected reportList(count: number, total: number | undefined, complete: boolean, limit: number, what: string): void {
    const scope = total === undefined ? '' : ` of ${total}`;
    const note = complete ? '' : ` (limit ${limit} reached; more available)`;
    this.log(`\nShowing ${count}${scope} ${what}${note}.`);
  }

  /** Narrowed accessor so subclasses read flags without casting at every use. */
  protected flagValue(name: string): string | undefined {
    const value = this.rawFlags[name];
    return typeof value === 'string' ? value : undefined;
  }
}
