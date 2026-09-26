import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Local (unsaved) editor state kept on-device so reopening a poem — or the
 * new-poem screen — after a crash/kill can offer to recover text that never
 * reached the server. Cleared on every explicit save.
 */
export interface LocalPoemDraft {
  title: string;
  content: string;
  savedAt: number;
}

const PREFIX = 'verso.draft.poem.';

export function draftKeyFor(poemId: string | null): string {
  return `${PREFIX}${poemId ?? 'new'}`;
}

export async function loadLocalDraft(key: string): Promise<LocalPoemDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalPoemDraft>;
    if (typeof parsed.title !== 'string' || typeof parsed.content !== 'string') return null;
    return {
      title: parsed.title,
      content: parsed.content,
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0,
    };
  } catch {
    return null;
  }
}

export async function saveLocalDraft(
  key: string,
  draft: { title: string; content: string },
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      key,
      JSON.stringify({ title: draft.title, content: draft.content, savedAt: Date.now() }),
    );
  } catch {
    // best effort — recovery is a convenience, never blocks typing
  }
}

export async function clearLocalDraft(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // ignore
  }
}
