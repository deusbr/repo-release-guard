#!/usr/bin/env node
'use strict';

const pkg = require('../package.json');
const { auditRepoHygiene, listWorktrees, planReleaseTag } = require('../lib/audit.cjs');

function printHelp() {
  console.log(
    [
      'Usage: repo-release-guard <command> [options]',
      '',
      'Commands:',
      '  audit [path] [--json]               Audit baseline files, manifest metadata, .env & secret patterns',
      '  worktrees [path] [--json]           List active git worktrees via porcelain parser',
      '  plan-tag <path> <tag> [--json]      Verify SemVer tag alignment and clean working tree',
      '  mcp                                 Start the stdio JSON-RPC 2.0 MCP server',
      '',
      'Options:',
      '  --json                              Emit machine-readable JSON output',
      '  --git <path>                        Custom git executable path (default: GIT_BIN or "git")',
      '  -v, --version                       Show version',
      '  -h, --help                          Show this help'
    ].join('\n')
  );
}

function parseArgs(argv) {
  const positionals = [];
  let json = false;
  let help = false;
  let version = false;
  let gitBin = process.env.GIT_BIN || 'git';

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') json = true;
    else if (a === '-h' || a === '--help') help = true;
    else if (a === '-v' || a === '--version') version = true;
    else if (a === '--git' && argv[i + 1]) gitBin = argv[++i];
    else positionals.push(a);
  }

  return { positionals, json, help, version, gitBin };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const [cmd, ...rest] = opts.positionals;

  if (opts.version) {
    console.log(pkg.version);
    return;
  }
  if (opts.help || !cmd || cmd === 'help') {
    printHelp();
    return;
  }

  if (cmd === 'mcp') {
    require('./mcp-server.cjs');
    return;
  }

  if (cmd === 'audit') {
    const target = rest[0] || '.';
    const result = auditRepoHygiene(target);
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Repo: ${result.repoPath}`);
      console.log(`Ready: ${result.ready ? 'YES' : 'NO'}`);
      console.log(`Missing: ${result.missing.length ? result.missing.join(', ') : 'none'}`);
      console.log(
        `Secrets: ${
          result.secretFindings.length
            ? result.secretFindings.map((f) => `${f.file} (${f.rule})`).join(', ')
            : 'none'
        }`
      );
    }
    if (!result.ready) process.exitCode = 1;
    return;
  }

  if (cmd === 'worktrees') {
    const target = rest[0] || '.';
    const result = listWorktrees(target, opts.gitBin);
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      for (const wt of result) {
        console.log(`${wt.path} | ${wt.branch || (wt.detached ? 'detached' : 'bare')} | ${wt.head || ''}`);
      }
    }
    return;
  }

  if (cmd === 'plan-tag') {
    const [target, tag] = rest;
    if (!target || !tag) {
      console.error('Usage: repo-release-guard plan-tag <path> <tag> [--json]');
      process.exitCode = 1;
      return;
    }
    const result = planReleaseTag(target, tag, opts.gitBin);
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Tag: ${result.tag || tag} | OK: ${result.ok ? 'YES' : 'NO'}`);
      if (result.error) console.log(`Error: ${result.error}`);
      if (result.gitError) console.log(`Git error: ${result.gitError}`);
    }
    if (!result.ok) process.exitCode = 1;
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  printHelp();
  process.exitCode = 1;
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
