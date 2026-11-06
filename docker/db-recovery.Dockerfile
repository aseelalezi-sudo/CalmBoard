# Local recovery tooling; application images do not depend on this image.
FROM postgres:18-alpine
RUN apk add --no-cache age
USER 65532:65532
ENTRYPOINT ["age"]
