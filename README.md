# repo-release-guard

[![CI](https://github.com/deusbr/repo-release-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/deusbr/repo-release-guard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18.0.0-339933?logo=node.js&logoColor=white)](package.json)

Portable AI Skill (`SKILL.md`) and zero-dependency `stdio` **Model Context Protocol (MCP)** server for pre-release repository hygiene audits, `git worktree` inspection, and SemVer readiness checks.

## Tools Exposed

- `audit_repo_hygiene`: Verifies `README.md`, `LICENSE`, `.gitignore`, `.github/workflows/*.yml`, manifest metadata, and scans for accidental credential patterns without echoing secrets.
- `list_worktrees`: Parses `git worktree list --porcelain` into structured JSON for multi-agent isolation.
- `plan_release_tag`: Confirms SemVer tag alignment with `package.json` and working-tree cleanliness before tagging.

## Quick Start

```bash
node bin/mcp-server.cjs
```

Or install via [`mcp-client-installer`](https://github.com/deusbr/mcp-client-installer) for Claude Code / Claude Desktop / Cursor.

## License

MIT — see [`LICENSE`](LICENSE).
