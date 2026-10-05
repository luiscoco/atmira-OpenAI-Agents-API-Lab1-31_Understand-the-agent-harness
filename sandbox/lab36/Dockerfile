FROM node:22-bookworm-slim
ARG CODEX_VERSION=alpha
RUN npm install -g @openai/codex@${CODEX_VERSION} && codex --version && codex exec-server --help
COPY mcp.mjs /opt/lab36/mcp.mjs
COPY smoke.mjs /opt/lab36/smoke.mjs
COPY --chmod=755 entrypoint.sh /usr/local/bin/lab36-entrypoint
USER node
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/lab36-entrypoint"]
