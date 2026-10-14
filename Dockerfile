# The Arrowsterr app (app.arrowsterr.com): build Next.js, then serve it.
# At runtime it only needs the build (.next), public/, next.config.ts and the packages. Nothing reads files from src/, docs/ or supabase/.
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Sentry in the browser reads its DSN at build time. Fly passes it from [build.args] in fly.toml. Empty means off.
# The build needs no Sentry auth token: next.config.ts doesn't upload source maps.
ARG NEXT_PUBLIC_SENTRY_DSN=""
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN useradd --create-home web
COPY --from=build /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && rm -rf /root/.npm
# The app writes only to .next (its image cache), so only .next belongs to the web user.
# This skips a chown of node_modules, which would copy it into a second layer and double the image.
COPY --from=build --chown=web /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.ts ./
USER web
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
