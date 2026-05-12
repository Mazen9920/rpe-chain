import { useState } from 'react';
import { ScrollView, View, StyleSheet } from 'react-native';
import {
  Text,
  ActivityIndicator,
  Divider,
  DataTable,
  Chip,
  useTheme,
  Surface,
  SegmentedButtons,
  Button,
  Portal,
  Modal,
  TextInput,
  HelperText,
  Dialog,
  Snackbar,
  IconButton,
} from 'react-native-paper';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Svg, { Polyline, Circle } from 'react-native-svg';
import { supplierService } from '../../src/services';

function Sparkline({ values, color = '#1976d2', width = 220, height = 40 }: { values: number[]; color?: string; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`)
    .join(' ');
  const lastX = (values.length - 1) * step;
  const lastY = height - ((values[values.length - 1] - min) / range) * height;
  return (
    <Svg width={width} height={height}>
      <Polyline points={points} fill="none" stroke={color} strokeWidth={2} />
      <Circle cx={lastX} cy={lastY} r={3} fill={color} />
    </Svg>
  );
}

type Tab = 'overview' | 'products' | 'performance';

interface PerformanceForm {
  periodStart: string;
  periodEnd: string;
  onTimeRate: string;
  fillRate: string;
  defectRate: string;
  leadTimeMean: string;
  leadTimeStd: string;
}

const EMPTY_PERF: PerformanceForm = {
  periodStart: '',
  periodEnd: '',
  onTimeRate: '',
  fillRate: '',
  defectRate: '',
  leadTimeMean: '',
  leadTimeStd: '',
};

export default function SupplierDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<Tab>('overview');
  const [perfModal, setPerfModal] = useState(false);
  const [perfForm, setPerfForm] = useState<PerformanceForm>(EMPTY_PERF);
  const [perfError, setPerfError] = useState<string | null>(null);
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [snackMsg, setSnackMsg] = useState<string | null>(null);

  const { data: supplier, isLoading } = useQuery({
    queryKey: ['supplier', id],
    queryFn: () => supplierService.getById(id),
    enabled: !!id,
  });

  const recordMutation = useMutation({
    mutationFn: (payload: object) => supplierService.recordPerformance(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier', id] });
      setPerfModal(false);
      setPerfForm(EMPTY_PERF);
      setPerfError(null);
      setSnackMsg('Performance recorded');
    },
    onError: (err: any) => {
      setPerfError(err?.response?.data?.error ?? 'Failed to record performance');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => supplierService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      router.back();
    },
    onError: (err: any) => {
      setSnackMsg(err?.response?.data?.error ?? 'Failed to delete supplier');
      setDeleteDialog(false);
    },
  });

  const validatePerfForm = (): { valid: boolean; payload?: object; error?: string } => {
    if (!perfForm.periodStart || !perfForm.periodEnd) {
      return { valid: false, error: 'Period start and end are required' };
    }
    const ps = new Date(perfForm.periodStart);
    const pe = new Date(perfForm.periodEnd);
    if (isNaN(ps.getTime()) || isNaN(pe.getTime())) {
      return { valid: false, error: 'Dates must be in YYYY-MM-DD format' };
    }
    if (pe <= ps) {
      return { valid: false, error: 'Period end must be after period start' };
    }

    const parseRate = (s: string, name: string): number | null | string => {
      if (!s.trim()) return null;
      const n = Number(s);
      if (isNaN(n) || n < 0 || n > 1) return `${name} must be a number between 0 and 1`;
      return n;
    };
    const parseNonNeg = (s: string, name: string): number | null | string => {
      if (!s.trim()) return null;
      const n = Number(s);
      if (isNaN(n) || n < 0) return `${name} must be a non-negative number`;
      return n;
    };

    const fields: Record<string, number | null | string> = {
      onTimeRate: parseRate(perfForm.onTimeRate, 'On-time rate'),
      fillRate: parseRate(perfForm.fillRate, 'Fill rate'),
      defectRate: parseRate(perfForm.defectRate, 'Defect rate'),
      leadTimeMean: parseNonNeg(perfForm.leadTimeMean, 'Lead time mean'),
      leadTimeStd: parseNonNeg(perfForm.leadTimeStd, 'Lead time std'),
    };
    for (const [, v] of Object.entries(fields)) {
      if (typeof v === 'string') return { valid: false, error: v };
    }

    const payload: any = {
      periodStart: ps.toISOString(),
      periodEnd: pe.toISOString(),
    };
    for (const [k, v] of Object.entries(fields)) {
      if (v != null) payload[k] = v;
    }
    return { valid: true, payload };
  };

  const submitPerformance = () => {
    const r = validatePerfForm();
    if (!r.valid) {
      setPerfError(r.error ?? 'Invalid input');
      return;
    }
    recordMutation.mutate(r.payload!);
  };

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
    <View style={{ flex: 1 }}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Header */}
        <Surface style={styles.card} elevation={1}>
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text variant="headlineSmall">{supplier.name}</Text>
              <Text variant="bodySmall" style={styles.muted}>
                {supplier.code}
              </Text>
            </View>
            <IconButton
              icon="pencil"
              onPress={() => router.push(`/supplier/edit/${id}`)}
              accessibilityLabel="Edit supplier"
            />
            <IconButton
              icon="delete"
              iconColor={theme.colors.error}
              onPress={() => setDeleteDialog(true)}
              accessibilityLabel="Delete supplier"
            />
          </View>
          <View style={styles.chipRow}>
            <Chip compact>{supplier.paymentTerms}</Chip>
            <Chip compact style={styles.chipGap}>{supplier.leadTimeDays}d lead</Chip>
            <Chip compact style={styles.chipGap}>{supplier.currency}</Chip>
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
        </Surface>

        <SegmentedButtons
          value={tab}
          onValueChange={(v) => setTab(v as Tab)}
          buttons={[
            { value: 'overview', label: 'Overview' },
            { value: 'products', label: 'Products' },
            { value: 'performance', label: 'Performance' },
          ]}
          style={styles.tabs}
        />

        {tab === 'overview' && (
          <Surface style={styles.card} elevation={1}>
            <Row label="Country" value={supplier.country} />
            <Row label="Legal name" value={supplier.legalName} />
            <Row label="Tax ID" value={supplier.taxId} />
            <Row label="Primary contact" value={supplier.primaryContact} />
            <Row label="Email" value={supplier.email} />
            <Row label="Phone" value={supplier.phone} />
            <Row label="Status" value={supplier.isActive ? 'Active' : 'Inactive'} />
          </Surface>
        )}

        {tab === 'products' && (
          <Surface style={styles.card} elevation={1}>
            {supplier.supplierProducts?.length === 0 ? (
              <Text style={styles.muted}>No linked products.</Text>
            ) : (
              supplier.supplierProducts?.map((sp: any, idx: number) => (
                <View key={sp.id}>
                  <View style={styles.productRow}>
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyMedium">{sp.product?.name ?? sp.supplierSku}</Text>
                      <Text variant="bodySmall" style={styles.muted}>
                        SKU: {sp.product?.sku} · MOQ: {sp.moq} · Priority: {sp.priority}
                      </Text>
                    </View>
                    <Text variant="bodyMedium">${Number(sp.agreedPrice).toFixed(2)}</Text>
                  </View>
                  {idx < supplier.supplierProducts.length - 1 && <Divider />}
                </View>
              ))
            )}
          </Surface>
        )}

        {tab === 'performance' && (
          <>
            <View style={styles.perfHeader}>
              <Text variant="titleSmall">Last 12 periods</Text>
              <Button
                mode="contained"
                icon="plus"
                onPress={() => {
                  setPerfError(null);
                  setPerfModal(true);
                }}
                compact
              >
                Record
              </Button>
            </View>
            <Surface style={[styles.card, { padding: 0 }]} elevation={1}>
              {supplier.performance?.length === 0 ? (
                <Text style={[styles.muted, { padding: 16 }]}>No performance records yet.</Text>
              ) : (
                <>
                  {(() => {
                    const series = (supplier.performance ?? [])
                      .slice(0, 12)
                      .reverse()
                      .map((p: any) => (p.onTimeRate != null ? Number(p.onTimeRate) : null))
                      .filter((v: number | null): v is number => v != null);
                    return series.length >= 2 ? (
                      <View style={styles.sparkWrap}>
                        <Text variant="bodySmall" style={styles.muted}>
                          On-time rate trend
                        </Text>
                        <Sparkline values={series} color={theme.colors.primary} />
                      </View>
                    ) : null;
                  })()}
                  <DataTable>
                  <DataTable.Header>
                    <DataTable.Title>Period</DataTable.Title>
                    <DataTable.Title numeric>On-Time</DataTable.Title>
                    <DataTable.Title numeric>Fill</DataTable.Title>
                    <DataTable.Title numeric>Defect</DataTable.Title>
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
                </>
              )}
            </Surface>
          </>
        )}
      </ScrollView>

      <Portal>
        <Modal
          visible={perfModal}
          onDismiss={() => setPerfModal(false)}
          contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.background }]}
        >
          <ScrollView>
            <Text variant="titleLarge" style={{ marginBottom: 16 }}>
              Record Performance
            </Text>
            <TextInput
              label="Period start (YYYY-MM-DD) *"
              value={perfForm.periodStart}
              onChangeText={(v) => setPerfForm((f) => ({ ...f, periodStart: v }))}
              mode="outlined"
              style={styles.input}
              placeholder="2026-01-01"
            />
            <TextInput
              label="Period end (YYYY-MM-DD) *"
              value={perfForm.periodEnd}
              onChangeText={(v) => setPerfForm((f) => ({ ...f, periodEnd: v }))}
              mode="outlined"
              style={styles.input}
              placeholder="2026-01-31"
            />
            <TextInput
              label="On-time rate (0–1)"
              value={perfForm.onTimeRate}
              onChangeText={(v) => setPerfForm((f) => ({ ...f, onTimeRate: v }))}
              mode="outlined"
              keyboardType="decimal-pad"
              style={styles.input}
            />
            <TextInput
              label="Fill rate (0–1)"
              value={perfForm.fillRate}
              onChangeText={(v) => setPerfForm((f) => ({ ...f, fillRate: v }))}
              mode="outlined"
              keyboardType="decimal-pad"
              style={styles.input}
            />
            <TextInput
              label="Defect rate (0–1)"
              value={perfForm.defectRate}
              onChangeText={(v) => setPerfForm((f) => ({ ...f, defectRate: v }))}
              mode="outlined"
              keyboardType="decimal-pad"
              style={styles.input}
            />
            <TextInput
              label="Lead time mean (days)"
              value={perfForm.leadTimeMean}
              onChangeText={(v) => setPerfForm((f) => ({ ...f, leadTimeMean: v }))}
              mode="outlined"
              keyboardType="decimal-pad"
              style={styles.input}
            />
            <TextInput
              label="Lead time std (days)"
              value={perfForm.leadTimeStd}
              onChangeText={(v) => setPerfForm((f) => ({ ...f, leadTimeStd: v }))}
              mode="outlined"
              keyboardType="decimal-pad"
              style={styles.input}
            />
            {perfError && (
              <HelperText type="error" visible>
                {perfError}
              </HelperText>
            )}
            <View style={styles.modalActions}>
              <Button mode="text" onPress={() => setPerfModal(false)} disabled={recordMutation.isPending}>
                Cancel
              </Button>
              <Button
                mode="contained"
                onPress={submitPerformance}
                loading={recordMutation.isPending}
                disabled={recordMutation.isPending}
              >
                Save
              </Button>
            </View>
          </ScrollView>
        </Modal>
      </Portal>

      <Portal>
        <Dialog visible={deleteDialog} onDismiss={() => setDeleteDialog(false)}>
          <Dialog.Title>Delete supplier?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              This will soft-delete {supplier.name}. It can be restored from audit history.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDeleteDialog(false)} disabled={deleteMutation.isPending}>
              Cancel
            </Button>
            <Button
              onPress={() => deleteMutation.mutate()}
              loading={deleteMutation.isPending}
              disabled={deleteMutation.isPending}
              textColor={theme.colors.error}
            >
              Delete
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar visible={!!snackMsg} onDismiss={() => setSnackMsg(null)} duration={3000}>
        {snackMsg}
      </Snackbar>
    </View>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <View style={styles.kvRow}>
      <Text variant="bodySmall" style={styles.kvLabel}>
        {label}
      </Text>
      <Text variant="bodyMedium" style={styles.kvValue}>
        {value || '—'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: 8, padding: 16, marginBottom: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start' },
  muted: { opacity: 0.6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  chipGap: { marginLeft: 6, marginBottom: 4 },
  tabs: { marginBottom: 12 },
  productRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  kvRow: { flexDirection: 'row', paddingVertical: 6 },
  kvLabel: { width: 130, opacity: 0.6 },
  kvValue: { flex: 1 },
  perfHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  modal: { margin: 16, padding: 20, borderRadius: 8, maxHeight: '90%' },
  input: { marginBottom: 8 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12 },
  sparkWrap: { padding: 16, alignItems: 'flex-start' },
});
