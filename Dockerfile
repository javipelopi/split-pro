ARG ALPINE_VERSION=3.21
ARG NODE_VERSION=22.16.0

FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS base

ENV SKIP_ENV_VALIDATION="true"
ENV DOCKER_OUTPUT=1
ENV NEXT_TELEMETRY_DISABLED=1
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV APP_VERSION=${APP_VERSION}
ENV GIT_SHA=${GIT_SHA}

RUN apk update && apk add --no-cache libc6-compat

WORKDIR /app
RUN npm i -g corepack@latest && corepack enable
COPY package.json pnpm-lock.yaml prisma/ ./

# Cache pnpm store across builds — avoids re-downloading packages
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .

# Cache Next.js build artifacts across builds — avoids full recompilation
RUN --mount=type=cache,target=/app/.next/cache \
    pnpm build

FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS release

ARG APP_VERSION

ENV NODE_ENV=production
ENV DOCKER_OUTPUT=1

WORKDIR /app

RUN apk update \
    && apk add --no-cache libc6-compat \
    && rm -rf /var/cache/apk/*

COPY --from=base /app/.next/standalone ./
COPY --from=base /app/.next/static ./.next/static
COPY --from=base /app/public ./public
COPY --from=base /app/prisma ./prisma

# Install prisma CLI for running migrations at startup.
# Pin to the version in pnpm-lock.yaml (devDependencies.prisma) — the
# unpinned `npm install -g prisma` pulls `latest`, and prisma >=7.x has a
# SQL parser regression that fails on multi-statement plpgsql function
# bodies with $$-quoted strings (error: "unterminated dollar-quoted
# string"). The migration `20260406020000_add_expense_payer` hits this
# because it redefines the `auto_unhide_friend` trigger with multiple
# statements inside the function body. Keep this version in lock step
# with pnpm-lock.yaml `prisma:` and rebuild whenever it bumps.
RUN npm install -g prisma@6.19.1

# set this so it throws error where starting server
ENV SKIP_ENV_VALIDATION="false"
ENV APP_VERSION=${APP_VERSION}

COPY ./start.sh ./start.sh

CMD ["sh", "start.sh"]
