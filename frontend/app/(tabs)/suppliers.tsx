import { FlatList, View, StyleSheet } from 'react-native';
import { Card, Text, FAB, ActivityIndicator, useTheme, Avatar } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { supplierService } from '../../src/services';

export default function SuppliersScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { data: suppliers, isLoading, refetch } = useQuery({
    queryKey: ['suppliers'],
    queryFn: supplierService.list,
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
      <FlatList
        data={suppliers ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        onRefresh={refetch}
        refreshing={isLoading}
        renderItem={({ item }) => (
          <Card style={styles.card} onPress={() => router.push(`/supplier/${item.id}`)}>
            <Card.Content style={styles.row}>
              <Avatar.Text size={40} label={item.name.slice(0, 2).toUpperCase()} />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text variant="titleSmall">{item.name}</Text>
                <Text variant="bodySmall" style={{ opacity: 0.6 }}>{item.contactName}</Text>
                <Text variant="bodySmall">{item.country} · {item.leadTimeDays}d lead time</Text>
              </View>
            </Card.Content>
          </Card>
        )}
      />
      <FAB
        icon="plus"
        style={[styles.fab, { backgroundColor: theme.colors.primary }]}
        onPress={() => router.push('/supplier/new')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 12, paddingBottom: 80 },
  card: { marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center' },
  fab: { position: 'absolute', right: 16, bottom: 16 },
});
