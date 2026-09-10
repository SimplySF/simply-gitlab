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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthError, HttpError } from '../src/errors.js';
import { HttpTransport, type TransportTarget } from '../src/http.js';
import { respondJson, startTestServer, type TestServer } from '../src/testing.js';

let server: TestServer;

beforeEach(async () => {
  server = await startTestServer();
});

afterEach(async () => {
  await server.close();
});

function transport(overrides: Partial<TransportTarget> = {}): HttpTransport {
  return new HttpTransport({ baseUrl: server.baseUrl, headers: {}, ...overrides });
}

describe('HttpTransport', () => {
  it('round-trips JSON and sends Accept/Content-Type headers', async () => {
    server.route('/echo', (req, res, body) => {
      respondJson(res, 200, {
        accept: req.headers.accept,
        contentType: req.headers['content-type'],
        received: body === '' ? undefined : (JSON.parse(body) as unknown),
      });
    });

    const result = await transport().json<{ accept: string; contentType: string; received: unknown }>({
      method: 'POST',
      path: '/echo',
      body: { hello: 'world' },
    });

    expect(result.accept).toBe('application/json');
    expect(result.contentType).toBe('application/json');
    expect(result.received).toEqual({ hello: 'world' });
  });

  it('repeats an array query parameter in the bracketed form GitLab reads', async () => {
    // A comma-joined value is taken as one literal scope and silently matches nothing.
    server.route('/jobs', (req, res) => {
      respondJson(res, 200, { url: req.url });
    });

    const result = await transport().json<{ url: string }>({
      method: 'GET',
      path: '/jobs',
      query: { scope: ['failed', 'running'], per_page: 20, skipped: undefined },
    });

    expect(result.url).toBe('/jobs?scope%5B%5D=failed&scope%5B%5D=running&per_page=20');
  });

  it('reads the pagination headers alongside the body', async () => {
    server.route('/list', (_req, res) => {
      res.writeHead(200, {
        'content-type': 'application/json',
        'x-next-page': '3',
        'x-total': '57',
        'x-total-pages': '3',
        'x-per-page': '20',
      });
      res.end(JSON.stringify([1, 2]));
    });

    const { data, pagination } = await transport().jsonPaged<number[]>({ method: 'GET', path: '/list' });

    expect(data).toEqual([1, 2]);
    expect(pagination).toStrictEqual({ nextPage: 3, total: 57, totalPages: 3, perPage: 20 });
  });

  it('treats an absent or unparseable pagination header as unknown, never as zero', async () => {
    server.route('/keyset', (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'x-next-page': '', 'x-total': 'lots' });
      res.end('[]');
    });

    const { pagination } = await transport().jsonPaged<number[]>({ method: 'GET', path: '/keyset' });

    expect(pagination.nextPage).toBeUndefined();
    expect(pagination.total).toBeUndefined();
  });

  it('returns a non-JSON body verbatim in text mode', async () => {
    server.route('/trace', (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('$ npm test\nfailed\n');
    });

    await expect(transport().text({ method: 'GET', path: '/trace' })).resolves.toBe('$ npm test\nfailed\n');
  });

  it('raises AuthError on 401 without retrying', async () => {
    server.route('/denied', (_req, res) => {
      respondJson(res, 401, { message: '401 Unauthorized' });
    });

    await expect(transport().json({ method: 'GET', path: '/denied' })).rejects.toBeInstanceOf(AuthError);
    expect(server.requests).toHaveLength(1);
  });

  it('names a likely scope problem on a 403, but only for a declared write', async () => {
    server.route('/forbidden', (_req, res) => {
      respondJson(res, 403, { message: '403 Forbidden' });
    });

    await expect(transport().json({ method: 'POST', path: '/forbidden', mutating: true })).rejects.toThrow(
      /read_api-scoped/,
    );
    await expect(transport().json({ method: 'GET', path: '/forbidden' })).rejects.toThrow(/Authentication failed/);
    const readError = await transport()
      .json({ method: 'GET', path: '/forbidden' })
      .catch((error: Error) => error.message);
    expect(readError).not.toMatch(/read_api-scoped/);
  });

  it('retries a 500 and gives up as HttpError', async () => {
    server.route('/flaky', (_req, res) => {
      respondJson(res, 500, { message: 'boom' });
    });

    await expect(
      new HttpTransport({ baseUrl: server.baseUrl, headers: {}, maxAttempts: 2 }).json({
        method: 'GET',
        path: '/flaky',
      }),
    ).rejects.toBeInstanceOf(HttpError);
    expect(server.requests).toHaveLength(2);
  });

  it('collapses a multi-line error body onto one line', async () => {
    // A newline here would forge extra stderr lines a caller parses line-by-line.
    server.route('/messy', (_req, res) => {
      res.writeHead(400, { 'content-type': 'text/plain' });
      res.end('first\nsecond');
    });

    await expect(transport().json({ method: 'GET', path: '/messy' })).rejects.toThrow(/first second/);
  });
});
