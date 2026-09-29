# Official multi-platform Caddy 2.11.4-alpine index, pinned for reproducibility.
FROM caddy:2.11.4-alpine@sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b
RUN setcap -r /usr/bin/caddy && mkdir -p /srv /data /config && chown -R 10001:10001 /srv /data /config
COPY --chown=10001:10001 site/ /srv/
COPY Caddyfile /etc/caddy/Caddyfile
USER 10001:10001
ENV SITE_ADDRESS=http://localhost:8080
EXPOSE 8080 80 443
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:9090/health || exit 1
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
