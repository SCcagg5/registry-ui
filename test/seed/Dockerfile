# syntax=docker/dockerfile:1.7

ARG GO_VERSION=1.23
FROM golang:${GO_VERSION}-alpine AS builder
ARG TARGETOS=linux
ARG TARGETARCH=amd64
WORKDIR /src

COPY test/seed/go.mod ./
COPY test/seed/*.go ./

RUN go test ./...
RUN CGO_ENABLED=0 GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" \
    go build -tags=netgo,osusergo -trimpath -ldflags="-s -w -buildid=" -o /out/registry-seed .

FROM scratch
COPY --from=builder /out/registry-seed /registry-seed
USER 65532:65532
ENTRYPOINT ["/registry-seed"]
