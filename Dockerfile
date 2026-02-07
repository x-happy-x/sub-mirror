FROM tindy2013/subconverter:latest

WORKDIR /app

RUN if command -v apk >/dev/null 2>&1; then \
      apk add --no-cache nodejs-current || apk add --no-cache nodejs; \
    elif command -v apt-get >/dev/null 2>&1; then \
      apt-get update && apt-get install -y --no-install-recommends nodejs && rm -rf /var/lib/apt/lists/*; \
    else \
      echo "No supported package manager found to install Node.js" && exit 1; \
    fi \
    && if [ -f /base/pref.example.toml ]; then \
      cp /base/pref.example.toml /base/pref.toml; \
      sed -i 's/^listen = .*/listen = \"0.0.0.0\"/' /base/pref.toml; \
      sed -i 's/^port = .*/port = 8787/' /base/pref.toml; \
    fi

COPY app/package.json ./package.json
COPY app/server.js ./server.js
COPY entrypoint.sh /entrypoint.sh

ENV APP_PORT=8788 \
    SUBCONVERTER_PORT=8787 \
    CONVERTER_URL=http://127.0.0.1:8787/sub \
    SOURCE_URL=http://127.0.0.1:8788/source.txt \
    USE_CONVERTER=1

EXPOSE 8788 8787

ENTRYPOINT ["/entrypoint.sh"]
