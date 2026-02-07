# Repository Guidelines

## Project Structure & Module Organization
- `app/server.js` is the Node.js HTTP service that fetches and converts subscriptions.
- `app/package.json` defines the Node module type (ESM) and repo name.
- `docker-compose.yml` wires the fetcher service, nginx, and a subconverter container.
- `docker-compose.single.yml` builds a single-container setup without nginx.
- `Dockerfile.allinone` and `docker-compose.allinone.yml` run fetcher + subconverter in one container.
- `nginx/default.conf` proxies `/sub` and `/last` to the fetcher (legacy `/subscription.yaml`, `/happ.sub.yaml` still work).
- `data/` is a shared volume for input and generated artifacts (`raw.txt`, `subscription.yaml`, `status.json`, `converted.txt`).

## Build, Test, and Development Commands
- `docker compose up --build` starts the full stack (fetcher, converter, nginx).
- `docker compose -f docker-compose.single.yml up --build` starts the single-container setup on port 25500.
- `docker compose -f docker-compose.allinone.yml up --build` starts the all-in-one container (fetcher on 25500, converter on 25501).
- `docker compose down` stops and removes the stack.
- `node app/server.js` runs the fetcher locally (set `SUB_URL`, `CONVERTER_URL`, `SOURCE_URL`, `PORT`).
- `curl "http://localhost:25500/sub?sub_url=..."` validates nginx + fetcher flow.

## Coding Style & Naming Conventions
- JavaScript (ESM) with 2-space indentation; prefer `const`/`let` and explicit names.
- Environment variables are upper snake case (`SUB_URL`, `USE_CONVERTER`, `CONVERTER_URL`).
- Output files in `/data` use lowercase with dots (`subscription.yaml`, `status.json`).

## Testing Guidelines
- No automated tests are present. If you add tests, place them under `app/` and document the run command (e.g., `node --test`).
- Manual checks should cover `/sub`, `/last`, and `/health` endpoints.

## Commit & Pull Request Guidelines
- Git history does not show a consistent commit message convention; keep messages short and imperative (e.g., "Add health check").
- PRs should describe changes, include relevant environment variables, and note any manual test commands run.

## Configuration & Operational Notes
- `USE_CONVERTER=1` enables subconverter; otherwise, the service falls back to VLESS-only conversion.
- `app=happ` and `hwid=...` query parameters affect request headers; `/last` serves the last cached subscription for the same `sub_url`/`use_converter`/`app` tuple.
- The service writes to `/data` and expects it to be writable by the container/user.
- Nginx exposes `http://localhost:25500/` for static files and proxies subscription endpoints.
