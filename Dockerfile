FROM tindy2013/subconverter:latest

WORKDIR /app

RUN if command -v apk >/dev/null 2>&1; then \
      apk add --no-cache nodejs-current npm || apk add --no-cache nodejs npm; \
    elif command -v apt-get >/dev/null 2>&1; then \
      apt-get update && apt-get install -y --no-install-recommends nodejs npm && rm -rf /var/lib/apt/lists/*; \
    else \
      echo "No supported package manager found to install Node.js" && exit 1; \
    fi \
    && if [ -f /base/pref.example.toml ]; then \
      cp /base/pref.example.toml /base/pref.toml; \
      sed -i 's/^listen = .*/listen = \"0.0.0.0\"/' /base/pref.toml; \
      sed -i 's/^port = .*/port = 8787/' /base/pref.toml; \
    fi

COPY app/package.json ./package.json
COPY app/package-lock.json ./package-lock.json
RUN npm install
COPY app/*.js ./
COPY app/bin ./bin
COPY resources/ua-catalog.json /resources/ua-catalog.json
COPY resources/admin.json /resources/admin.json
COPY resources/apps.yml /resources/apps.yml
COPY resources/app-guides /resources/app-guides
COPY frontend/package.json /frontend/package.json
COPY frontend/package-lock.json /frontend/package-lock.json
COPY frontend/vendor /frontend/vendor
RUN cd /frontend && npm install
COPY frontend /frontend
RUN cd /frontend && npm run build && cp -r dist /app/frontend-dist
COPY entrypoint.sh /entrypoint.sh

ENV APP_PORT=8788 \
    SUBCONVERTER_PORT=8787 \
    CONVERTER_URL=http://127.0.0.1:8787/sub \
    SOURCE_URL=http://127.0.0.1:8788/source.txt \
    ADMIN_SEED_PATH=/resources/admin.json \
    USE_CONVERTER=1

EXPOSE 8788 8787

ENTRYPOINT ["/entrypoint.sh"]
