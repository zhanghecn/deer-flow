# Docker Directory

`docker/` contains source-controlled Dockerfiles and the local development
compose file. Production compose lives in `deploy/docker-compose.yml`.

Current Docker development, release, deploy, data-directory, and troubleshooting
instructions live in:

- [OpenAgents Docker 开发与发版流程](../docs/guides/docker-compose-prod-selfhost-zh.md)

Do not place generated production `.env`, copied config, migrations, or
persistent data under this directory. The deployment scripts prepare those files
under `deploy/`.
