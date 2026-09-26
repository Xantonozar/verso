import { Link, router } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import { TextField } from '../../components/TextField';
import { useAuth } from '../../context/AuthContext';
import { toast } from '../../lib/toast';
import {
  CONNECTIVITY_TOAST,
  FieldErrors,
  isConnectivityError,
  mapApiFieldErrors,
  splitFieldErrors,
  validateLogin,
} from '../../lib/validation';
import { colors, layout, spacing, typography } from '../../theme/tokens';

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit() {
    const errors = validateLogin({ identifier, password });
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      await signIn(identifier.trim(), password);
      router.replace('/profile');
    } catch (err) {
      if (isConnectivityError(err)) {
        toast.error(CONNECTIVITY_TOAST);
      } else {
        const mapped = mapApiFieldErrors(err);
        if (mapped) {
          const { fields, formMessage } = splitFieldErrors(mapped);
          setFieldErrors(fields);
          if (formMessage) setFormError(formMessage);
        } else if ((err as { code?: string })?.code === 'AUTH_INVALID_CREDENTIALS') {
          setFormError('Incorrect email or password.');
        } else {
          setFormError('Something went wrong. Please try again.');
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>Sign in to keep writing.</Text>
        </View>

        <View style={styles.form}>
          <TextField
            label="Email or username"
            value={identifier}
            onChangeText={setIdentifier}
            error={fieldErrors.identifier}
            autoCapitalize="none"
            autoComplete="username"
            textContentType="username"
            keyboardType="email-address"
            placeholder="you@example.com or username"
            testID="login-identifier"
          />
          <TextField
            label="Password"
            value={password}
            onChangeText={setPassword}
            error={fieldErrors.password}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            placeholder="Your password"
            testID="login-password"
          />

          {formError ? (
            <Text style={styles.formError} accessibilityRole="alert" accessibilityLiveRegion="polite">
              {formError}
            </Text>
          ) : null}

          <Button
            label="Sign in"
            onPress={onSubmit}
            loading={submitting}
            testID="login-submit"
          />
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>New to Verso?</Text>
          <Link href="/register" replace>
            <Text style={styles.footerLink}>Create an account</Text>
          </Link>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: spacing.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xxl,
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    gap: spacing.xs,
  },
  title: {
    ...typography.title,
    color: colors.ink,
  },
  subtitle: {
    ...typography.body,
    color: colors.inkSecondary,
  },
  form: {
    gap: spacing.lg,
  },
  formError: {
    ...typography.body,
    color: colors.error,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  footerText: {
    ...typography.body,
    color: colors.inkSecondary,
  },
  footerLink: {
    ...typography.body,
    color: colors.accent,
    fontWeight: '600',
  },
});
