FROM node:22-bookworm-slim
ARG CODEX_VERSION=alpha
RUN npm install -g @openai/codex@${CODEX_VERSION} && codex --version && codex exec-server --help
COPY probe.mjs /opt/lab35/probe.mjs
# Synthetic fixture only. The executor user cannot traverse /protected.
RUN mkdir /protected && printf 'Lab 35 synthetic private fixture\n' > /protected/course-private.txt && chmod 700 /protected && chmod 600 /protected/course-private.txt && printf 'Lab 35 immutable fixture\n' > /opt/lab35/immutable.txt && chmod 444 /opt/lab35/immutable.txt
COPY --chmod=755 entrypoint.sh /usr/local/bin/lab35-entrypoint
USER node
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/lab35-entrypoint"]
