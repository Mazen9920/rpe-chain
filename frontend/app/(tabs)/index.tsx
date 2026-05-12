import { ScrollView, View, StyleSheet } from 'react-native';
import { Text, Card, useTheme, ActivityIndicator, Chip } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { dashboardService } from '../../src/services';
import { useAuthStore } from '../../src/store/auth.store';

function StatCard({ title, value, icon, color }: { title: string; value: number | string; icon: string; color?: string }) {
  const theme = useTheme();
  return (
    <Card style={styles.statCard}>
      <Card.Content>
        <Text variant="bodySmall" style={{ opacity: 0.6 }}>{title}</Text>
        <Text variant="headlineMedium" style={{ color: color || theme.colors.primary, fontWeight: 'bold' }}>
          {value}
        </Text>
      </Card.Content>
    </Card>
  );
}

export default function DashboardScreen() {
  const user = useAuthStore((s) => s.user);
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: dashboardService.summary });

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text variant="titleLarge" style={styles.greeting}>
        Hello, {user?.name} 👋
      </Text>

      <View style={styles.grid}>
        <StatCard title="Total Products" value={data?.totalProducts ?? 0} icon="package" />
        <StatCard title="Low Stock Alerts" value={data?.lowStockProducts ?? 0} icon="alert" color="orange" />
        <StatCard
          title="Inventory Value (FIFO)"
          value={`$${Number(data?.inventoryValuation ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          icon="cash"
        />
        <StatCard title="Active Cost Layers" value={data?.activeCostLayers ?? 0} icon="layers" />
        <StatCard title="Active Suppliers" value={data?.totalSuppliers ?? 0} icon="truck" />
        <StatCard title="Pending Orders" value={data?.pendingPOs ?? 0} icon="clipboard" />
        <StatCard title="Active Shipments" value={data?.activeShipments ?? 0} icon="truck-delivery" />
        <StatCard title="Open Alerts" value={data?.openAlerts ?? 0} icon="bell" color="orange" />
      </View>

      <Text variant="titleMedium" style={styles.sectionTitle}>Recent Stock Movements</Text>
      {data?.recentMovements?.map((m: any) => (
        <Card key={m.id} style={styles.movementCard}>
          <Card.Content style={styles.movementRow}>
            <View>
              <Text variant="bodyMedium">{m.product.name}</Text>
              <Text variant="bodySmall" style={{ opacity: 0.6 }}>{m.product.sku}</Text>
            </View>
            <Chip
              mode="flat"
              compact
              style={{ backgroundColor: m.type === 'DISPATCHED' ? '#ff6b6b22' : '#51cf6622' }}
            >
              {m.type === 'DISPATCHED' ? '-' : '+'}{m.qty}
            </Chip>
          </Card.Content>
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  greeting: { fontWeight: 'bold', marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  statCard: { flex: 1, minWidth: '44%' },
  sectionTitle: { fontWeight: '600', marginTop: 8 },
  movementCard: { marginBottom: 6 },
  movementRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
