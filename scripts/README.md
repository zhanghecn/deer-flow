# Scripts

This directory keeps only repository-level operator and verification entrypoints.
Generated files such as `__pycache__/` do not belong here.

## Docker Operations

- `install.sh` - public one-line self-host installer used by `curl | bash`.
- `docker.sh` - local Docker development stack used by `make docker-*`.
- `docker-deploy.sh` - prepares and starts the self-contained production `deploy/` directory.
- `docker-release.sh` - builds, pushes, pulls, and deploys versioned release images.
- `cleanup-containers.sh` - removes sandbox containers left by local runtime tests.

Current deploy, release, testing, and operations workflow:

- `../OPERATIONS.md`

## Demo Helpers

- `demo.sh` - starts, stops, and inspects the bind-mounted demo workbench.

## Smoke And Setup Probes

- `knowledge_e2e_smoke.py` - manual knowledge-base E2E smoke runner.
- `real_browser_public_api_test.py` - public API browser smoke test.
- `setup_support_demo_runtime.py` - prepares the support demo runtime fixture.
