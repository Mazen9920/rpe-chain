import { useState } from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { TextInput, Button, Text, HelperText, useTheme } from 'react-native-paper';
import { useAuthStore } from '../../src/store/auth.store';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const login = useAuthStore((s) => s.login);
  const theme = useTheme();

  async function handleLogin() {
    setError('');
    if (!email || !password) {
      setError('Email and password are required');
      return;
    }
    setLoading(true);
    try {
      await login(email, password);
    } catch (e: any) {
      setError(e.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Text variant="headlineLarge" style={styles.title}>RPE Chain</Text>
        <Text variant="bodyMedium" style={styles.subtitle}>Supply OS · Respiratory Protective Equipment</Text>

        <TextInput
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          style={styles.input}
          mode="outlined"
        />
        <TextInput
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          style={styles.input}
          mode="outlined"
        />

        <HelperText type="error" visible={!!error}>{error}</HelperText>

        <Button mode="contained" onPress={handleLogin} loading={loading} style={styles.btn}>
          Sign In
        </Button>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24 },
  card: { gap: 8 },
  title: { fontWeight: 'bold', textAlign: 'center', marginBottom: 4 },
  subtitle: { textAlign: 'center', opacity: 0.6, marginBottom: 24 },
  input: { marginBottom: 4 },
  btn: { marginTop: 8 },
});
