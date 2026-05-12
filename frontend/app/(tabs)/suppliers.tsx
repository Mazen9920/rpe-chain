import { useMemo, useState } from 'react';
import { FlatList, View, StyleSheet } from 'react-native';
import {
  Card,
  Text,
  FAB,
  ActivityIndicator,
  useTheme,
  Avatar,
  Searchbar,
  Menu,
  Button,
  Chip,
  Snackbar,
} from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { supplierService } from '../../src/services';

const PAGE_SIZE = 25;

interface Supplier {
  id: string;
  code: string;
  name: string;
  country?: string | null;
  currency: string;
  leadTimeDays: number;
  paymentTerms: string;
  primaryContact?: string | null;
  riskRating?: string | null;
}

export default function SuppliersScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState<string | undefined>(undefined);
  const [countryMenuOpen, setCountryMenuOpen] = useState(false);
  const [page, setPage] = useState(0);

  const { data, isLoading, isFetching, refetch, isError, error } = useQuery({
    queryKey: ['suppliers', { search, country, page }],
    queryFn: () =>
      supplierService.list({
        search: search.trim() || undefined,
        country,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    placeholderData: (prev) => prev,
  });

  const suppliers = (data?.data ?? []) as Supplier[];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const countries = useMemo(() => {
    const set = new Set<string>();
    suppliers.forEach((s) => s.country && set.add(s.country));
    return Array.from(set).sort();
  }, [suppliers]);

  const handleSearch = (v: string) => {
    setSearch(v);
    setPage(0);
  };

  const handleCountrySelect = (c: string | undefined) => {
    setCountry(c);
    setCountryMenuOpen(false);
    setPage(0);
  };

  const riskColor = (r?: string | null) => {
    if (r === 'HIGH') return theme.colors.errorContainer;
    if (r === 'MEDIUM') return theme.colors.tertiaryContainer;
    if (r === 'LOW') return theme.colors.secondaryContainer;
    return undefined;
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Toolbar */}
      <View style={styles.toolbar}>
        <Searchbar
          placeholder="Search name or code"
          value={search}
          onChangeText={handleSearch}
          style={styles.searchbar}
        />
        <View style={styles.filterRow}>
          <Menu
            visible={countryMenuOpen}
            onDismiss={() => setCountryMenuOpen(false)}
            anchor={
              <Button
                mode="outlined"
                icon="filter-variant"
                onPress={() => setCountryMenuOpen(true)}
                compact
              >
                {country ?? 'All countries'}
              </Button>
            }
          >
            <Menu.Item onPress={() => handleCountrySelect(undefined)} title="All countries" />
            {countries.map((c) => (
              <Menu.Item key={c} onPress={() => handleCountrySelect(c)} title={c} />
            ))}
          </Menu>
          {(country || search) && (
            <Button
              mode="text"
              onPress={() => {
                setSearch('');
                handleCountrySelect(undefined);
              }}
              compact
            >
              Clear
            </Button>
          )}
        </View>
      </View>

      <FlatList
        data={suppliers}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        onRefresh={refetch}
        refreshing={isFetching && !isLoading}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text variant="titleMedium">No suppliers found</Text>
            <Text variant="bodySmall" style={styles.muted}>
              {search || country
                ? 'Try adjusting your search or filter.'
                : 'Tap the + button to add your first supplier.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Card style={styles.card} onPress={() => router.push(`/supplier/${item.id}`)}>
            <Card.Content style={styles.row}>
              <Avatar.Text size={40} label={item.name.slice(0, 2).toUpperCase()} />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <View style={styles.headerRow}>
                  <Text variant="titleSmall">{item.name}</Text>
                  {item.riskRating && (
                    <Chip
                      compact
                      style={[styles.riskChip, { backgroundColor: riskColor(item.riskRating) }]}
                    >
                      {item.riskRating}
                    </Chip>
                  )}
                </View>
                <Text variant="bodySmall" style={styles.muted}>
                  {item.code} · {item.country ?? '—'} · {item.currency}
                </Text>
                <Text variant="bodySmall">
                  {item.leadTimeDays}d lead · {item.paymentTerms}
                </Text>
              </View>
            </Card.Content>
          </Card>
        )}
        ListFooterComponent={
          total > PAGE_SIZE ? (
            <View style={styles.pager}>
              <Button
                mode="outlined"
                disabled={page === 0}
                onPress={() => setPage((p) => Math.max(0, p - 1))}
                compact
              >
                Prev
              </Button>
              <Text variant="bodySmall" style={styles.pagerLabel}>
                Page {page + 1} of {totalPages} · {total} total
              </Text>
              <Button
                mode="outlined"
                disabled={page + 1 >= totalPages}
                onPress={() => setPage((p) => p + 1)}
                compact
              >
                Next
              </Button>
            </View>
          ) : null
        }
      />

      <FAB
        icon="plus"
        style={[styles.fab, { backgroundColor: theme.colors.primary }]}
        onPress={() => router.push('/supplier/new')}
      />

      <Snackbar
        visible={isError}
        onDismiss={() => {}}
        duration={4000}
        action={{ label: 'Retry', onPress: () => refetch() }}
      >
        Failed to load suppliers: {(error as Error)?.message ?? 'Unknown error'}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  toolbar: { padding: 12, paddingBottom: 0 },
  searchbar: { marginBottom: 8 },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  list: { padding: 12, paddingBottom: 80 },
  card: { marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  riskChip: { marginLeft: 8 },
  muted: { opacity: 0.6 },
  empty: { alignItems: 'center', padding: 40, gap: 8 },
  fab: { position: 'absolute', right: 16, bottom: 16 },
  pager: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 8,
  },
  pagerLabel: { opacity: 0.7 },
});
