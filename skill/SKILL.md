---
name: repo-release-guard
description: Audit repository release readiness (README, LICENSE, .gitignore, CI, accidental secrets), inspect git worktrees, and verify SemVer tag alignment before pushing or publishing a release.
---

# Repo Release Guard Skill

Use this skill before tagging a GitHub release, publishing a package, or spawning parallel agent tasks in `git worktree` checkouts.

## Checklist

1. Run `audit_repo_hygiene` on the target repository path and resolve any missing baseline files (`README.md`, `LICENSE`, `.gitignore`, `.github/workflows/*.yml`).
2. Confirm `secretFindings` is empty before staging or pushing commits.
3. Inspect parallel checkouts with `list_worktrees` so concurrent branches never collide on the same working tree.
4. Run `plan_release_tag` with the intended `vX.Y.Z` tag to verify `package.json` version alignment and a clean working tree before tagging.
