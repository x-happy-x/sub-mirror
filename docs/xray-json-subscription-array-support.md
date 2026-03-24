# Support Xray JSON subscription arrays

## Problem

`sub-lab` currently accepts:
- raw URI lists (`vless://`, `vmess://`, `ss://`, `trojan://`, `ssr://`)
- base64-encoded raw lists
- Clash YAML providers (`proxies:`)
- a single JSON object with `happ.cryptoLink`

It does **not** accept Xray JSON subscription arrays like:

```json
[
  {
    "remarks": "Finland",
    "outbounds": [
      {
        "protocol": "vless",
        "settings": {
          "vnext": [
            {
              "address": "example.com",
              "port": 443,
              "users": [
                {
                  "id": "uuid",
                  "flow": "xtls-rprx-vision",
                  "encryption": "none"
                }
              ]
            }
          ]
        },
        "streamSettings": {
          "network": "tcp",
          "security": "reality",
          "realitySettings": {
            "serverName": "google.com",
            "publicKey": "pubkey",
            "shortId": "50",
            "fingerprint": "chrome"
          }
        }
      }
    ]
  }
]
```

Because of that, `produceOutput()` returns `no subscriptions` for `output=raw`, and `output=clash` only works if external conversion happens to understand this format.

## What to change

### 1. Detect Xray JSON arrays/objects

Add a helper in `app/subscription.js`:

- `parseJsonSubscriptionConfigs(text)`
  - parse JSON safely
  - accept either:
    - array root: `[{...}, {...}]`
    - object root with `outbounds`
  - return normalized config array or `null`

### 2. Convert JSON configs to raw URIs

Add helpers:

- `jsonSubscriptionConfigsToRawUris(text)`
- `jsonOutboundToRawUri(outbound, fallbackName)`

Suggested scope for first implementation:
- support only `protocol === "vless"`
- skip unsupported protocols instead of failing whole conversion
- support networks:
  - `tcp`
  - `ws`
  - `grpc`
  - `xhttp`
- support security:
  - `none`
  - `reality`

Suggested field mapping for `vless://`:
- uuid -> `users[0].id`
- host -> `vnext[0].address`
- port -> `vnext[0].port`
- name -> `config.remarks || outbound.tag || host:port`
- `flow` -> `flow`
- `security` -> `security`
- `serverName` -> `sni`
- `publicKey` -> `pbk`
- `shortId` -> `sid`
- `fingerprint` -> `fp`
- ws path -> `path`
- ws host header -> `host`
- grpc service name -> `serviceName`
- xhttp mode -> `mode`
- xhttp host -> `host`

### 3. Extend `extractConvertibleSource()`

Current behavior only extracts `happ.cryptoLink` from a single JSON object.

New behavior should be:
- if object with `happ.cryptoLink` -> return cryptoLink as before
- else if JSON array/object contains Xray configs -> return `jsonSubscriptionConfigsToRawUris(text)`
- else return original text

### 4. Extend `hasAnySubscriptions()`

If text is JSON subscription array/object and at least one supported outbound can be converted to a URI, treat it as a valid subscription source.

### 5. Keep existing flow intact

For `output=raw`:
- if source is JSON array/object -> convert to raw URI list directly

For `output=clash`:
- first normalize JSON array/object to raw URI list
- then continue current path:
  - subconverter
  - fallback `convertVlessListToClash()`

This preserves existing behavior for current formats.

## Minimal acceptance cases

1. `produceOutput(jsonArray, "raw")`
   - returns `ok: true`
   - returns `text/plain; charset=utf-8`
   - body contains at least one `vless://`

2. `produceOutput(jsonArray, "clash")`
   - if subconverter is available: converted Clash YAML
   - if subconverter result is not YAML: fallback via `convertVlessListToClash()`

3. Existing inputs must keep working unchanged:
   - raw URI lists
   - base64 raw lists
   - Clash YAML
   - Happ JSON with `cryptoLink`

## Notes from the failing sample

The sample that triggered this issue contains a JSON array of full Xray configs, including `vless` outbounds with:
- `tcp + reality`
- `grpc + reality`
- `ws`
- `xhttp + reality`

There is also at least one `users[0].encryption` value with a very long custom token. First implementation can safely ignore this field for URI generation instead of rejecting the node.

## Recommended tests

Add tests covering:
- raw conversion from JSON array
- clash conversion from JSON array via fallback path
- skipping unsupported outbounds without failing entire source
