#!/usr/bin/env node
'use strict';

const readline = require('node:readline');
const { execFileSync } = require('node:child_process');
const { auditRepoHygiene, parseWorktreesPorcelain, planReleaseTag } = require('../lib/audit.cjs');

const TOOLS = [
  {
    name: 'audit_repo_hygiene',
    description: 'Audit a local repository for README, LICENSE, .gitignore, CI workflows, manifest metadata, and accidental secret patterns.',
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

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function respondError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

function handleMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.method === 'initialize') {
    return respond(msg.id, {
      protocolVersion: '2024-11-05',
      serverInfo: { name: 'repo-release-guard', version: '1.0.0' },
      capabilities: { tools: {} }
    });
  }
  if (msg.method === 'notifications/initialized') return;
  if (msg.method === 'tools/list') {
    return respond(msg.id, { tools: TOOLS });
  }
  if (msg.method === 'tools/call') {
    const { name, arguments: args = {} } = msg.params || {};
    try {
      let payload;
      if (name === 'audit_repo_hygiene') {
        payload = auditRepoHygiene(args.repoPath);
      } else if (name === 'list_worktrees') {
        const out = execFileSync(process.env.GIT_BIN || 'git', ['-C', args.repoPath, 'worktree', 'list', '--porcelain'], {
          encoding: 'utf8'
        });
        payload = parseWorktreesPorcelain(out);
      } else if (name === 'plan_release_tag') {
        payload = planReleaseTag(args.repoPath, args.tag, process.env.GIT_BIN || 'git');
      } else {
        return respondError(msg.id, -32601, `Unknown tool: ${name}`);
      }
      return respond(msg.id, {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }]
      });
    } catch (err) {
      return respond(msg.id, {
        isError: true,
        content: [{ type: 'text', text: err.message }]
      });
    }
  }
  if (msg.id !== undefined) {
    respondError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

if (require.main === module) {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      handleMessage(JSON.parse(trimmed));
    } catch {}
  });
}

module.exports = { TOOLS, handleMessage };
