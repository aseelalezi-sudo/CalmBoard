# syntax=docker/dockerfile:1
#
# MinIO stopped publishing public container images (minio/minio was removed from Docker Hub and quay.io now requires
# authentication), so build the same pinned release from source. It is used by the local development stack and the
# restore drill only; staging and production use a real S3 service.
ARG GO_VERSION=1.25

FROM golang:${GO_VERSION}-alpine AS build
ARG MINIO_RELEASE=RELEASE.2025-09-07T16-13-09Z
ENV CGO_ENABLED=0
RUN go install -trimpath -ldflags "-s -w" "github.com/minio/minio@${MINIO_RELEASE}"

FROM alpine:3.24
# Runs as root like the upstream image did, so volumes created by earlier containers stay writable.
RUN apk add --no-cache ca-certificates curl && mkdir /data
COPY --from=build /go/bin/minio /usr/bin/minio
ENV MINIO_ROOT_USER=minioadmin
EXPOSE 9000 9001
VOLUME ["/data"]
ENTRYPOINT ["/usr/bin/minio"]
