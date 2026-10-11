# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS frontend
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY frontend ./frontend
RUN npm run typecheck && npm run build

FROM rust:1.99-bookworm AS backend
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY tests ./tests
COPY frontend/public/fonts ./frontend/public/fonts
COPY --from=frontend /build/frontend/dist ./frontend/dist
RUN cargo test --locked && cargo build --release --locked

FROM debian:bookworm-slim AS runtime
RUN groupadd --gid 10001 wireboard \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin wireboard \
    && install -d -o 10001 -g 10001 -m 700 /data
COPY --from=backend /build/target/release/wireboard /usr/local/bin/wireboard
COPY LICENSE /usr/share/doc/wireboard/
COPY THIRD-PARTY-LICENSES /usr/share/doc/wireboard/THIRD-PARTY-LICENSES
COPY frontend/public/fonts/OFL.txt /usr/share/doc/wireboard/font-OFL.txt
USER 10001:10001
WORKDIR /data
EXPOSE 9843
ENTRYPOINT ["/usr/local/bin/wireboard"]
CMD ["serve", "--listen", "0.0.0.0", "--port", "9843", "--data-dir", "/data"]
