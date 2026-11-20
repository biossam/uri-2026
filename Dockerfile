# onpod (또는 다른 도커 서버)용 — 외부 패키지가 없어서 설치 단계가 없어요
FROM node:22-alpine
WORKDIR /app
# 글은 영구 디스크(/workspace)에 저장 → 잠들기·재시작·업데이트에도 남아요
ENV NODE_ENV=production PORT=3000 DATA_DIR=/workspace/data
COPY package.json server.js ./
COPY vendor ./vendor
COPY public ./public
COPY docker-start.sh /docker-start.sh
RUN chmod +x /docker-start.sh && chown -R node:node /app
EXPOSE 3000
HEALTHCHECK CMD wget -qO- http://localhost:3000/healthz || exit 1
CMD ["/docker-start.sh"]
