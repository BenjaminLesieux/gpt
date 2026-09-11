# Build with `pnpm nx run @gpt/hub:docker:build`, which runs `prune` first.
# The context is apps/hub and everything the image needs comes out of
# apps/hub/dist — nothing here compiles TypeScript.
#
# The Node version is pinned exactly rather than tracked as `lts`, so that
# rebuilding this Dockerfile next quarter produces the runtime it was tested
# against instead of whatever became LTS meanwhile. 22 is the floor
# better-sqlite3@13 asks for (`engines: node >=22`).
#
# Alpine (musl) over a glibc base because neither native dependency needs a
# compiler here: better-sqlite3@13 carries prebuilds/linuxmusl-*.node inside
# its own tarball and @node-rs/argon2 resolves a *-musl optional dependency.
# With no toolchain to install either way, musl is simply the smaller base.
FROM docker.io/node:22.21.1-alpine AS deps

# `corepack enable` with no version resolves pnpm's "latest" at build time, so
# the image installs with a different pnpm than the workspace on any given day.
# It is also what broke the first run of this file: corepack went looking for
# pnpm 12 and fell over fetching it.
RUN npm install --global pnpm@10.5.2

WORKDIR /app

COPY dist/package.json dist/pnpm-lock.yaml ./
COPY dist/workspace_modules ./workspace_modules

# @nx/js:prune-lockfile writes apps/hub/package.json through verbatim, so the
# manifest that lands in dist still carries the devDependencies and the whole
# nx target block. Neither belongs in an image: nothing here runs
# `nx run db-generate`, and a manifest advertising drizzle-kit alongside a
# node_modules that deliberately lacks it misleads whoever reads it next.
#
# The `pnpm` block is added here rather than in apps/hub/package.json because
# pnpm only honours that field in a workspace root and warns on every install
# when it finds it anywhere else. dist/package.json *is* the root of its own
# single-package install, so this is the one place the setting both takes
# effect and stays quiet.
#
# The policy itself: pnpm 10 aborts on ERR_PNPM_IGNORED_BUILDS unless the
# manifest takes a position on every dependency carrying a build script.
# better-sqlite3 goes under ignoredBuiltDependencies and not into the
# onlyBuiltDependencies allowlist, because allowing its build runs
# `node-gyp rebuild`, and node-gyp needs python3 to run gyp at all — even
# though binding.gyp is written to compile nothing when a matching prebuild is
# present. Allowing the build would buy a C toolchain and a Python interpreter
# to produce the binary that is already in the tarball.
RUN node -e "const m = require('/app/package.json'); delete m.nx; delete m.devDependencies; m.pnpm = { onlyBuiltDependencies: [], ignoredBuiltDependencies: ['better-sqlite3'] }; require('fs').writeFileSync('/app/package.json', JSON.stringify(m, null, 2))"

# --prod keeps the devDependencies out even if the rewrite above ever stops
# stripping them.
#
# --prefer-frozen-lockfile rather than --frozen-lockfile: @nx/js:prune-lockfile
# copies the workspace root's `patchedDependencies` into the pruned lockfile
# without copying the patches/ directory it points at, so a frozen install
# dies on ERR_PNPM_LOCKFILE_CONFIG_MISMATCH. Preferring it still takes every
# version from the lockfile and degrades to resolution instead of failing.
RUN pnpm install --prod --prefer-frozen-lockfile


FROM docker.io/node:22.21.1-alpine

# env.ts defaults HOST to localhost, which inside a container binds an
# interface nothing outside the container can reach.
ENV HOST=0.0.0.0
ENV PORT=3000

# The hub serves clone/fetch/push by handing requests to `git http-backend`,
# so git is a runtime dependency and not a build convenience.
RUN apk add --no-cache git

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json

# esbuild builds with bundle:false, so dist mirrors the workspace tree:
# main.js is only a module-resolution shim over apps/hub/src/main.js, and the
# migrations have to stay at apps/hub/src/db/migrations because src/main.ts
# resolves them off __dirname. Flattening this breaks migrate-on-boot.
COPY dist/apps ./apps
COPY dist/main.js ./main.js

# src/main.ts migrates the database before it listens, so boot is the
# migration step — there is no separate entrypoint script.
CMD [ "node", "main.js" ]
