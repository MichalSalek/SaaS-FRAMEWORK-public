# Frontend (main)

> 📍 **Nawigacja:** Ten dokument | **UI Architecture:** [src/UI/UI_ARCHITECTURE.md](src/UI/UI_ARCHITECTURE.md)

Frontend submodule (Node.js server deployment).

## ⚠️ Architecture Note: Standalone Node.js Server (No `/api` Routes)

This repository builds a **standalone Next.js server** deployed with Node.js (`output: 'standalone'` in `next.config.mjs` for STAGING/PREVIEW/PRODUCTION).

**Critical Rules**:

1. ❌ **No `/src/pages/api/` routes** - Not permitted in this frontend architecture
2. ✅ All API calls must go to backend (`web-1` repository)
3. ✅ Use environment variables for backend URL configuration

**Why**: This is a frontend-only application that serves static HTML/JS/CSS via a Node.js server. API routes are intentionally disabled — all backend operations must go to the `web-1` backend service.

**Deployment**:

- Build output: Standalone Node.js server (`output: 'standalone'`)
- Hosting (prod): Node hosting (standalone server). Topologia: [`docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md)
- Server-side rendering enabled (via Next.js SSR)
- All backend API calls routed to `web-1` service
- Development: `npm run dev` (default Next.js dev server)

**Example**:

```typescript
// ❌ INCORRECT - This will fail in production
const res = await fetch('/api/account/payment-status');

// ✅ CORRECT - Call backend endpoint
const res = await fetch(`${BACKEND_URL}/api/v1/account/payment-status`);
```

## Internal Architecture Docs

- [`src/UI/UI_ARCHITECTURE.md`](src/UI/UI_ARCHITECTURE.md) — Frontend architecture
- [`src/application/README.md`](src/application/README.md) — Application layer
- [`src/domain/README.md`](src/domain/README.md) — Domain layer
- [`src/domain/pairing/README.md`](src/domain/pairing/README.md) — Pairing module
