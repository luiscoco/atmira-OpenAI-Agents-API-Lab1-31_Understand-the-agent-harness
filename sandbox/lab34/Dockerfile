FROM node:22-bookworm-slim
ARG CODEX_VERSION=alpha
RUN npm install -g @openai/codex@${CODEX_VERSION} && codex --version && codex exec-server --help
COPY skills /opt/lab34/skills
COPY --chmod=755 entrypoint.sh /usr/local/bin/lab34-entrypoint
USER node
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/lab34-entrypoint"]
