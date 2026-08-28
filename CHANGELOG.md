# Changelog

> **Historical release notice:** `v1.0.0` and `v1.1.0` were generated while the
> project was still an early-stage seed/simulation scaffold. These immutable tags do
> not certify production readiness or completed M2/M3 governance. Automated releases
> are gated pending the evidence defined in [VERSION_CONTROL.md](./VERSION_CONTROL.md)
> and `PLAN.md` §14.

## [1.1.0](https://github.com/DDS-Solutions/AI-TadPole-Eye-View/compare/v1.0.0...v1.1.0) (2026-08-26)


### Features

* **core,web,security:** implement SceneState serializer, URL deep links, and SECURITY.md threat model ([#9](https://github.com/DDS-Solutions/AI-TadPole-Eye-View/issues/9)) ([407cbd5](https://github.com/DDS-Solutions/AI-TadPole-Eye-View/commit/407cbd557f7960fa690692b395b9b1dc8a1490db))
* **docs,adg:** implement Active Documentation Guard validator, operational RUNBOOK.md, and ADR 0018 ([#8](https://github.com/DDS-Solutions/AI-TadPole-Eye-View/issues/8)) ([458a210](https://github.com/DDS-Solutions/AI-TadPole-Eye-View/commit/458a210e469c63f96b311fa77a48a079ddf7673d))
* **layers,web,cesium-kit:** implement media telemetry layers 6-9, trajectories, and live media HUD with ADR 0024 ([#14](https://github.com/DDS-Solutions/AI-TadPole-Eye-View/issues/14)) ([5969ee9](https://github.com/DDS-Solutions/AI-TadPole-Eye-View/commit/5969ee9ad703871bfe28dc572d9a425bcf9c8ca6))
* **ops-mcp,cli:** implement operator MCP server, gev CLI surface, and debug bus ([#7](https://github.com/DDS-Solutions/AI-TadPole-Eye-View/issues/7)) ([da153c0](https://github.com/DDS-Solutions/AI-TadPole-Eye-View/commit/da153c0f6190703c8995ed71c144f20c9529b493))
* **security,providers,server:** implement Overpass QL sanitizer and Radio stream proxy with ADR 0021 ([#11](https://github.com/DDS-Solutions/AI-TadPole-Eye-View/issues/11)) ([fdf6f0e](https://github.com/DDS-Solutions/AI-TadPole-Eye-View/commit/fdf6f0ef5597bc67517869508bbce4cb90a86b54))
* **server,governance,providers:** implement CCTV proxy, Realtime voice tokens, and M1 SSE audit stream ([#12](https://github.com/DDS-Solutions/AI-TadPole-Eye-View/issues/12)) ([3dcb0e2](https://github.com/DDS-Solutions/AI-TadPole-Eye-View/commit/3dcb0e23550a516eb2b66dee6ebef2df387ee86a))
* **server,providers,contracts:** port data proxies into Hono routes with Cost Governor middleware ([#10](https://github.com/DDS-Solutions/AI-TadPole-Eye-View/issues/10)) ([dccc518](https://github.com/DDS-Solutions/AI-TadPole-Eye-View/commit/dccc5182bfc21f6bbaf8365aba8ca33f99f65eb2))

## 1.0.0 (2026-08-26)


### Features

* **providers:** add OpenSky provider adapter and seed fixture replay ([#2](https://github.com/DDS-Solutions/AI-TadPole-Eye-View/issues/2)) ([8b1301e](https://github.com/DDS-Solutions/AI-TadPole-Eye-View/commit/8b1301ea87ef86f65798d0cf19cc0678b53436bf))
* **scaffold:** initialize GEV v2 monorepo with contracts, security, and core packages ([52da1ce](https://github.com/DDS-Solutions/AI-TadPole-Eye-View/commit/52da1cecb7426eaac5e28765cc057f40a1c1ef9b))


### Bug Fixes

* **ci:** align pnpm action setup with packageManager and add doc stubs ([757eb53](https://github.com/DDS-Solutions/AI-TadPole-Eye-View/commit/757eb537ee46b4c10bffbbee221279f6d54f26e5))
