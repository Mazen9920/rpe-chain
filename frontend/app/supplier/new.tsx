import { useState } from 'react';
import { ScrollView, View, StyleSheet } from 'react-native';
import { TextInput, Button, Text, HelperText, useTheme } from 'react-native-paper';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { supplierService } from '../../src/services';

interface SupplierForm {
  name: string;
  currency: string;
  country: string;
  leadTimeDays: string;
  paymentTerms: string;
  primaryContact: string;
  email: string;
  phone: string;
}

const INITIAL: SupplierForm = {
  name: '',
  currency: 'USD',
  country: '',
  leadTimeDays: '7',
  paymentTerms: 'NET30',
  primaryContact: '',
  email: '',
  phone: '',
};

export default function NewSupplierScreen() {
  const router = useRouter();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<SupplierForm>(INITIAL);
  const [errors, setErrors] = useState<Partial<SupplierForm>>({});

  const set = (key: keyof SupplierForm) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const validate = (): boolean => {
    const e: Partial<SupplierForm> = {};
    if (!form.name.trim()) e.name = 'Name is required';
    if (!form.country.trim()) e.country = 'Country is required';
    const lead = Number(form.leadTimeDays);
    if (!form.leadTimeDays || isNaN(lead) || lead < 1) e.leadTimeDays = 'Must be ≥ 1';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const mutation = useMutation({
    mutationFn: () =>
      supplierService.create({
        name: form.name.trim(),
        currency: form.currency.trim() || 'USD',
        country: form.country.trim(),
        leadTimeDays: Number(form.leadTimeDays),
        paymentTerms: form.paymentTerms.trim() || 'NET30',
        primaryContact: form.primaryContact.trim() || undefined,
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      router.back();
    },
  });

  const handleSubmit = () => {
    if (!validate()) return;
    mutation.mutate();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text variant="headlineSmall" style={styles.title}>
        New Supplier
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
        label="Payment Terms (e.g. NET30)"
        value={form.paymentTerms}
        onChangeText={set('paymentTerms')}
        mode="outlined"
        style={styles.input}
      />

      <TextInput
        label="Currency"
        value={form.currency}
        onChangeText={set('currency')}
        mode="outlined"
        style={styles.input}
        autoCapitalize="characters"
        maxLength={3}
      />

      <TextInput
        label="Primary Contact"
        value={form.primaryContact}
        onChangeText={set('primaryContact')}
        mode="outlined"
        style={styles.input}
      />

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

      {mutation.isError && (
        <HelperText type="error" visible>
          Failed to create supplier. Please try again.
        </HelperText>
      )}

      <Button
        mode="contained"
        onPress={handleSubmit}
        loading={mutation.isPending}
        disabled={mutation.isPending}
        style={styles.button}
        contentStyle={styles.buttonContent}
      >
        Create Supplier
      </Button>

      <Button mode="text" onPress={() => router.back()} disabled={mutation.isPending}>
        Cancel
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  title: { marginBottom: 16 },
  input: { marginBottom: 2 },
  button: { marginTop: 16 },
  buttonContent: { paddingVertical: 6 },
});
