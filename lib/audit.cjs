'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next']);
const SECRET_CHECKS = [
  { id: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: 'github-pat', re: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{16,}/ },
  { id: 'openai-key', re: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { id: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/ }
];

function walkFiles(rootDir, currentDir = rootDir, acc = []) {
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(currentDir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      walkFiles(rootDir, full, acc);
    } else if (entry.isFile()) {
      acc.push(path.relative(rootDir, full));
    }
  }
  return acc;
}

function auditRepoHygiene(repoPath) {
  const abs = path.resolve(repoPath);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    throw new Error(`Repository directory does not exist: ${abs}`);
  }

  const hasFile = (rel) => fs.existsSync(path.join(abs, rel));
  const hasWorkflows =
    hasFile('.github/workflows') &&
    fs.readdirSync(path.join(abs, '.github/workflows')).some((f) => /\.ya?ml$/i.test(f));

  const checks = {
    readme: hasFile('README.md'),
    license: hasFile('LICENSE') || hasFile('LICENSE.md'),
    gitignore: hasFile('.gitignore'),
    ciWorkflows: hasWorkflows,
    manifest: hasFile('package.json') || hasFile('pyproject.toml')
  };

  let packageMeta = null;
  if (hasFile('package.json')) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(abs, 'package.json'), 'utf8'));
      packageMeta = {
        name: pkg.name || null,
        version: pkg.version || null,
        license: pkg.license || null,
        hasTestScript: Boolean(pkg.scripts && pkg.scripts.test)
      };
    } catch {
      packageMeta = { invalidJson: true };
    }
  }

  const secretFindings = [];
  for (const rel of walkFiles(abs)) {
    const full = path.join(abs, rel);
    const st = fs.statSync(full);
    if (st.size > 512 * 1024) continue;
    let content;
    try {
      content = fs.readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    for (const check of SECRET_CHECKS) {
      if (check.re.test(content)) {
        secretFindings.push({ file: rel, rule: check.id });
      }
    }
  }

  const missing = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

  return {
    repoPath: abs,
    ready: missing.length === 0 && secretFindings.length === 0,
    checks,
    missing,
    packageMeta,
    secretFindings
  };
}

function parseWorktreesPorcelain(output) {
  const blocks = String(output || '')
    .trim()
    .split(/\r?\n\r?\n/)
    .filter(Boolean);

  return blocks.map((block) => {
    const item = { bare: false, detached: false };
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) item.path = line.slice(9).trim();
      else if (line.startsWith('HEAD ')) item.head = line.slice(5).trim();
      else if (line.startsWith('branch ')) item.branch = line.slice(7).trim();
      else if (line === 'bare') item.bare = true;
      else if (line === 'detached') item.detached = true;
    }
    return item;
  });
}

function planReleaseTag(repoPath, tag, gitBin = 'git') {
  const abs = path.resolve(repoPath);
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(tag || ''))) {
    return { ok: false, error: 'Tag must follow SemVer vX.Y.Z format.' };
  }

  let pkgVersion = null;
  const pkgPath = path.join(abs, 'package.json');
  if (fs.existsSync(pkgPath)) {
    pkgVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || null;
  }

  let dirtyFiles = [];
  let gitError = null;
  try {
    const statusOut = execFileSync(gitBin, ['-C', abs, 'status', '--porcelain'], { encoding: 'utf8' });
    dirtyFiles = statusOut
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter(Boolean);
  } catch (err) {
    gitError = err.message;
  }

  const versionMatches = pkgVersion ? `v${pkgVersion}` === tag : true;
  return {
    ok: !gitError && dirtyFiles.length === 0 && versionMatches,
    tag,
    packageVersion: pkgVersion,
    versionMatches,
    cleanWorkingTree: dirtyFiles.length === 0,
    dirtyCount: dirtyFiles.length,
    gitError
  };
}

module.exports = {
  auditRepoHygiene,
  parseWorktreesPorcelain,
  planReleaseTag
};
