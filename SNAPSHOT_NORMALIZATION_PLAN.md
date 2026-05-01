# Snapshot And Normalization Refactor Plan

## Implementation Status

### Completed

- storage foundation is implemented:
  - `subscription_feeds`
  - `source_snapshots`
  - `normalized_snapshots`
  - `subscription_overrides`
  - raw and normalized snapshot files on disk
  - per-feed snapshot pruning via global retention limit
- successful upstream fetches are persisted as raw source snapshots with detected source format
- successful upstream fetches are parsed into `normalized-v1` and stored as normalized snapshots
- runtime request flow already uses snapshot fallback:
  - `/sub` falls back to latest stored snapshot if fresh fetch fails
  - `/last` can fall back to latest stored snapshot after refresh/cache miss
- same-format shortcut is implemented:
  - if source format equals requested output and there are no explicit overrides, raw snapshot is returned directly
- normalized render path is implemented for:
  - `raw`
  - `raw_base64`
  - `json`
  - `clash`
- JSON/Xray normalized path preserves native source structure when no overrides are applied:
  - `extensions.xray.configs`
  - `balancers`
  - `observatory`
  - `routing.rules`
  - multi-config bundle structure
- Clash/YAML normalized path preserves native source structure when no overrides are applied:
  - original YAML text
  - `proxy-groups`
  - `rules`
  - `dns`
- override storage and application layer are implemented:
  - `nodes.byId`
  - `nodes.byName`
  - `nodes.disabledIds`
  - topology overrides for proxy groups, balancers and observatory
  - policy overrides for routing rules and DNS
- overrides API exists for short links:
  - `GET /api/short-links/:id/overrides`
  - `PUT /api/short-links/:id/overrides`
- frontend already has a basic overrides editor and API client helpers

### In Progress

- format-aware overrides UI by output type
- richer structured editing for `raw`, `clash`, and `json`

### Not Done Yet

- admin/settings UI for snapshot retention limit
- full native structural re-render for overridden JSON/Xray bundles
- full native structural re-render for overridden Clash configs
- merge pipeline fully rewritten around normalized model only
- dedicated structured overrides editor for all advanced fields without raw JSON fallback

## Goal

Replace the current "convert everything through raw" pipeline with a snapshot-based architecture:

- every successful upstream fetch is stored as a raw source snapshot
- the source format is detected and saved
- the source is parsed into a rich internal normalized model and that is also saved
- subsequent responses use the latest successful snapshot if fresh fetch fails
- if input and output formats match and there are no user overrides, the raw snapshot is returned without conversion
- otherwise conversion always goes through the normalized model
- future per-subscription edits must be possible not only for nodes, but also for routing, balancers, observatory, DNS and similar structures

Backward compatibility is not required. It is acceptable to simplify and replace current behavior directly.

## Confirmed Product Decisions

1. Raw upstream bodies should be stored on disk in `data/`, while SQLite stores metadata and file paths.
2. Successful fetch history should be preserved.
3. Failed fetches do not need to be stored.
4. "Subscription not edited" means explicit user overrides only. App-specific shaping at request time is separate and does not count as editing.
5. When input and output are the same format, semantic equivalence is acceptable, but tests are required.
6. Editing should eventually support not only server parameters, but also routing, balancers and observatory.
7. Backward compatibility is not important enough to complicate the implementation.
8. Snapshot retention should be controlled by a global limit exposed in settings/UI.

## Target Architecture

The new flow should be:

1. Resolve request configuration.
2. Attempt to fetch upstream.
3. If upstream fetch succeeds:
   - save raw source snapshot
   - detect and save source format
   - parse into normalized model
   - save normalized snapshot
   - use this fresh snapshot
4. If upstream fetch fails:
   - load the latest successful raw + normalized snapshot for that feed
   - if nothing exists, return an error
5. Determine desired output format.
6. If source format equals requested output format and there are no explicit overrides:
   - return the saved raw snapshot directly
7. Otherwise:
   - load normalized snapshot
   - apply overrides
   - render into requested output format

