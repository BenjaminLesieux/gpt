import { execFileSync, spawn } from 'node:child_process';
import * as path from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * git-http-backend is a CGI program shipped alongside git; there is no library
 * form of the smart-HTTP protocol to link against. Resolved once, because
 * `git --exec-path` is a process spawn and this runs on every fetch.
 */
let backendPath: string | undefined;

export function resolveHttpBackend(): string {
  if (backendPath) return backendPath;

  let execPath: string;
  try {
    execPath = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim();
  } catch {
    throw new Error(
      'git is not on PATH. The hub serves repositories through git-http-backend, ' +
        'which ships with git.'
    );
  }

  backendPath = path.join(execPath, 'git-http-backend');
  return backendPath;
}

export interface GitBackendRequest {
  /** Directory holding `<account>/<score>.git`. */
  projectRoot: string;
  /** Path below the mount point, e.g. `/acct/score.git/info/refs`. */
  pathInfo: string;
  /** Recorded by receive-pack as the pusher. */
  remoteUser: string;
}

/**
 * Hands the request to git and the reply straight back, without holding either
 * in memory: upload-pack and receive-pack are streams, and buffering a push
 * turns into a hang rather than an error.
 */
export function proxyToGit(
  request: FastifyRequest,
  reply: FastifyReply,
  options: GitBackendRequest
): void {
  const child = spawn(resolveHttpBackend(), [], {
    env: {
      GIT_PROJECT_ROOT: options.projectRoot,
      // The route above has already decided this token may see this
      // repository, so per-repo export marks would only be a second, weaker
      // copy of that decision.
      GIT_HTTP_EXPORT_ALL: '1',
      PATH_INFO: options.pathInfo,
      REQUEST_METHOD: request.method,
      QUERY_STRING: request.raw.url?.split('?')[1] ?? '',
      CONTENT_TYPE: request.headers['content-type'] ?? '',
      // git compresses upload-pack requests; http-backend inflates them only
      // if it is told they arrived compressed.
      CONTENT_ENCODING: request.headers['content-encoding'] ?? '',
      REMOTE_USER: options.remoteUser,
      REMOTE_ADDR: request.ip,
    },
  });

  reply.hijack();

  const body: unknown = request.body;
  if (isStream(body)) body.pipe(child.stdin);
  else child.stdin.end();

  pipeCgiResponse(child.stdout, reply);

  child.stderr.on('data', (chunk: Buffer) => {
    request.log.warn({ backend: chunk.toString().trimEnd() }, 'git-http-backend');
  });

  child.on('error', (error) => {
    request.log.error({ err: error }, 'git-http-backend failed to run');
    if (!reply.raw.headersSent) reply.raw.statusCode = 500;
    reply.raw.end();
  });
}

function isStream(value: unknown): value is NodeJS.ReadableStream {
  return typeof value === 'object' && value !== null && 'pipe' in value;
}

/**
 * CGI replies with its own headers, a blank line, then the body — and the
 * status arrives as a `Status:` header rather than a response line.
 */
function pipeCgiResponse(stdout: NodeJS.ReadableStream, reply: FastifyReply): void {
  let head = Buffer.alloc(0);
  let headSent = false;

  stdout.on('data', (chunk: Buffer) => {
    if (headSent) {
      reply.raw.write(chunk);
      return;
    }

    head = Buffer.concat([head, chunk]);
    const split = head.indexOf('\r\n\r\n');
    if (split === -1) return;

    for (const line of head.subarray(0, split).toString().split('\r\n')) {
      const status = /^Status: (\d{3})/.exec(line);
      if (status) {
        reply.raw.statusCode = Number(status[1]);
        continue;
      }
      const header = /^([^:]+): ?(.*)$/.exec(line);
      if (header) reply.raw.setHeader(header[1], header[2]);
    }

    reply.raw.write(head.subarray(split + 4));
    headSent = true;
  });

  stdout.on('end', () => reply.raw.end());
}
