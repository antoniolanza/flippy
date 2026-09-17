FROM node:20-alpine
WORKDIR /app
COPY server.js ./
COPY public ./public
ENV PORT=3080
EXPOSE 3080
USER node
CMD ["node", "server.js"]
