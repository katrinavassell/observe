FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY server ./server
ENV NODE_ENV=production
RUN addgroup --system app && adduser --system --ingroup app app
USER app
EXPOSE 3000
CMD ["npx", "tsx", "server/index.ts"]
