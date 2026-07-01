# social-media-scheduling-api

Multi-platform comment system for a social-media scheduling API. Built with
NestJS · MongoDB · @nestjs/mongoose · Jest.

> Design and execution plan live in [`ai/execution-plan.md`](ai/execution-plan.md).

## Getting started

```bash
npm install
cp .env.example .env   # then set MONGODB_URI / PORT
npm run dev            # start with watch mode
```

A MongoDB instance must be reachable at `MONGODB_URI`. For local development:

```bash
docker run -d --name sms-mongo -p 27017:27017 mongo:7
```

Health check: `GET /health` → `{ "status": "ok" }`.

## Scripts

| Script             | Purpose                          |
| ------------------ | -------------------------------- |
| `npm run build`    | Compile TypeScript to `dist/`    |
| `npm run dev`      | Start in watch mode              |
| `npm start`        | Start once                       |
| `npm run lint`     | ESLint (zero warnings allowed)   |
| `npm test`         | Unit tests (Jest)                |
| `npm run test:e2e` | End-to-end tests (supertest)     |

## Configuration

Environment variables are validated at boot (see `src/config/env.validation.ts`);
an invalid value fails fast with a clear message.

| Variable      | Default | Description                    |
| ------------- | ------- | ------------------------------ |
| `PORT`        | `3000`  | HTTP server port               |
| `MONGODB_URI` | —       | MongoDB connection string      |
