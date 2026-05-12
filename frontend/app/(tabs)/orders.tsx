import { FlatList, View, StyleSheet } from 'react-native';
import { Card, Text, Chip, FAB, ActivityIndicator, useTheme, SegmentedButtons } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { purchaseOrderService } from '../../src/services';

const STATUS_COLOR: Record<string, string> = {
  DRAFT: '#868e96',
  SENT: '#339af0',
  PARTIALLY_RECEIVED: '#f59f00',
  RECEIVED: '#40c057',
  CANCELLED: '#fa5252',
};

export default function OrdersScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [filter, setFilter] = useState('');

  const { data: orders, isLoading, refetch } = useQuery({
    queryKey: ['purchase-orders', filter],
    queryFn: () => purchaseOrderService.list(filter ? { status: filter } : {}),
  });

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SegmentedButtons
        value={filter}
        onValueChange={setFilter}
        style={styles.filter}
        buttons={[
          { value: '', label: 'All' },
          { value: 'DRAFT', label: 'Draft' },
          { value: 'SENT', label: 'Sent' },
          { value: 'RECEIVED', label: 'Done' },
        ]}
      />
      <FlatList
        data={orders ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        onRefresh={refetch}
        refreshing={isLoading}
        renderItem={({ item }) => (
          <Card style={styles.card} onPress={() => router.push(`/order/${item.id}`)}>
            <Card.Content style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text variant="titleSmall">{item.poNumber}</Text>
                <Text variant="bodySmall" style={{ opacity: 0.6 }}>{item.supplier?.name}</Text>
                <Text variant="bodySmall">${Number(item.totalAmount).toFixed(2)}</Text>
              </View>
              <Chip
                compact
                style={{ backgroundColor: (STATUS_COLOR[item.status] || '#aaa') + '33' }}
                textStyle={{ color: STATUS_COLOR[item.status] || '#aaa' }}
              >
                {item.status.replace('_', ' ')}
              </Chip>
            </Card.Content>
          </Card>
        )}
      />
      <FAB
        icon="plus"
        style={[styles.fab, { backgroundColor: theme.colors.primary }]}
        onPress={() => router.push('/order/new')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  filter: { margin: 12 },
  list: { paddingHorizontal: 12, paddingBottom: 80 },
  card: { marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fab: { position: 'absolute', right: 16, bottom: 16 },
});