This removes the current raw-centric pipeline and makes normalized data the canonical representation for conversion and editing.

## Storage Model

### Raw Data On Disk

Store large payloads under `data/`, for example:

- `data/snapshots/raw/<snapshot-id>.body`
- `data/snapshots/normalized/<normalized-id>.json`

Optional future additions:

- `data/snapshots/rendered/<rendered-id>.body` if render caching becomes necessary

### SQLite Tables

Suggested new tables:

#### `subscription_feeds`

Represents a logical upstream source.

Fields:

- `id`
- `feed_key`
- `sub_url`
- `app`
- `device`
- `profile_names`
- `created_at`
- `updated_at`
- `last_success_snapshot_id`

Notes:

- `feed_key` should represent the upstream identity. It should include everything that affects the upstream response, not the downstream output format.
- `output` should not be part of the feed identity because the same upstream snapshot can be rendered into multiple outputs.

#### `source_snapshots`

Represents one successful upstream fetch.

Fields:

- `id`
- `feed_id`
- `fetched_at`
- `fetched_by_type`
- `fetched_by_id`
- `request_context_json`
- `response_status`
- `response_url`
- `response_headers_json`
- `body_path`
- `body_sha256`
- `body_bytes`
- `source_format`
- `source_format_details_json`

Notes:

- only successful upstream fetches are stored
- headers are stored as sanitized JSON
- body lives on disk, path is stored here

#### `normalized_snapshots`

Represents parsed internal form for a specific source snapshot.

Fields:

- `id`
- `feed_id`
- `source_snapshot_id`
- `schema_version`
- `parser_version`
- `normalized_path`
- `normalized_sha256`
- `warnings_json`
- `loss_flags_json`
- `created_at`

Notes:

- keep schema version explicit to enable migrations later
- parser version helps invalidate old normalized data after parser improvements

#### `subscription_overrides`

Represents explicit user edits for a feed.

Fields:

- `id`
- `feed_id`
- `version`
- `overrides_json`
- `created_at`
- `updated_at`

Notes:

- overrides should be separate from snapshots
- current effective model is computed as `normalized + overrides`

#### Optional future tables

- `render_cache`
- `snapshot_access_log`
- `override_history`

These are not necessary in the first implementation.

## Snapshot Retention

Retention should be global, not per feed.

Suggested config:

- `MAX_SNAPSHOTS_PER_FEED`

Behavior:

- after saving a new successful snapshot, count snapshots for the feed
- if count exceeds the limit, delete oldest snapshots beyond the limit
- deletion must remove:
  - raw body file
  - normalized file
  - DB rows for removed snapshots

UI:

- expose the global limit in admin/settings UI
- label clearly that it controls how many successful historical fetches are kept per source

## Internal Normalized Model

The normalized model should be object-based and rich enough to avoid losing JSON/Xray semantics.

Suggested top-level shape:

```json
{
  "schemaVersion": 1,
  "meta": {},
  "nodes": [],
  "topology": {},
  "policy": {},
  "extensions": {}
}
```

### `meta`

Holds parse metadata.

Suggested fields:

- `sourceFormat`
- `sourceFormatDetails`
- `parsedAt`
- `parserVersion`
- `warnings`
- `lossFlags`

### `nodes`

Canonical transport/auth/security representation for servers.

Each node should capture:

- `id`
- `name`
- `enabled`
- `type`
- `endpoint`
  - `host`
  - `port`
- `auth`
  - `uuid`
  - `password`
  - `method`
  - `alterId`
  - `flow`
  - other auth-specific fields
- `transport`
  - `network`
  - `path`
  - `host`
  - `serviceName`
  - `headerType`
  - `authority`
  - `mode`
  - `alpn`
  - protocol-specific extras
- `security`
  - `mode`
  - `sni`
  - `fp`
  - `pbk`
  - `sid`
  - allow-insecure flags and similar
- `tags`
- `origin`
  - original tag/name/id from source format

### `topology`

Represents graph/group semantics that raw links cannot carry well.

Suggested fields:

