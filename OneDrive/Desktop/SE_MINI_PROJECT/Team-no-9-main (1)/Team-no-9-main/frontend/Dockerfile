FROM node:18-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build --if-present

FROM nginx:alpine
COPY --from=builder /app/build /usr/share/nginx/html 2>/dev/null || true
COPY --from=builder /app/dist /usr/share/nginx/html 2>/dev/null || true

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
