# Scripts

This directory keeps only repository-level operator and verification entrypoints.
Generated files such as `__pycache__/` do not belong here.

## Docker Operations

- `docker.sh` - local Docker development stack used by `make docker-*`.
- `docker-deploy.sh` - prepares the self-contained production `docker/` directory.
- `docker-release.sh` - builds, pushes, pulls, and deploys Docker Hub release images.
- `cleanup-containers.sh` - removes sandbox containers left by local runtime tests.

## Demo Helpers

- `demo.sh` - starts, stops, and inspects the demo workbench.
- `demo-local-deps.sh` - bootstraps and manages demo local dependencies.

## Browser And Smoke Probes

- `find_skills_browser_probe.mjs` - browser regression for skill discovery.
- `agent_skill_regression_probe.mjs` - browser regression for agent skill install/use.
- `agent_dataset_browser_probe.mjs` - browser regression for agent dataset flows.
- `headed_full_flow_probe.mjs` - headed browser regression for the full flow.
- `browser_probe_utils.mjs` - shared Playwright helper code for the probes above.
- `knowledge_e2e_smoke.py` - manual knowledge-base E2E smoke runner.
- `real_browser_public_api_test.py` - public API browser smoke test.
- `setup_support_demo_runtime.py` - prepares the support demo runtime fixture.

See `README-browser-probes.md` for browser probe usage.