- `groups`
- `balancers`
- `selectors`
- `fallbacks`
- `observatory`

Examples:

- Xray `routing.balancers`
- observatory selectors and probing setup
- future app-specific grouping constructs

### `policy`

Represents request-routing and runtime settings.

Suggested fields:

- `routingRules`
- `dns`
- `inbounds`
- `outboundDefaults`
- `clientHints`

### `extensions`

Raw format-specific data not yet promoted into canonical fields.

Purpose:

- prevent data loss
- allow future renderer improvements
- preserve JSON/Xray-specific details that do not map cleanly into common fields

Suggested subkeys:

- `xray`
- `clash`
- `raw`
- `appSpecific`

## Parser Strategy

All input formats should be parsed into the normalized model, not into raw.

### JSON / Xray Parser

Must capture:

- outbounds and protocol-specific details
- routing rules
- balancers
- observatory
- DNS
- inbounds
- remarks and grouping semantics

Important:

- do not flatten balancer logic into a list of independent nodes
- keep original selectors, costs, fallback relationships and rule targeting in normalized topology/policy

### Clash YAML Parser

Must capture:

- proxy nodes
- proxy groups
- rules
- DNS where available
- top-level config fields relevant for later rendering

### Raw URI Parser

Must capture:

- all supported URI schemes currently handled
- best-effort extraction of protocol and transport details
- explicit loss flags for information that cannot be represented in raw

Important:

- raw is inherently lossy compared to full JSON/Xray
- that loss should be surfaced in `warnings` / `lossFlags`

## Renderer Strategy

Rendering should always go from normalized model to output, unless same-format short-circuit applies.

### Same-Format Short-Circuit

Condition:

- requested output format equals saved source format
- no explicit overrides exist for the feed

Behavior:

- return raw saved body directly

Notes:

- semantic equivalence is acceptable, but the direct raw return path should avoid unnecessary work and avoid format degradation

### JSON Renderer

Must support:

- rendering normalized model back to JSON/Xray-like form
- preserving topology and policy where normalized data contains it

Important:

- if source was JSON and overrides are absent, raw snapshot should be returned
- if overrides exist, JSON should be re-rendered from normalized model

### Clash Renderer

Must support:

- proxies
- proxy groups
- rules
- app-specific wrapping where needed, but only as request-time shaping

### Raw Renderer

Must support:

- canonical export of nodes to URI lines
- clear ordering rules
- behavior when topology/policy cannot be represented

Important:

- if output is raw, groups/balancers/routing that cannot be encoded should not disappear silently
- emit warnings in diagnostics or logs where appropriate

## Override Model

Overrides are explicit user edits and the only thing that should invalidate the "same format, no conversion" shortcut.

Suggested override groups:

### Node Overrides

- rename
- enable/disable
- host
- port
- auth fields
- transport fields
- security fields

### Group Overrides

- selector membership
- order
- fallback relationships

### Balancer Overrides

- strategy
- cost values
- candidate set

### Routing Overrides

- add rule
- remove rule
- disable rule
- retarget outbound/balancer

### Observatory / DNS Overrides

- selectors
- probe URL
- probe interval
- DNS servers

Application order:

1. load normalized snapshot
2. apply overrides
3. produce effective normalized model
4. render effective model

## Merge Behavior

Merge must stop using `OUTPUT_RAW` as intermediate representation.

New merge behavior:

- fetch or load normalized snapshots for each input
- merge at normalized-model level
- save merged feed / merged snapshot if needed
- render requested output from merged normalized model

Important:

- merging JSON sources should preserve topology/policy as far as possible
- merging raw sources will remain partially lossy where source data is inherently limited

## Feed Identity

Current code mixes upstream-fetch concerns with downstream-output concerns. That should be separated.

Feed identity should include only upstream-affecting inputs, such as:

- `sub_url`
- `app` if it affects upstream request headers
- `device` if it affects upstream request headers
- `profiles` if they affect upstream request headers
- HWID or similar locked upstream request headers if they affect fetched source

Feed identity should not include:

- requested output format
- downstream type overrides used only for rendering

