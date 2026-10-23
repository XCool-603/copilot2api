FROM golang:1.23-alpine AS build

WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -mod=vendor -trimpath -ldflags="-s -w" -o /out/copilot2api ./cmd/server

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata \
    && mkdir -p /data /app
WORKDIR /app
COPY --from=build /out/copilot2api /app/copilot2api
EXPOSE 4141
ENV M365_LISTEN=0.0.0.0:4141 \
    M365_DATA_DIR=/data \
    M365_CONFIG=/data/accounts.json \
    M365_TOKEN_CACHE=/data/token-cache.json \
    M365_SESSION_CACHE=/data/sessions.json \
    M365_API_KEYS=/data/api-keys.json \
    M365_ADMIN_PASSWORD_FILE=/data/admin-password \
    M365_ADMIN_PASSWORD_BOOTSTRAP_FILE=/run/secrets/m365_admin_password \
    M365_FORCE_IPV4=
VOLUME ["/data"]
ENTRYPOINT ["/app/copilot2api"]
