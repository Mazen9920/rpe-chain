import { useEffect, useState } from 'react';
import { ScrollView, View, StyleSheet } from 'react-native';
import {
  TextInput,
  Button,
  Text,
  HelperText,
  ActivityIndicator,
  SegmentedButtons,
  Snackbar,
} from 'react-native-paper';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supplierService } from '../../../src/services';

interface SupplierForm {
  name: string;
  legalName: string;
  taxId: string;
  currency: string;
  country: string;
  leadTimeDays: string;
  paymentTerms: string;
  primaryContact: string;
  email: string;
  phone: string;
  riskRating: '' | 'LOW' | 'MEDIUM' | 'HIGH';
}

export default function EditSupplierScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: supplier, isLoading } = useQuery({
    queryKey: ['supplier', id],
    queryFn: () => supplierService.getById(id),
    enabled: !!id,
  });

  const [form, setForm] = useState<SupplierForm | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof SupplierForm, string>>>({});
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    if (supplier && !form) {
      setForm({
        name: supplier.name ?? '',
        legalName: supplier.legalName ?? '',
        taxId: supplier.taxId ?? '',
        currency: supplier.currency ?? 'USD',
        country: supplier.country ?? '',
        leadTimeDays: String(supplier.leadTimeDays ?? 7),
        paymentTerms: supplier.paymentTerms ?? 'NET30',
        primaryContact: supplier.primaryContact ?? '',
        email: supplier.email ?? '',
        phone: supplier.phone ?? '',
        riskRating: (supplier.riskRating ?? '') as SupplierForm['riskRating'],
      });
    }
  }, [supplier, form]);

  const set = (key: keyof SupplierForm) => (value: string) =>
    setForm((prev) => (prev ? { ...prev, [key]: value as any } : prev));

  const validate = (): boolean => {
    if (!form) return false;
    const e: Partial<Record<keyof SupplierForm, string>> = {};
    if (!form.name.trim()) e.name = 'Name is required';
    if (!form.country.trim()) e.country = 'Country is required';
    const lead = Number(form.leadTimeDays);
    if (!form.leadTimeDays || !Number.isInteger(lead) || lead < 1) {
      e.leadTimeDays = 'Must be a positive integer';
    }
    if (form.currency && form.currency.length !== 3) {
      e.currency = 'Must be a 3-letter ISO code';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const mutation = useMutation({
    mutationFn: () => {
      const payload: any = {
        name: form!.name.trim(),
        legalName: form!.legalName.trim() || null,
        taxId: form!.taxId.trim() || null,
        currency: form!.currency.trim() || 'USD',
        country: form!.country.trim(),
        leadTimeDays: Number(form!.leadTimeDays),
        paymentTerms: form!.paymentTerms.trim() || 'NET30',
        primaryContact: form!.primaryContact.trim() || null,
        email: form!.email.trim() || null,
        phone: form!.phone.trim() || null,
      };
      if (form!.riskRating) payload.riskRating = form!.riskRating;
      return supplierService.update(id, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['supplier', id] });
      router.back();
    },
    onError: (err: any) => {
      setApiError(err?.response?.data?.error ?? 'Failed to update supplier');
    },
  });

  const handleSubmit = () => {
    if (!validate()) return;
    setApiError(null);
    mutation.mutate();
  };

  if (isLoading || !form) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text variant="headlineSmall" style={styles.title}>
        Edit Supplier
      </Text>

      <TextInput
        label="Name *"
        value={form.name}
        onChangeText={set('name')}
        mode="outlined"
        style={styles.input}
        error={!!errors.name}
      />
      <HelperText type="error" visible={!!errors.name}>{errors.name}</HelperText>

      <TextInput label="Legal name" value={form.legalName} onChangeText={set('legalName')} mode="outlined" style={styles.input} />
      <TextInput label="Tax ID" value={form.taxId} onChangeText={set('taxId')} mode="outlined" style={styles.input} />

      <TextInput
        label="Country *"
        value={form.country}
        onChangeText={set('country')}
        mode="outlined"
        style={styles.input}
        error={!!errors.country}
      />
      <HelperText type="error" visible={!!errors.country}>{errors.country}</HelperText>

      <TextInput
        label="Lead Time (days) *"
        value={form.leadTimeDays}
        onChangeText={set('leadTimeDays')}
        mode="outlined"
        keyboardType="numeric"
        style={styles.input}
        error={!!errors.leadTimeDays}
      />
      <HelperText type="error" visible={!!errors.leadTimeDays}>{errors.leadTimeDays}</HelperText>

      <TextInput
        label="Payment Terms"
        value={form.paymentTerms}
        onChangeText={set('paymentTerms')}
        mode="outlined"
        style={styles.input}
        placeholder="NET30"
      />

      <TextInput
        label="Currency"
        value={form.currency}
        onChangeText={set('currency')}
        mode="outlined"
        autoCapitalize="characters"
        maxLength={3}
        style={styles.input}
        error={!!errors.currency}
      />
      <HelperText type="error" visible={!!errors.currency}>{errors.currency}</HelperText>

      <Text variant="bodySmall" style={styles.label}>Risk rating</Text>
      <SegmentedButtons
        value={form.riskRating}
        onValueChange={(v) => set('riskRating')(v)}
        buttons={[
          { value: '', label: 'None' },
          { value: 'LOW', label: 'Low' },
          { value: 'MEDIUM', label: 'Medium' },
          { value: 'HIGH', label: 'High' },
        ]}
        style={styles.input}
      />

      <TextInput label="Primary Contact" value={form.primaryContact} onChangeText={set('primaryContact')} mode="outlined" style={styles.input} />
      <TextInput
        label="Email"
        value={form.email}
        onChangeText={set('email')}
        mode="outlined"
        keyboardType="email-address"
        autoCapitalize="none"
        style={styles.input}
      />
      <TextInput
        label="Phone"
        value={form.phone}
        onChangeText={set('phone')}
        mode="outlined"
        keyboardType="phone-pad"
        style={styles.input}
      />

      <Button
        mode="contained"
        onPress={handleSubmit}
        loading={mutation.isPending}
        disabled={mutation.isPending}
        style={styles.button}
        contentStyle={styles.buttonContent}
      >
        Save Changes
      </Button>
      <Button mode="text" onPress={() => router.back()} disabled={mutation.isPending}>
        Cancel
      </Button>

      <Snackbar visible={!!apiError} onDismiss={() => setApiError(null)} duration={4000}>
        {apiError}
      </Snackbar>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { marginBottom: 16 },
  input: { marginBottom: 4 },
  label: { marginBottom: 6, marginTop: 8, opacity: 0.6 },
  button: { marginTop: 16 },
  buttonContent: { paddingVertical: 6 },
});
