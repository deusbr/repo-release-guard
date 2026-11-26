'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFileSync } = require('node:child_process');

const pkg = require('../package.json');
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

test('auditRepoHygiene detects committed .env files and expanded provider token patterns', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-guard-secrets-'));
  try {
    fs.writeFileSync(path.join(dir, 'README.md'), '# Demo');
    fs.writeFileSync(path.join(dir, 'LICENSE'), 'MIT');
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }));
    fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.github', 'workflows', 'ci.yml'), 'name: CI\n');

    fs.writeFileSync(path.join(dir, '.env'), 'PORT=3000\n');
    fs.writeFileSync(
      path.join(dir, 'leaks.txt'),
      [
        'gho_' + '1234567890abcdefghij',
        'sk-ant-' + 'abcdefghijklmnopqrstuvwx',
        'AIza' + 'SyDummyKeyValue12345678901234567890',
        'hf_' + 'AbCdEfGhIjKlMnOpQrStUv',
        'npm_' + 'AbCdEfGhIjKlMnOpQrStUv',
        'xoxb-' + '1234567890-abcdef'
      ].join('\n')
    );

    const res = auditRepoHygiene(dir);
    assert.equal(res.ready, false);
    assert.deepEqual(res.secretFindings, [
      { file: '.env', rule: 'committed-env-file' },
      { file: 'leaks.txt', rule: 'github-token' },
      { file: 'leaks.txt', rule: 'anthropic-key' },
      { file: 'leaks.txt', rule: 'google-api-key' },
      { file: 'leaks.txt', rule: 'huggingface-token' },
      { file: 'leaks.txt', rule: 'npm-token' },
      { file: 'leaks.txt', rule: 'slack-token' }
    ]);
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

test('CLI executes --version, audit --json, and sets non-zero exit when repo is not ready', () => {
  const cli = path.resolve(__dirname, '../bin/repo-release-guard.cjs');
  const versionOut = execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).trim();
  assert.equal(versionOut, pkg.version);

  const cleanOut = execFileSync(process.execPath, [cli, 'audit', path.resolve(__dirname, '..'), '--json'], {
    encoding: 'utf8'
  });
  assert.equal(JSON.parse(cleanOut).ready, true);

  const dirtyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-guard-cli-'));
  try {
    fs.writeFileSync(path.join(dirtyDir, 'README.md'), '# Incomplete');
    assert.throws(
      () => execFileSync(process.execPath, [cli, 'audit', dirtyDir, '--json'], { stdio: ['pipe', 'pipe', 'pipe'] }),
      (err) => err.status === 1 && JSON.parse(err.stdout.toString('utf8')).ready === false
    );
  } finally {
    fs.rmSync(dirtyDir, { recursive: true, force: true });
  }
});

test('stdio MCP server serves initialize, tools/list, ping, and audit_repo_hygiene', async () => {
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
          if (responses.length === 4) {
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
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'ping' }) + '\n');
    });

    child.kill();
    assert.equal(responses[0].result.serverInfo.name, 'repo-release-guard');
    assert.equal(responses[0].result.serverInfo.version, pkg.version);
    assert.equal(responses[1].result.tools.length, 3);
    const auditResult = JSON.parse(responses[2].result.content[0].text);
    assert.equal(auditResult.ready, true);
    assert.deepEqual(responses[3].result, {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('stdio MCP server supports Content-Length framing and reports -32700 on invalid JSON', async () => {
  const child = spawn(process.execPath, [path.resolve(__dirname, '../bin/mcp-server.cjs')], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const payload = JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'initialize', params: {} });
  const framed = `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`;

  const output = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Content-Length timeout')), 3000);
    let raw = Buffer.alloc(0);
    let sentBadJson = false;
    child.stdout.on('data', (chunk) => {
      raw = Buffer.concat([raw, chunk]);
      const str = raw.toString('utf8');
      if (!sentBadJson && str.includes('"id":10')) {
        sentBadJson = true;
        child.stdin.write('{not-json\n');
      } else if (sentBadJson && str.includes('-32700')) {
        clearTimeout(timer);
        resolve(str);
      }
    });
    child.stdin.write(framed);
  });

  child.kill();
  assert.match(output, /Content-Length:\s*\d+/i);
  assert.match(output, new RegExp(`"version":"${pkg.version.replace(/\./g, '\\.')}"`));
  assert.match(output, /"-32700"|code":-32700/);
});
