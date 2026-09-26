import { Redirect, Stack } from 'expo-router';
import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../theme/tokens';

export default function AppLayout() {
  const { status } = useAuth();

  if (status === 'loading') return null;
  if (status !== 'authenticated') return <Redirect href="/login" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
