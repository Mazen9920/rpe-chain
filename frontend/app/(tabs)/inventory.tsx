import { useState } from 'react';
import { FlatList, View, StyleSheet } from 'react-native';
import { Searchbar, Card, Text, Chip, FAB, ActivityIndicator, useTheme } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { productService } from '../../src/services';

export default function InventoryScreen() {
  const [search, setSearch] = useState('');
  const router = useRouter();
  const theme = useTheme();

  const { data: products, isLoading, refetch } = useQuery({
    queryKey: ['products', search],
    queryFn: () => productService.list({ search: search || undefined }),
  });

  const filtered = products ?? [];

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Searchbar
        placeholder="Search products..."
        value={search}
        onChangeText={setSearch}
        style={styles.search}
      />
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        onRefresh={refetch}
        refreshing={isLoading}
        renderItem={({ item }) => (
          <Card
            style={styles.card}
            onPress={() => router.push(`/product/${item.id}`)}
          >
            <Card.Content style={styles.cardRow}>
              <View style={{ flex: 1 }}>
                <Text variant="titleSmall">{item.name}</Text>
                <Text variant="bodySmall" style={{ opacity: 0.6 }}>{item.sku}</Text>
                <Text variant="bodySmall">{item.category?.name}</Text>
              </View>
              <View style={styles.stockInfo}>
                <Chip
                  mode="flat"
                  compact
                  style={{
                    backgroundColor: item.isLowStock ? '#ff6b6b33' : '#51cf6633',
                  }}
                >
                  {item.totalOnHand ?? 0} {item.uom}
                </Chip>
                {item.isLowStock && (
                  <Text variant="labelSmall" style={{ color: 'orange', marginTop: 4 }}>
                    Low Stock
                  </Text>
                )}
              </View>
            </Card.Content>
          </Card>
        )}
      />
      <FAB
        icon="plus"
        style={[styles.fab, { backgroundColor: theme.colors.primary }]}
        onPress={() => router.push('/product/new')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  search: { margin: 12 },
  list: { paddingHorizontal: 12, paddingBottom: 80 },
  card: { marginBottom: 8 },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between' },
  stockInfo: { alignItems: 'flex-end' },
  fab: { position: 'absolute', right: 16, bottom: 16 },
});
