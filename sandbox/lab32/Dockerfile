FROM node:22-bookworm-slim
# Override this at build time with a verified exact CLI version for a recording.
ARG CODEX_VERSION=alpha
RUN npm install -g @openai/codex@${CODEX_VERSION} && codex --version && codex exec-server --help
COPY --chmod=755 entrypoint.sh /usr/local/bin/lab32-entrypoint
USER node
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/lab32-entrypoint"]
