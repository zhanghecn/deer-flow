# Docker Directory

`docker/` contains source-controlled Dockerfiles and compose templates.

Current Docker development, release, deploy, data-directory, and troubleshooting
instructions live in:

- [OpenAgents Docker 开发与发版流程](../docs/guides/docker-compose-prod-selfhost-zh.md)

Do not place generated production `.env`, copied config, or persistent data
under this directory. The current deployment scripts generate those files under
`deploy/`.