## Runtime Request Flow

Detailed request handling algorithm:

1. Parse request and resolve upstream-facing config.
2. Resolve or create feed record.
3. Attempt upstream fetch.
4. If successful:
   - save raw body to disk
   - save source snapshot metadata
   - detect format
   - parse to normalized
   - save normalized snapshot
   - prune old snapshots by global retention limit
   - choose this snapshot for response
5. If fetch fails:
   - load latest successful snapshot for feed
   - if none exists, return upstream fetch error
6. Load overrides for feed, if any.
7. Determine requested output format.
8. If source format equals output format and overrides are empty:
   - return raw snapshot body directly with original or normalized content-type mapping
9. Else:
   - load normalized snapshot
   - apply overrides
   - render requested output
   - return rendered body

## Migration Strategy

Backward compatibility is not a requirement, so the migration can be direct.

Recommended implementation stages:

### Stage 1. Storage foundation

- add DB tables
- add filesystem directories for snapshots
- add helper APIs for save/load/prune

### Stage 2. Format detection and raw snapshot persistence

- detect source format on successful fetch
- store raw snapshot and metadata

### Stage 3. Normalized model and parsers

- introduce normalized schema
- implement JSON/Xray parser
- implement Clash parser
- implement raw parser

### Stage 4. Renderers

- normalized to JSON
- normalized to Clash
- normalized to raw

### Stage 5. Runtime pipeline switch

- use fresh snapshot on success
- use last successful snapshot on failure
- enable same-format short-circuit
- remove old raw-centric conversion path

### Stage 6. Merge rewrite

- convert merge pipeline to normalized-model merge

### Stage 7. Overrides

- store and apply explicit overrides
- start with backend schema/application logic
- then expose UI

### Stage 8. Settings/UI

- admin control for global retention limit
- snapshot visibility if useful

## Testing Requirements

Tests are required, especially because same-format behavior may return semantically equivalent output rather than byte-identical output.

Minimum required test areas:

### Snapshot Behavior

- successful fetch stores raw snapshot and normalized snapshot
- fetch failure falls back to latest successful snapshot
- retention pruning removes oldest snapshots and files

### Same-Format Short-Circuit

- JSON input + JSON output + no overrides returns raw snapshot path
- Clash input + Clash output + no overrides returns raw snapshot path
- same-format request with overrides does not short-circuit and re-renders

### Parser / Renderer Round Trips

- JSON to normalized to JSON is semantically equivalent
- Clash to normalized to Clash preserves expected structure
- raw to normalized to raw preserves supported node semantics

### Mixed Conversion

- JSON to Clash
- JSON to raw
- Clash to JSON
- raw to JSON

### Merge

- merge JSON sources without going through raw
- merge mixed-source inputs
- merge respects retained topology where representable

### Overrides

- node field overrides
- routing overrides
- balancer overrides
- observatory overrides
- DNS overrides

## Suggested Initial File Areas To Touch

Likely modules to add or heavily refactor:

- `app/subscription.js`
- `app/sqlite-store.js`
- `app/server.js`
- new parser/renderer modules, for example:
  - `app/source-snapshots.js`
  - `app/normalized-model.js`
  - `app/parsers/json-source.js`
  - `app/parsers/clash-source.js`
  - `app/parsers/raw-source.js`
  - `app/renderers/json-renderer.js`
  - `app/renderers/clash-renderer.js`
  - `app/renderers/raw-renderer.js`
  - `app/overrides.js`
- frontend/admin settings files for retention limit

## Non-Goals For First Pass

These can wait:

- storing failed upstream fetch history
- render cache optimization
- full historical override timeline
- perfect reconstruction of information that was never representable in raw

## Open Implementation Notes

- Content-type handling should be derived from output format rather than copied blindly from raw snapshot when re-rendering.
- Raw snapshot short-circuit should still respect current response header sanitization policy.
- Parser and renderer versions should be explicit constants so snapshots can be invalidated safely after improvements.
- Loss tracking should be first-class. If conversion from rich format to poorer format loses semantics, that should be recorded and testable.
