#!/usr/bin/env node
'use strict';

const pkg = require('../package.json');
const { auditRepoHygiene, listWorktrees, planReleaseTag } = require('../lib/audit.cjs');

const TOOLS = [
  {
    name: 'audit_repo_hygiene',
    description: 'Audit a local repository for README, LICENSE, .gitignore, CI workflows, manifest metadata, committed .env files, and accidental secret patterns.',
    inputSchema: {
      type: 'object',
      required: ['repoPath'],
      properties: { repoPath: { type: 'string' } },
      additionalProperties: false
    }
  },
  {
    name: 'list_worktrees',
    description: 'List active git worktrees for a local repository.',
    inputSchema: {
      type: 'object',
      required: ['repoPath'],
      properties: { repoPath: { type: 'string' } },
      additionalProperties: false
    }
  },
  {
    name: 'plan_release_tag',
    description: 'Verify SemVer tag alignment with package.json and working tree cleanliness before tagging a release.',
    inputSchema: {
      type: 'object',
      required: ['repoPath', 'tag'],
      properties: {
        repoPath: { type: 'string' },
        tag: { type: 'string' }
      },
      additionalProperties: false
    }
  }
];

function writeMessage(payload, framing = 'ndjson') {
  const json = JSON.stringify(payload);
  if (framing === 'content-length') {
    const len = Buffer.byteLength(json, 'utf8');
    process.stdout.write(`Content-Length: ${len}\r\n\r\n${json}`);
    return;
  }
  process.stdout.write(json + '\n');
}

function respond(id, result, framing = 'ndjson') {
  writeMessage({ jsonrpc: '2.0', id, result }, framing);
}

function respondError(id, code, message, framing = 'ndjson') {
  writeMessage({ jsonrpc: '2.0', id, error: { code, message } }, framing);
}

function drainJsonRpcFrames(buf) {
  const frames = [];
  let cursor = 0;

  while (cursor < buf.length) {
    while (cursor < buf.length && (buf[cursor] === 13 || buf[cursor] === 10 || buf[cursor] === 32 || buf[cursor] === 9)) {
      cursor += 1;
    }
    if (cursor >= buf.length) break;

    const slice = buf.subarray(cursor);
    if (slice.subarray(0, 15).toString('ascii').toLowerCase() === 'content-length:') {
      const headerEndCrlf = slice.indexOf('\r\n\r\n');
      const headerEndLf = slice.indexOf('\n\n');
      let headerEnd = -1;
      let sepLen = 0;
      if (headerEndCrlf !== -1 && (headerEndLf === -1 || headerEndCrlf < headerEndLf)) {
        headerEnd = headerEndCrlf;
        sepLen = 4;
      } else if (headerEndLf !== -1) {
        headerEnd = headerEndLf;
        sepLen = 2;
      }
      if (headerEnd === -1) break;

      const headerStr = slice.subarray(0, headerEnd).toString('ascii');
      const lenMatch = headerStr.match(/content-length:\s*(\d+)/i);
      if (!lenMatch) {
        cursor += headerEnd + sepLen;
        frames.push({ framing: 'content-length', error: 'Invalid Content-Length header' });
        continue;
      }
      const bodyLen = Number(lenMatch[1]);
      const bodyStart = headerEnd + sepLen;
      if (slice.length < bodyStart + bodyLen) break;

      const bodyStr = slice.subarray(bodyStart, bodyStart + bodyLen).toString('utf8').trim();
      cursor += bodyStart + bodyLen;
      try {
        frames.push({ framing: 'content-length', message: JSON.parse(bodyStr) });
      } catch (err) {
        frames.push({ framing: 'content-length', error: err.message });
      }
      continue;
    }

    const nlIdx = slice.indexOf(10);
    if (nlIdx === -1) break;
    const line = slice.subarray(0, nlIdx).toString('utf8').trim();
    cursor += nlIdx + 1;
    if (!line) continue;
    try {
      frames.push({ framing: 'ndjson', message: JSON.parse(line) });
    } catch (err) {
      frames.push({ framing: 'ndjson', error: err.message });
    }
  }

  return { frames, rest: buf.subarray(cursor) };
}

function handleMessage(msg, framing = 'ndjson') {
  if (!msg || typeof msg !== 'object') return;
  if (msg.method === 'initialize') {
    return respond(
      msg.id,
      {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'repo-release-guard', version: pkg.version },
        capabilities: { tools: {} }
      },
      framing
    );
  }
  if (msg.method === 'notifications/initialized') return;
  if (msg.method === 'ping') {
    return respond(msg.id, {}, framing);
  }
  if (msg.method === 'tools/list') {
    return respond(msg.id, { tools: TOOLS }, framing);
  }
  if (msg.method === 'tools/call') {
    const { name, arguments: args = {} } = msg.params || {};
    try {
      let payload;
      if (name === 'audit_repo_hygiene') {
        payload = auditRepoHygiene(args.repoPath);
      } else if (name === 'list_worktrees') {
        payload = listWorktrees(args.repoPath, process.env.GIT_BIN || 'git');
      } else if (name === 'plan_release_tag') {
        payload = planReleaseTag(args.repoPath, args.tag, process.env.GIT_BIN || 'git');
      } else {
        return respondError(msg.id, -32601, `Unknown tool: ${name}`, framing);
      }
      return respond(
        msg.id,
        {
          content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }]
        },
        framing
      );
    } catch (err) {
      return respond(
        msg.id,
        {
          isError: true,
          content: [{ type: 'text', text: err.message }]
        },
        framing
      );
    }
  }
  if (msg.id !== undefined) {
    respondError(msg.id, -32601, `Method not found: ${msg.method}`, framing);
  }
}

if (require.main === module) {
  let buffer = Buffer.alloc(0);
  process.stdin.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    const { frames, rest } = drainJsonRpcFrames(buffer);
    buffer = rest;
    for (const frame of frames) {
      if (frame.error) {
        respondError(null, -32700, `Parse error: ${frame.error}`, frame.framing);
      } else {
        handleMessage(frame.message, frame.framing);
      }
    }
  });
}

module.exports = { TOOLS, drainJsonRpcFrames, handleMessage };
