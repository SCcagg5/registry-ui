# syntax=docker/dockerfile:1.7

ARG GO_VERSION=1.23
FROM golang:${GO_VERSION}-alpine AS builder
ARG VERSION=dev
ARG TARGETOS=linux
ARG TARGETARCH=amd64
WORKDIR /src

RUN apk add --no-cache ca-certificates && update-ca-certificates

COPY src/go.mod ./
COPY src/*.go ./
COPY src/public ./public

RUN go test ./...
RUN set -eux; \
    CGO_ENABLED=0 GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" \
      go build \
        -tags=netgo,osusergo \
        -trimpath \
        -ldflags="-s -w -buildid= -X main.version=${VERSION}" \
        -o /out/rootfs/registry-ui .; \
    mkdir -p /out/rootfs/etc/ssl/certs; \
    cp /etc/ssl/certs/ca-certificates.crt /out/rootfs/etc/ssl/certs/ca-certificates.crt

FROM scratch AS runtime
ENV PORT=8080
COPY --from=builder /out/rootfs/ /
USER 65532:65532
WORKDIR /
EXPOSE 8080
STOPSIGNAL SIGTERM
ENTRYPOINT ["/registry-ui"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["/registry-ui", "health", "--quiet"]
