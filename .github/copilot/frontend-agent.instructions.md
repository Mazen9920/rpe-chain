---
description: Instructions for the agent working on the RPE Chain mobile app (Developer 2 — screens, UI, state).
applyTo: "frontend/**"
---

# Frontend Agent — RPE Chain Supply OS

You are Developer 2. You own `frontend/`. Stack: **React Native + Expo SDK 51 + Expo Router 3 + React Native Paper + TanStack React Query + Zustand + TypeScript 5.3**.

## Architecture

```
frontend/
├── app/                      ← Expo Router file-based routes
│   ├── (auth)/login.tsx
│   ├── (tabs)/index.tsx      ← Dashboard
│   ├── (tabs)/inventory.tsx
│   ├── (tabs)/suppliers.tsx
│   ├── (tabs)/orders.tsx
│   └── (tabs)/shipments.tsx
├── src/
│   ├── services/index.ts     ← axios client + endpoint functions
│   ├── stores/authStore.ts   ← Zustand JWT/user
│   ├── components/           ← shared UI
│   └── theme.ts
└── app.json, package.json
```

## Backend API Contract

Base URL: `http://localhost:3000/api` (set in `src/services/index.ts`). All endpoints require JWT bearer except `/auth/login` and `/auth/register`.

### Key Response Shapes (master-plan aligned)

```ts
// Product — NO `currentStock` field. Stock lives in stockLevels[].
type Product = {
  id: string; sku: string; name: string; uom: string;
  reorderPoint: number; categoryId: string;
  stockLevels: { warehouseId: string; onHand: number; reserved: number; warehouse: { code: string } }[];
  totalOnHand: number;       // computed by API
  isLowStock: boolean;       // computed by API
};

type DashboardSummary = {
  totalProducts: number;
  lowStockProducts: number;
  totalSuppliers: number;
  pendingPOs: number;
  activeShipments: number;
  openAlerts: number;
  inventoryValuation: number;   // FIFO valuation in functional currency
  activeCostLayers: number;
  recentMovements: StockMovement[];
};

type Lot = { id: string; lotNumber: string; productId: string; expiry: string | null; qtyOnHand: number; certifications: string[] };
type StockLevel = { id: string; productId: string; warehouseId: string; onHand: number; reserved: number; product: Product; warehouse: Warehouse };
type Warehouse = { id: string; code: string; name: string; country: string; currency: string };
```

### Endpoints to call (see backend-agent doc for full catalog)
- `GET /dashboard/summary`
- `GET /products`, `GET /products/low-stock`
- `GET /suppliers`
- `GET /purchase-orders`
- `POST /purchase-orders/:id/receive` body: `{ warehouseId, lines: [{ poLineId, qty, lotNumber, expiry?, unitCost }] }`
- `GET /shipments`
- `POST /shipments` body: `{ warehouseId, salesOrderId, lines: [{ productId, qty }] }`  ← triggers FIFO
- `GET /inventory/warehouses`
- `GET /inventory/stock-levels?warehouseId=&productId=`
- `GET /inventory/lots?expiringInDays=30`
- `GET /inventory/valuation`
- `GET /inventory/movements?productId=&limit=50`

## Conventions
- Data fetching: **TanStack Query** (`useQuery` / `useMutation`). Don't `fetch` from components directly.
- Global state: **Zustand** stores in `src/stores/`. Currently just `authStore`.
- UI: **React Native Paper** primitives + theme from `src/theme.ts`. Avoid raw `StyleSheet` for one-off colors — extend the theme.
- Forms: React Hook Form + Zod (when forms are added).
- Lists: `FlatList` with `keyExtractor={(item) => item.id}`.
- Money/qty display: `Intl.NumberFormat`. Show currency on warehouse-scoped views.
- All API calls go through `src/services/index.ts`. No inline axios.

## Screens to build / refine

| Screen | Purpose |
|---|---|
| Dashboard | KPI cards: products, low-stock, FIFO valuation, active layers, open POs, shipments, alerts |
| Inventory | Tabs: Products · Stock by Warehouse · Lots (with expiry badges) · Movements feed |
| Suppliers | List + detail + performance score |
| Orders | POs + Sales Orders, with status chips, receive action |
| Shipments | List + create (multi-line, picks warehouse + SO) |

## Rules

1. **Never assume `product.currentStock`** — it doesn't exist. Use `product.totalOnHand` or sum `stockLevels`.
2. **Low stock is API-computed** (`product.isLowStock`); don't recompute on the client unless API doesn't provide.
3. **Optimistic mutations** with React Query rollback when relevant (e.g., toggling alerts).
4. **JWT goes in axios default headers** after login — see `services/index.ts` interceptor.
5. **No backend code.** Don't touch `backend/**`. Request endpoints from Developer 1 by updating this file's API Contract section.
6. **Type-check before commit**: `npx tsc --noEmit` — must be 0 errors.

## What This Agent Does NOT Touch
- `backend/**` (Developer 1's domain)
- Prisma schema, migrations, seed
- `.github/copilot/backend-agent.instructions.md`

## Useful Commands
```bash
npx expo start                # dev server
npx expo start --ios          # iOS simulator
npx expo start --android      # Android emulator
npx tsc --noEmit              # type check
```
