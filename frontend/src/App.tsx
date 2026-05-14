import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import InventoryPage from './pages/InventoryPage';
import ManufacturingPage from './pages/ManufacturingPage';
import SuppliersPage from './pages/SuppliersPage';
import SupplierDetailPage from './pages/SupplierDetailPage';
import OrdersPage from './pages/OrdersPage';
import PurchaseOrderDetailPage from './pages/PurchaseOrderDetailPage';
import GoodsReceiptsPage from './pages/GoodsReceiptsPage';
import GoodsReceiptDetailPage from './pages/GoodsReceiptDetailPage';
import ShipmentsPage from './pages/ShipmentsPage';
import ShipmentDetailPage from './pages/ShipmentDetailPage';
import CustomersPage from './pages/CustomersPage';
import CustomerDetailPage from './pages/CustomerDetailPage';
import SalesOrdersPage from './pages/SalesOrdersPage';
import SalesOrderDetailPage from './pages/SalesOrderDetailPage';
import AccountsPayablePage from './pages/AccountsPayablePage';
import SupplierInvoiceDetailPage from './pages/SupplierInvoiceDetailPage';
import PaymentDetailPage from './pages/PaymentDetailPage';
import AlertsPage from './pages/AlertsPage';
import ReportsPage from './pages/ReportsPage';
import NotificationSettingsPage from './pages/NotificationSettingsPage';
import FxSettingsPage from './pages/FxSettingsPage';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/inventory" element={<InventoryPage />} />
              <Route path="/manufacturing" element={<ManufacturingPage />} />
              <Route path="/suppliers" element={<SuppliersPage />} />
              <Route path="/suppliers/:id" element={<SupplierDetailPage />} />
              <Route path="/orders" element={<OrdersPage />} />
              <Route path="/orders/:id" element={<PurchaseOrderDetailPage />} />
              <Route path="/goods-receipts" element={<GoodsReceiptsPage />} />
              <Route path="/goods-receipts/:id" element={<GoodsReceiptDetailPage />} />
              <Route path="/ap" element={<AccountsPayablePage />} />
              <Route path="/ap/invoices/:id" element={<SupplierInvoiceDetailPage />} />
              <Route path="/ap/payments/:id" element={<PaymentDetailPage />} />
              <Route path="/shipments" element={<ShipmentsPage />} />
              <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
              <Route path="/customers" element={<CustomersPage />} />
              <Route path="/customers/:id" element={<CustomerDetailPage />} />
              <Route path="/sales-orders" element={<SalesOrdersPage />} />
              <Route path="/sales-orders/:id" element={<SalesOrderDetailPage />} />
              <Route path="/alerts" element={<AlertsPage />} />
              <Route path="/notifications" element={<NotificationSettingsPage />} />
              <Route path="/settings/fx" element={<FxSettingsPage />} />
              <Route path="/reports" element={<ReportsPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
