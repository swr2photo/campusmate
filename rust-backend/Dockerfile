FROM rust:1.99-bookworm AS build
ARG CARGO_PROFILE_RELEASE_LTO=thin
ARG CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY migrations ./migrations
COPY web ./web
COPY operations/runtime-grants.sql ./operations/runtime-grants.sql
COPY operations/neon-runtime-logins.sql ./operations/neon-runtime-logins.sql
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo build --locked --release && \
    mkdir -p /app/bin && \
    cp /app/target/release/campusmate-backend /app/target/release/migrate \
       /app/target/release/import-export /app/target/release/email-worker \
       /app/target/release/check-database /app/target/release/check-identity \
       /app/target/release/provision-neon-logins /app/bin/
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/bin/ /usr/local/bin/
ENV BIND_HOST=0.0.0.0 PORT=8080 APP_ENV=production
USER 65532:65532
EXPOSE 8080
CMD ["campusmate-backend"]
