import { router } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../../components/Button';
import { StoryEditor } from '../../../components/StoryEditor';
import { colors, layout, spacing, typography } from '../../../theme/tokens';

export default function NewStoryScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Button label="Back" variant="secondary" onPress={() => router.back()} testID="editor-back" />
        <Text style={styles.heading}>New story</Text>
        <StoryEditor
          story={null}
          onCreated={(story) => router.replace(`/story/${story.id}/edit`)}
          onSaved={() => undefined}
        />
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
  heading: {
    ...typography.title,
    color: colors.ink,
  },
});
