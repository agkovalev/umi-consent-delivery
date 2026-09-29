# Agent instructions

Read `docs/INDEX.md`, `PROJECT.md`, `STATUS.md` and the relevant domain document before changes.
Use Git Flow: feature branches from develop, release branches into main and develop, hotfix branches from main. Preserve unrelated work. Do not push or tag without explicit authorization.

Run `pnpm check` and the PHP container tests before handoff. Keep direct dependencies exact and commit the lockfile. Update STATUS after each implementation stage and CHANGELOG for user-facing behavior.

Never commit `.local/`, credentials, private signing keys or imported release archives. Never print installation credentials during diagnostics. The running delivery service must not mount the offline signing key. Treat source release artifacts as immutable; do not edit the sibling library's dist.

Authorization must cover both manifests and files. Domain metadata, Origin and Referer are not authentication. The PHP client must verify the signature before trusting manifest paths, sizes or hashes, and may activate only a complete verified local release.
