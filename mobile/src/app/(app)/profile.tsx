import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Animated, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import { ErrorState } from '../../components/ErrorState';
import { LoadingState } from '../../components/LoadingState';
import { TextField } from '../../components/TextField';
import { AuthUser, useAuth } from '../../context/AuthContext';
import api, { ApiError } from '../../lib/api/client';
import { AuthorStoryItem, listAuthorStories } from '../../lib/api/stories';
import { toast } from '../../lib/toast';
import {
  CONNECTIVITY_TOAST,
  FieldErrors,
  isConnectivityError,
  mapApiFieldErrors,
  splitFieldErrors,
} from '../../lib/validation';
import { colors, layout, radii, spacing, typography } from '../../theme/tokens';

function initialsOf(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .map((word) => word[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?'
  );
}

// Highest streak ever SHOWN on this device - growth vs this number is
// what counts as a "new personal best" (plan step 86).
const BEST_SEEN_KEY = 'verso:bestStreakSeen';

/**
 * Best-effort personal-best detection (plan step 86): when the profile's
 * `readingStreak.longest` exceeds what we last showed, celebrate once in
 * place. The first sight of a streak only seeds the baseline (no confetti
 * on a fresh install); storage failures skip the moment silently - this
 * is decoration, never data.
 */
async function checkStreakCelebration(data: AuthUser, onNewBest: () => void): Promise<void> {
  const longest = data.readingStreak?.longest ?? 0;
  if (longest <= 0) return;
  try {
    const seenRaw = await AsyncStorage.getItem(BEST_SEEN_KEY);
    const parsed = Number(seenRaw);
    const seen = seenRaw !== null && Number.isFinite(parsed) ? parsed : null;
    if (seen !== null && longest > seen) onNewBest();
    if (seen === null || longest > seen) {
      await AsyncStorage.setItem(BEST_SEEN_KEY, String(longest));
    }
  } catch {
    // storage unavailable - celebration is cosmetic, move on
  }
}

export default function ProfileScreen() {
  const { user, updateUser, signOut } = useAuth();
  const [profile, setProfile] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [stories, setStories] = useState<AuthorStoryItem[]>([]);

  const [celebrating, setCelebrating] = useState(false);
  // Stable Animated.Value without touching a ref during render
  // (react-hooks/refs): initialized once, never reassigned.
  const [streakPulse] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    listAuthorStories(user.id, { limit: 10 })
      .then((page) => {
        if (!cancelled) setStories(page.items);
      })
      .catch(() => {
        // profile stories are a convenience — never block the screen
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const fetchMe = useCallback(async (): Promise<AuthUser> => {
    const { data } = await api.get<AuthUser>('/users/me');
    return data;
  }, []);

  // Subtle in-place pulse for a new personal best (plan step 86) -
  // no toast, no navigation; JS-driven so it behaves identically under
  // the test environment.
  useEffect(() => {
    if (!celebrating) return;
    Animated.sequence([
      Animated.timing(streakPulse, { toValue: 1.15, duration: 240, useNativeDriver: false }),
      Animated.timing(streakPulse, { toValue: 1, duration: 240, useNativeDriver: false }),
    ]).start();
  }, [celebrating, streakPulse]);

  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then((data) => {
        if (!cancelled) {
          setProfile(data);
          updateUser(data);
          void checkStreakCelebration(data, () => setCelebrating(true));
        }
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchMe, updateUser]);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const data = await fetchMe();
      setProfile(data);
      updateUser(data);
      void checkStreakCelebration(data, () => setCelebrating(true));
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [fetchMe, updateUser]);

  function startEditing() {
    if (!profile) return;
    setDisplayName(profile.displayName ?? '');
    setBio(profile.bio ?? '');
    setFieldErrors({});
    setFormError(null);
    setEditing(true);
  }

  async function saveProfile() {
    const errors: FieldErrors = {};
    const trimmedName = displayName.trim();
    if (!trimmedName) errors.displayName = 'is required';
    else if (trimmedName.length > 50) errors.displayName = 'must be at most 50 characters';
    if (bio.length > 300) errors.bio = 'must be at most 300 characters';
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    try {
      const { data } = await api.patch<AuthUser>('/users/me', {
        displayName: trimmedName,
        bio,
      });
      setProfile(data);
      updateUser(data);
      setEditing(false);
      toast.success('Profile updated');
    } catch (err) {
      if (isConnectivityError(err)) {
        toast.error(CONNECTIVITY_TOAST);
      } else {
        const mapped = mapApiFieldErrors(err);
        if (mapped) {
          const { fields, formMessage } = splitFieldErrors(mapped);
          setFieldErrors(fields);
          if (formMessage) setFormError(formMessage);
        } else {
          setFormError("Couldn't save your changes. Please try again.");
        }
      }
    } finally {
      setSaving(false);
    }
  }

  async function pickAndUploadPhoto() {
    if (uploading) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      toast.error('Photo access is needed to change your picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];

    const form = new FormData();
    form.append('photo', {
      uri: asset.uri,
      name: asset.fileName ?? 'avatar.jpg',
      type: asset.mimeType ?? 'image/jpeg',
    } as unknown as Blob);

    setUploading(true);
    setUploadProgress(0);
    try {
      const { data } = await api.post<AuthUser>('/users/me/photo', form, {
        onUploadProgress: (event) => {
          if (event.total) setUploadProgress(Math.round((event.loaded / event.total) * 100));
        },
      });
      setProfile(data);
      updateUser(data);
      toast.success('Photo updated');
    } catch (err) {
      if (isConnectivityError(err)) {
        toast.error(CONNECTIVITY_TOAST);
      } else if (err instanceof ApiError && err.code === 'UPLOAD_UNAVAILABLE') {
        toast.error('Photo uploads are temporarily unavailable. Try again later.');
      } else if (err instanceof ApiError && err.code === 'FILE_TOO_LARGE') {
        toast.error('That image is too large.');
      } else {
        toast.error("Couldn't upload the photo. Try again.");
      }
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }

  if (loading) return <LoadingState label="Loading your profile..." />;
  if (loadFailed || !profile) {
    return <ErrorState message="Couldn't load your profile." onRetry={reload} />;
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.identity}>
          {profile.profilePhotoUrl ? (
            <Image source={{ uri: profile.profilePhotoUrl }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatar} accessibilityLabel={`${profile.displayName} avatar`}>
              <Text style={styles.avatarText}>{initialsOf(profile.displayName)}</Text>
            </View>
          )}
          <Text style={styles.name}>{profile.displayName}</Text>
          <Text style={styles.handle}>@{profile.username}</Text>
        </View>

        <View style={styles.counts}>
          <View style={styles.countBox} accessibilityLabel={`${profile.followerCount} followers`}>
            <Text style={styles.countValue}>{profile.followerCount ?? 0}</Text>
            <Text style={styles.countLabel}>Followers</Text>
          </View>
          <View style={styles.countBox} accessibilityLabel={`${profile.followingCount} following`}>
            <Text style={styles.countValue}>{profile.followingCount ?? 0}</Text>
            <Text style={styles.countLabel}>Following</Text>
          </View>
        </View>

        {profile.readingStreak ? (
          <View style={styles.streakRow}>
            <Animated.View
              style={[styles.streakBadge, { transform: [{ scale: streakPulse }] }]}
              testID="streak-badge"
            >
              <Text style={styles.streakBadgeText}>
                {profile.readingStreak.current > 0
                  ? `${profile.readingStreak.current}-day reading streak`
                  : 'No reading streak yet'}
              </Text>
            </Animated.View>
            {celebrating ? (
              <Text style={styles.streakBest} testID="streak-new-best">
                New personal best!
              </Text>
            ) : null}
          </View>
        ) : null}

        {!editing ? (
          <View style={styles.card}>
            {profile.bio ? (
              <Text style={styles.bio}>{profile.bio}</Text>
            ) : (
              <Text style={styles.bioEmpty}>No bio yet — tap Edit to introduce yourself.</Text>
            )}
            <View style={styles.actions}>
              <Button
                label="+ New poem"
                onPress={() => router.push('/poem/new')}
                testID="new-poem"
              />
              <Button
                label="+ New story"
                onPress={() => router.push('/story/new')}
                testID="new-story"
              />
              <Button
                label="+ New diary"
                onPress={() => router.push('/diary/new')}
                testID="new-diary"
              />
              <Button
                label="Feed"
                variant="secondary"
                onPress={() => router.push('/feed')}
                testID="open-feed"
              />
              <Button
                label="Discover"
                variant="secondary"
                onPress={() => router.push('/discover')}
                testID="open-discover"
              />
              <Button
                label="Collections"
                variant="secondary"
                onPress={() => router.push('/collections')}
                testID="open-collections"
              />
              <Button
                label="Collaborate"
                variant="secondary"
                onPress={() => router.push('/collabs')}
                testID="open-collabs"
              />
              <Button
                label="Duels"
                variant="secondary"
                onPress={() => router.push('/duel')}
                testID="open-duels"
              />
              <Button
                label="Weekly prompt"
                variant="secondary"
                onPress={() => router.push('/prompt')}
                testID="open-prompt"
              />
              <Button
                label="Messages"
                variant="secondary"
                onPress={() => router.push('/messages')}
                testID="open-messages"
              />
              <Button
                label="Notifications"
                variant="secondary"
                onPress={() => router.push('/notifications')}
                testID="open-notifications"
              />
              <Button
                label="Analytics"
                variant="secondary"
                onPress={() => router.push('/analytics')}
                testID="open-analytics"
              />
              <Button label="Edit profile" variant="secondary" onPress={startEditing} testID="edit-profile" />
              <Button
                label={uploading ? `Uploading… ${uploadProgress}%` : 'Change photo'}
                variant="secondary"
                onPress={pickAndUploadPhoto}
                loading={uploading}
                testID="change-photo"
              />
            </View>
          </View>
        ) : (
          <View style={styles.card}>
            <TextField
              label="Display name"
              value={displayName}
              onChangeText={setDisplayName}
              error={fieldErrors.displayName}
              testID="edit-display-name"
            />
            <TextField
              label="Bio"
              value={bio}
              onChangeText={setBio}
              error={fieldErrors.bio}
              multiline
              placeholder="A line about you and your poems"
              testID="edit-bio"
            />
            {formError ? (
              <Text style={styles.formError} accessibilityRole="alert">
                {formError}
              </Text>
            ) : null}
            <View style={styles.actions}>
              <Button
                label="Save"
                onPress={saveProfile}
                loading={saving}
                testID="save-profile"
              />
              <Button
                label="Cancel"
                variant="secondary"
                onPress={() => setEditing(false)}
                disabled={saving}
              />
            </View>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Stories</Text>
          {stories.length === 0 ? (
            <Text style={styles.bioEmpty} testID="empty-stories">
              No stories yet — tap + New story to start one.
            </Text>
          ) : (
            <View style={styles.storyList}>
              {stories.map((story) => (
                <Button
                  key={story.id}
                  label={`${story.title || 'Untitled story'} · ${story.chapterCount} ch · ${
                    story.status === 'published' ? 'Published' : story.status === 'unlisted' ? 'Unlisted' : 'Draft'
                  }`}
                  variant="secondary"
                  onPress={() => router.push(`/story/${story.id}/edit`)}
                  testID={`story-row-${story.id}`}
                />
              ))}
            </View>
          )}
        </View>

        <Button
          label="Sign out"
          variant="secondary"
          onPress={async () => {
            await signOut();
          }}
          testID="sign-out"
        />
        <Text style={styles.email}>{user?.email ?? profile.email}</Text>
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
    alignItems: 'center',
    gap: spacing.xs,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 96,
    height: 96,
    borderRadius: 48,
  },
  avatarText: {
    ...typography.title,
    color: colors.accent,
  },
  name: {
    ...typography.title,
    color: colors.ink,
    textAlign: 'center',
  },
  handle: {
    ...typography.body,
    color: colors.inkMuted,
  },
  counts: {
    flexDirection: 'row',
    justifyContent: 'center',
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
  streakRow: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  streakBadge: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  streakBadgeText: {
    ...typography.caption,
    color: colors.accentPressed,
    fontWeight: '600',
  },
  streakBest: {
    ...typography.caption,
    color: colors.success,
    fontWeight: '600',
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
  sectionTitle: {
    ...typography.title,
    fontSize: 18,
    color: colors.ink,
  },
  storyList: {
    gap: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  formError: {
    ...typography.body,
    color: colors.error,
  },
  email: {
    ...typography.caption,
    color: colors.inkMuted,
    textAlign: 'center',
  },
});
