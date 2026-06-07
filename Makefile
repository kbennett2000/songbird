# songbird developer entrypoints — the same gate CI runs, available locally.
#
# `make check` mirrors Concord's backend gate (ruff lint + format-check, pyright strict,
# pytest fast suite) so CI and a developer share one command. `make check-frontend` runs the
# SPA gate; `make check-all` runs both. The live-Concord suite (`pytest -m concord`) is NOT in
# the default gate — it needs a reachable Concord and runs in the nightly workflow instead.

.PHONY: check check-frontend check-all

# Backend gate — mirrors Concord's `make check`. The `concord`-marked tests stay excluded
# (pyproject's default `-m "not concord"`), keeping this fast.
check:
	cd backend && ruff check songbird
	cd backend && ruff format --check songbird
	cd backend && pyright
	cd backend && pytest

# Frontend gate — ESLint, strict typecheck, unit tests, production build.
check-frontend:
	cd frontend && npm run lint
	cd frontend && npm run typecheck
	cd frontend && npm run test
	cd frontend && npm run build

# The whole gate, both halves.
check-all: check check-frontend
