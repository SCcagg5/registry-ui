# syntax=docker/dockerfile:1

FROM golang:1.23-alpine AS build
RUN apk add --no-cache ca-certificates
WORKDIR /src
COPY go.mod ./
COPY main.go ./
COPY public ./public
ARG VERSION=dev
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /out/registry-ui .

FROM scratch
ENV PORT=8080
ENV REGISTRY_URL=http://registry:5000
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /out/registry-ui /registry-ui
USER 65532:65532
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD ["/registry-ui", "health", "--quiet"]
ENTRYPOINT ["/registry-ui"]
