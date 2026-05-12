---
description: Instructions for the agent working on the RPE Chain web frontend (Developer 2 — pages, UI, state).
applyTo: "frontend/**"
---

# Frontend Agent — RPE Chain Supply OS (Web)

You are Developer 2. You own `frontend/`. Stack: **React 18 + Vite 5 + TypeScript + Tailwind CSS + React Router v6 + TanStack React Query v5 + Zustand v4**.

## Directory Structure

```
frontend/
├── index.html
├── vite.config.ts          ← proxies /api → http://localhost:3000
├── src/
│   ├── main.tsx
│   ├── App.tsx             ← router, QueryClientProvider
│   ├── index.css           ← @tailwind directives
│   ├── lib/api.ts          ← axios instance (reads token from Zustand)
│   ├── services/index.ts   ← all API call functions
│   ├── stores/authStore.ts ← Zustand JWT/user (persisted to localStorage)
│   ├── components/
│   │   ├── Layout.tsx      ← sidebar nav + <Outlet />
│   │   └── ProtectedRoute.tsx
│   └── pages/
│       ├── LoginPage.tsx
│       ├── DashboardPage.tsx
│       ├── InventoryPage.tsx
│       ├── SuppliersPage.tsx
│       ├── OrdersPage.tsx
│       └── ShipmentsPage.tsx
```

## Routing

Handled by React Router v6 in `App.tsx`:
- `/login` — public
- `/` — Dashboard (protected)
- `/inventory` — Inventory (protected)
- `/suppliers` — Suppliers (protected)
- `/orders` — Purchase Orders (protected)
- `/shipments` — Shipments (protected)

`ProtectedRoute` redirects to `/login` when no JWT token in store.

## API Contract

Vite proxies `/api/*` to `http://localhost:3000/api/*` — no CORS configuration needed. All calls use relative paths (`/api/...`).

### Key Response Shapes (master-plan aligned)

```ts
type Product = {
  id: string; sku: string; name: string; uom: string;
  reorderPoint: number; totalOnHand: number; isLowStock: boolean;
  category?: { name: string };
  stockLevels: { warehouseId: string; onHand: number; reserved: number }[];
};

type DashboardSummary = {
  totalProducts: number; lowStockProducts: number; totalSuppliers: number;
  pendingPOs: number; activeShipments: number; openAlerts: number;
  inventoryValuation: number;   // FIFO valuation
  activeCostLayers: number;
  recentMovements: StockMovement[];
};
```

### Available endpoints (see backend-agent doc for full catalog)
- `GET /dashboard/summary`
- `GET /products` — includes `totalOnHand`, `isLowStock`, `stockLevels[]`
- `GET /suppliers`
- `GET /purchase-orders`
- `POST /purchase-orders/:id/receive` — body: `{ warehouseId, lines: [{ poLineId, qty, lotNumber, expiry?, unitCost }] }`
- `GET /shipments`
- `POST /shipments` — body: `{ warehouseId, salesOrderId, lines: [{ productId, qty }] }` (triggers FIFO)
- `GET /inventory/warehouses`
- `GET /inventory/stock-levels?warehouseId=&productId=`
- `GET /inventory/lots?expiringInDays=30`
- `GET /inventory/valuation`
- `GET /inventory/movements?productId=&limit=50`

## Conventions

- **Data fetching**: TanStack Query `useQuery` / `useMutation`. No `fetch`/`axios` in components directly.
- **All API calls**: go through `src/services/index.ts`. No inline axios.
- **Global state**: Zustand in `src/stores/`. Do not add Redux or Context for shared state.
- **Styling**: Tailwind CSS utility classes. The palette in use: `slate-800` sidebar, `blue-600` active/primary, `slate-100` borders, `white` cards.
- **Tables**: use `<table>` with `divide-y divide-slate-100` rows and `hover:bg-slate-50`.
- **Skeleton loading**: `animate-pulse` divs while `isLoading` is true.
- **Status badges**: `px-2 py-0.5 rounded text-xs font-medium` with color-coded backgrounds.
- **Icons**: lucide-react only. Size 17–18 for nav, 15–16 for inline.
- **No inline styles**. No `style={{}}` unless Tailwind can't achieve it.

## Rules

1. **Never assume `product.currentStock`** — field doesn't exist. Use `product.totalOnHand`.
2. **Type-check before finishing**: `npx tsc --noEmit` — must be 0 errors.
3. **No backend code.** Don't touch `backend/**`. Request new endpoints by updating the API Contract section above.
4. Forms → React Hook Form + Zod when adding form pages.
5. Money display → `Number(value).toLocaleString()`. Show currency code beside values.
6. Dates → `new Date(isoString).toLocaleDateString()`.

## What This Agent Does NOT Touch
- `backend/**`
- Prisma schema, migrations, seeds
- `.github/copilot/backend-agent.instructions.md`

## Useful Commands
```bash
npm run dev           # → http://localhost:8080  (backend must be on :3000)
npx tsc --noEmit      # type check
npm run build         # production build
```
