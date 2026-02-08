# Sub Mirror

Small HTTP service that fetches a subscription URL, optionally converts it to Clash
provider YAML, and caches the result.

## Quick start (Docker Compose)

Start full stack (fetcher + converter + nginx):

```bash
docker compose up --build
```

Send a request through nginx:

```bash
curl "http://localhost:25500/sub?sub_url=https%3A%2F%2Fexample.com%2Fsub%3Ftoken%3Ddemo&use_converter=0&app=happ"
```

Get the last cached response (refresh is attempted first, fallback to cache):

```bash
curl "http://localhost:25500/last?sub_url=https%3A%2F%2Fexample.com%2Fsub%3Ftoken%3Ddemo&use_converter=0&app=happ"
```

## Single-container setup

```bash
docker compose -f docker-compose.single.yml up --build
```

## All-in-one container

```bash
docker compose -f docker-compose.allinone.yml up --build
```

## Local run (no Docker)

```bash
export SUB_URL="https://example.com/sub?token=demo"
export USE_CONVERTER=0
export CONVERTER_URL="http://127.0.0.1:8787/sub"
export SOURCE_URL="http://127.0.0.1:8788/source.txt"
export PORT=8787

node app/server.js
```

Then:

```bash
curl "http://localhost:8787/sub?sub_url=https%3A%2F%2Fexample.com%2Fsub%3Ftoken%3Ddemo&use_converter=0"
```

## Notes

- `/sub` fetches and returns a fresh subscription (and writes cache).
- `/last` first tries to refresh the cache; on failure or empty result, it serves
  the last cached file and returns cached upstream headers (if available).
- Output and cache files live in `data/` and are ignored by git.
