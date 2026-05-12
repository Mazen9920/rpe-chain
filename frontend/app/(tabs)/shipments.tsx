import { FlatList, View, StyleSheet } from 'react-native';
import { Card, Text, Chip, FAB, ActivityIndicator, useTheme, SegmentedButtons } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { shipmentService } from '../../src/services';

const STATUS_COLOR: Record<string, string> = {
  PENDING: '#868e96',
  IN_TRANSIT: '#339af0',
  OUT_FOR_DELIVERY: '#f59f00',
  DELIVERED: '#40c057',
  FAILED: '#fa5252',
};

export default function ShipmentsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [filter, setFilter] = useState('');

  const { data: shipments, isLoading, refetch } = useQuery({
    queryKey: ['shipments', filter],
    queryFn: () => shipmentService.list(filter ? { status: filter } : {}),
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
          { value: 'IN_TRANSIT', label: 'In Transit' },
          { value: 'DELIVERED', label: 'Delivered' },
        ]}
      />
      <FlatList
        data={shipments ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        onRefresh={refetch}
        refreshing={isLoading}
        renderItem={({ item }) => (
          <Card style={styles.card} onPress={() => router.push(`/shipment/${item.id}`)}>
            <Card.Content style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text variant="titleSmall">{item.shipmentNumber}</Text>
                <Text variant="bodySmall" style={{ opacity: 0.6 }}>
                  {item.carrier} {item.trackingNumber ? `· ${item.trackingNumber}` : ''}
                </Text>
              </View>
              <Chip
                compact
                style={{ backgroundColor: (STATUS_COLOR[item.status] || '#aaa') + '33' }}
                textStyle={{ color: STATUS_COLOR[item.status] || '#aaa' }}
              >
                {item.status.replace(/_/g, ' ')}
              </Chip>
            </Card.Content>
          </Card>
        )}
      />
      <FAB
        icon="plus"
        style={[styles.fab, { backgroundColor: theme.colors.primary }]}
        onPress={() => router.push('/shipment/new')}
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
