# Static site served by an unprivileged nginx (runs as non-root on port 8080).
FROM nginxinc/nginx-unprivileged:stable-alpine

ARG APP_VERSION=1.0.0
ARG GIT_COMMIT=unknown
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.title="text2voice" \
      org.opencontainers.image.description="Storyteller - expressive text to voice web app" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_COMMIT}" \
      org.opencontainers.image.created="${BUILD_DATE}"

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY public/ /usr/share/nginx/html/

# Stamp the image with the commit it was built from; the app polls this to detect new deployments.
USER root
RUN printf '{"version":"%s","commit":"%s","builtAt":"%s"}\n' "$APP_VERSION" "$GIT_COMMIT" "$BUILD_DATE" \
      > /usr/share/nginx/html/version.json \
 && chmod -R a+rX /usr/share/nginx/html
USER 101

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
