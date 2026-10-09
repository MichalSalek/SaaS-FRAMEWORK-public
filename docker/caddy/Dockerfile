# Custom Caddy with the Cloudflare DNS plugin (for ACME DNS-01 — the staging box
# is behind home NAT on a private IP, so HTTP-01/TLS-ALPN are impossible).
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/cloudflare
FROM caddy:2
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
