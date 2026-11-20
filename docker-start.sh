#!/bin/sh
# 영구 디스크에 저장 폴더를 만들고, 서버는 root가 아닌 node 계정으로 실행해요
mkdir -p "$DATA_DIR" && chown -R node:node "$DATA_DIR" 2>/dev/null
exec su node -s /bin/sh -c "exec node /app/server.js"
