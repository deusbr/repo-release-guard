'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const { auditRepoHygiene, parseWorktreesPorcelain, planReleaseTag } = require('../index.cjs');

test('auditRepoHygiene detects missing files and flags leaked secret patterns without echoing secrets', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-guard-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'README.md'), '# Demo');
    fs.writeFileSync(path.join(dir, '.env.example'), 'TOKEN=' + 'ghp_' + '1234567890abcdefghij');

    const res = auditRepoHygiene(dir);
    assert.equal(res.ready, false);
    assert.ok(res.missing.includes('license'));
    assert.ok(res.missing.includes('ciWorkflows'));
    assert.deepEqual(res.secretFindings, [{ file: '.env.example', rule: 'github-pat' }]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('parseWorktreesPorcelain parses multiple worktree entries', () => {
  const sample = [
    'worktree /repo/main',
    'HEAD abc123',
    'branch refs/heads/main',
    '',
    'worktree /repo/feat-x',
    'HEAD def456',
    'branch refs/heads/feat/x',
    ''
  ].join('\n');

  const parsed = parseWorktreesPorcelain(sample);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[1].branch, 'refs/heads/feat/x');
});

test('planReleaseTag validates SemVer format and package.json alignment', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-guard-tag-'));
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '1.2.0' }));
    const invalid = planReleaseTag(dir, '1.2.0');
    assert.equal(invalid.ok, false);

    const mismatch = planReleaseTag(dir, 'v1.3.0');
    assert.equal(mismatch.versionMatches, false);
    assert.equal(mismatch.ok, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('stdio MCP server serves initialize, tools/list, and audit_repo_hygiene', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-guard-mcp-'));
  try {
    fs.writeFileSync(path.join(dir, 'README.md'), '# Clean');
    fs.writeFileSync(path.join(dir, 'LICENSE'), 'MIT');
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'clean', version: '1.0.0', scripts: { test: 'node --test' } }));
    fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.github', 'workflows', 'ci.yml'), 'name: CI\n');

    const child = spawn(process.execPath, [path.resolve(__dirname, '../bin/mcp-server.cjs')], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const responses = [];
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('MCP server test timeout')), 3000);
      let buf = '';
      child.stdout.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() || '';
        for (const l of lines) {
          if (!l.trim()) continue;
          responses.push(JSON.parse(l));
          if (responses.length === 3) {
            clearTimeout(timer);
            resolve();
          }
        }
      });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
      child.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'audit_repo_hygiene', arguments: { repoPath: dir } }
        }) + '\n'
      );
    });

    child.kill();
    assert.equal(responses[0].result.serverInfo.name, 'repo-release-guard');
    assert.equal(responses[1].result.tools.length, 3);
    const auditResult = JSON.parse(responses[2].result.content[0].text);
    assert.equal(auditResult.ready, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
