# Changelog

## [1.2.0](https://github.com/DDS-Solutions/AI-TadPole-Eye-View/compare/v1.1.0...v1.2.0) (2026-08-27)


### Features

* complete Phase 4 hygiene, licensing download packs, telemetry, and M2 showcase ([#20](https://github.com/DDS-Solutions/AI-TadPole-Eye-View/issues/20)) ([d1bf733](https://github.com/DDS-Solutions/AI-TadPole-Eye-View/commit/d1bf7339156163e0848ea15fb4782ceff165f22f))
* **perf,web,cesium-kit:** implement frame-budget monitor, bundle check, virtualized table, and uPlot charts with ADR 0025 ([#16](https://github.com/DDS-Solutions/AI-TadPole-Eye-View/issues/16)) ([e18e298](https://github.com/DDS-Solutions/AI-TadPole-Eye-View/commit/e18e29872dcd2786b1a4a2fc3f0373a69b060123))
* **phase-3:** Voice Agent, Governed Tool Registry, and Yjs Live Co-Op Rooms ([#19](https://github.com/DDS-Solutions/AI-TadPole-Eye-View/issues/19)) ([f4150ec](https://github.com/DDS-Solutions/AI-TadPole-Eye-View/commit/f4150ec419ff911b636f9ebcc4ae7bdb715bf517))
* **providers,governance,server:** implement typed provider registry, ops auth & RBAC consistency, and ADR 0030/0039 (Phase 5.0) ([#23](https://github.com/DDS-Solutions/AI-TadPole-Eye-View/issues/23)) ([27fd585](https://github.com/DDS-Solutions/AI-TadPole-Eye-View/commit/27fd585f36d21ee95d9f4e1d0ab092bd49d865f2))


### Bug Fixes

* **governance,cesium-kit,server:** remediate code review findings across security, persistence, and layer controllers ([#18](https://github.com/DDS-Solutions/AI-TadPole-Eye-View/issues/18)) ([e7b4425](https://github.com/DDS-Solutions/AI-TadPole-Eye-View/commit/e7b44259464cd48ee13d4dde846b0708174c8ba0))
* **security,governance,server:** remediate Deep Source Audit findings across auth, RBAC, tool execution, and documentation ([#22](https://github.com/DDS-Solutions/AI-TadPole-Eye-View/issues/22)) ([fed5df9](https://github.com/DDS-Solutions/AI-TadPole-Eye-View/commit/fed5df9a0e7125917360a58b27cca61c5991d0bb))

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
