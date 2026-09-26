import { Redirect, router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../../components/Button';
import { ErrorState } from '../../../components/ErrorState';
import { LoadingState } from '../../../components/LoadingState';
import { useAuth } from '../../../context/AuthContext';
import api, { ApiError } from '../../../lib/api/client';
import { toast } from '../../../lib/toast';
import { CONNECTIVITY_TOAST, isConnectivityError } from '../../../lib/validation';
import { colors, layout, radii, spacing, typography } from '../../../theme/tokens';

interface PublicProfile {
  id: string;
  username: string;
  displayName: string;
  bio?: string;
  profilePhotoUrl?: string;
  followerCount: number;
  followingCount: number;
  isFollowing?: boolean;
  createdAt?: string;
}

interface FollowResult {
  following: boolean;
  followerCount: number;
}

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<'gone' | 'other' | null>(null);
  const [pending, setPending] = useState(false);
  const [optimistic, setOptimistic] = useState<{
    following: boolean;
    followerCount: number;
  } | null>(null);

  const fetchProfile = useCallback(async (): Promise<PublicProfile> => {
    const { data } = await api.get<PublicProfile>(`/users/${id}`);
    return data;
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    fetchProfile()
      .then((data) => {
        if (!cancelled) {
          setProfile(data);
          setLoadError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(
            err instanceof ApiError && err.code === 'USER_NOT_FOUND' ? 'gone' : 'other',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchProfile]);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchProfile();
      setProfile(data);
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.code === 'USER_NOT_FOUND' ? 'gone' : 'other',
      );
    } finally {
      setLoading(false);
    }
  }, [fetchProfile]);

  async function toggleFollow() {
    if (!profile || pending) return;
    const wasFollowing = profile.isFollowing === true;
    const next = !wasFollowing;
    const previousCount = profile.followerCount;

    setPending(true);
    setOptimistic({
      following: next,
      followerCount: Math.max(0, previousCount + (next ? 1 : -1)),
    });

    try {
      const endpoint = `/users/${profile.id}/follow`;
      const { data } = next
        ? await api.post<FollowResult>(endpoint)
        : await api.delete<FollowResult>(endpoint);
      setProfile({
        ...profile,
        isFollowing: data.following,
        followerCount: data.followerCount,
      });
      setOptimistic(null);
    } catch (err) {
      setOptimistic(null); // rollback to server truth
      if (isConnectivityError(err)) toast.error(CONNECTIVITY_TOAST);
      else toast.error(next ? "Couldn't follow — tap to try again" : "Couldn't unfollow — tap to try again");
    } finally {
      setPending(false);
    }
  }

  if (user && id && user.id === id) return <Redirect href="/profile" />;
  if (loading) return <LoadingState label="Loading profile..." />;
  if (loadError === 'gone') {
    return (
      <SafeAreaView style={styles.container}>
        <ErrorState message="This profile is no longer available." />
      </SafeAreaView>
    );
  }
  if (loadError === 'other' || !profile) {
    return (
      <SafeAreaView style={styles.container}>
        <ErrorState message="Couldn't load this profile." onRetry={reload} />
      </SafeAreaView>
    );
  }

  const following = optimistic?.following ?? profile.isFollowing === true;
  const followerCount = optimistic?.followerCount ?? profile.followerCount;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Button label="Back" variant="secondary" onPress={() => router.back()} testID="user-back" />

        <View style={styles.identity}>
          <Text style={styles.name}>{profile.displayName}</Text>
          <Text style={styles.handle}>@{profile.username}</Text>
        </View>

        <View style={styles.counts}>
          <View style={styles.countBox} accessibilityLabel={`${followerCount} followers`}>
            <Text style={styles.countValue} testID="follower-count">
              {followerCount}
            </Text>
            <Text style={styles.countLabel}>Followers</Text>
          </View>
          <View style={styles.countBox} accessibilityLabel={`${profile.followingCount} following`}>
            <Text style={styles.countValue}>{profile.followingCount}</Text>
            <Text style={styles.countLabel}>Following</Text>
          </View>
        </View>

        <View style={styles.card}>
          {profile.bio ? (
            <Text style={styles.bio}>{profile.bio}</Text>
          ) : (
            <Text style={styles.bioEmpty}>This poet has not written a bio yet.</Text>
          )}
          <Button
            label={following ? 'Following' : 'Follow'}
            variant={following ? 'secondary' : 'primary'}
            onPress={toggleFollow}
            disabled={pending}
            testID="follow-button"
          />
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
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  identity: {
    gap: spacing.xs,
  },
  name: {
    ...typography.title,
    color: colors.ink,
  },
  handle: {
    ...typography.body,
    color: colors.inkMuted,
  },
  counts: {
    flexDirection: 'row',
    gap: spacing.xl,
  },
  countBox: {
    alignItems: 'center',
    minWidth: 88,
  },
  countValue: {
    ...typography.title,
    fontSize: 20,
    color: colors.ink,
  },
  countLabel: {
    ...typography.caption,
    color: colors.inkMuted,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  bio: {
    ...typography.body,
    color: colors.ink,
  },
  bioEmpty: {
    ...typography.body,
    color: colors.inkMuted,
  },
});
