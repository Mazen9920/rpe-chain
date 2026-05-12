import { ScrollView, View, StyleSheet } from 'react-native';
import {
  Text,
  ActivityIndicator,
  Divider,
  DataTable,
  Chip,
  useTheme,
  Surface,
} from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { supplierService } from '../../src/services';

export default function SupplierDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();

  const { data: supplier, isLoading } = useQuery({
    queryKey: ['supplier', id],
    queryFn: () => supplierService.getById(id),
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!supplier) {
    return (
      <View style={styles.center}>
        <Text>Supplier not found.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <Surface style={styles.card} elevation={1}>
        <Text variant="headlineSmall">{supplier.name}</Text>
        <Text variant="bodyMedium" style={styles.muted}>
          {supplier.country} · {supplier.currency}
        </Text>
        <View style={styles.chipRow}>
          <Chip compact>{supplier.paymentTerms}</Chip>
          <Chip compact style={styles.chipGap}>{supplier.leadTimeDays}d lead time</Chip>
          {supplier.riskRating && (
            <Chip
              compact
              style={[
                styles.chipGap,
                {
                  backgroundColor:
                    supplier.riskRating === 'HIGH'
                      ? theme.colors.errorContainer
                      : supplier.riskRating === 'MEDIUM'
                      ? theme.colors.tertiaryContainer
                      : theme.colors.secondaryContainer,
                },
              ]}
            >
              {supplier.riskRating} risk
            </Chip>
          )}
        </View>
        {supplier.email && <Text variant="bodySmall">{supplier.email}</Text>}
        {supplier.phone && <Text variant="bodySmall">{supplier.phone}</Text>}
        {supplier.primaryContact && (
          <Text variant="bodySmall">Contact: {supplier.primaryContact}</Text>
        )}
      </Surface>

      {/* Linked Products */}
      <Text variant="titleMedium" style={styles.sectionTitle}>
        Linked Products
      </Text>
      <Surface style={styles.card} elevation={1}>
        {supplier.supplierProducts?.length === 0 ? (
          <Text style={styles.muted}>No linked products.</Text>
        ) : (
          supplier.supplierProducts?.map((sp: any) => (
            <View key={sp.id} style={styles.productRow}>
              <View style={{ flex: 1 }}>
                <Text variant="bodyMedium">{sp.product?.name ?? sp.supplierSku}</Text>
                <Text variant="bodySmall" style={styles.muted}>
                  SKU: {sp.product?.sku} · MOQ: {sp.moq} · Priority: {sp.priority}
                </Text>
              </View>
              <Text variant="bodyMedium">${Number(sp.agreedPrice).toFixed(2)}</Text>
              <Divider />
            </View>
          ))
        )}
      </Surface>

      {/* Performance History */}
      <Text variant="titleMedium" style={styles.sectionTitle}>
        Performance History
      </Text>
      <Surface style={[styles.card, { padding: 0 }]} elevation={1}>
        {supplier.performance?.length === 0 ? (
          <Text style={[styles.muted, { padding: 12 }]}>No performance records.</Text>
        ) : (
          <DataTable>
            <DataTable.Header>
              <DataTable.Title>Period</DataTable.Title>
              <DataTable.Title numeric>On-Time %</DataTable.Title>
              <DataTable.Title numeric>Fill %</DataTable.Title>
              <DataTable.Title numeric>Defect %</DataTable.Title>
            </DataTable.Header>
            {supplier.performance?.map((p: any) => (
              <DataTable.Row key={p.id}>
                <DataTable.Cell>
                  {new Date(p.periodStart).toLocaleDateString('en-US', {
                    month: 'short',
                    year: '2-digit',
                  })}
                </DataTable.Cell>
                <DataTable.Cell numeric>
                  {p.onTimeRate != null ? `${(p.onTimeRate * 100).toFixed(0)}%` : '—'}
                </DataTable.Cell>
                <DataTable.Cell numeric>
                  {p.fillRate != null ? `${(p.fillRate * 100).toFixed(0)}%` : '—'}
                </DataTable.Cell>
                <DataTable.Cell numeric>
                  {p.defectRate != null ? `${(p.defectRate * 100).toFixed(1)}%` : '—'}
                </DataTable.Cell>
              </DataTable.Row>
            ))}
          </DataTable>
        )}
      </Surface>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: 8, padding: 16, marginBottom: 12 },
  muted: { opacity: 0.6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, marginBottom: 4 },
  chipGap: { marginLeft: 6 },
  sectionTitle: { marginBottom: 8, marginTop: 4 },
  productRow: { marginBottom: 8 },
});
