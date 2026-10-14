# syntax=docker/dockerfile:1
FROM rust:1-bookworm AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock* ./
COPY src ./src
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release && cp target/release/campusmate-matching /campusmate-matching

# Distroless: no shell or package manager, runs as an unprivileged user.
FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=build /campusmate-matching /campusmate-matching
USER nonroot
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["/campusmate-matching"]
