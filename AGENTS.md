# Repository Guidelines

## Project Structure & Module Organization
- `app/server.js` hosts the Node.js HTTP service that fetches and converts subscription data.
- `app/package.json` defines the Node module type and project metadata.
- `data/` is a bind-mounted volume for runtime artifacts (`raw.txt`, `subscription.yaml`, cache files).
- `Dockerfile` builds a container that runs both the app and the bundled subconverter.
- `docker-compose.yml` wires ports, environment variables, and the `data/` volume.
- `entrypoint.sh` bootstraps the subconverter and starts the Node server.

## Build, Test, and Development Commands
- `docker compose up --build` builds the image and runs the app + subconverter stack.
- `docker compose up` starts the stack using existing images.
- `docker compose down` stops containers and removes the stack.
- `node app/server.js` runs the HTTP service locally (requires Node 18+ and expected env vars).

## Coding Style & Naming Conventions
- JavaScript is written as ES modules (`import ... from`).
- Use 2-space indentation and double quotes to match `app/server.js`.
- Prefer descriptive, verb-led function names (e.g., `handleSubscription`, `refreshCache`).
- Keep constants uppercase with underscores for environment-driven values.
- No formatter or linter is configured; match existing style manually.

## Testing Guidelines
- No automated test suite is present.
- When changing request handling or conversion logic, validate manually:
  - `curl "http://localhost:8788/sub?sub_url=..."` for fresh fetch.
  - `curl "http://localhost:8788/last?sub_url=..."` for cache behavior.

## Commit & Pull Request Guidelines
- Recent commits use short, imperative, sentence-case summaries (e.g., "Add Docker integration...").
- Keep commit messages concise and scoped to one change set.
- PRs should describe the behavior change, config/env updates, and any new ports or endpoints.
- Include example commands or curl calls when behavior changes are not obvious.

## Configuration Notes
- Runtime behavior is controlled via env vars like `SUB_URL`, `USE_CONVERTER`, `CONVERTER_URL`.
- Ports default to `APP_PORT=8788` and `SUBCONVERTER_PORT=8787` (see `docker-compose.yml`).
