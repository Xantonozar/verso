import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Local (unsaved) story state kept on-device so reopening a story — or the
 * new-story screen — after a crash/kill can offer to recover text that never
 * reached the server. Cleared on every explicit save. Chapters use their own
 * keys so each keeps an independent recovery snapshot.
 */
export interface LocalStoryDraft {
  title: string;
  synopsis: string;
  savedAt: number;
}

export interface LocalChapterDraft {
  title: string;
  content: string;
  savedAt: number;
}

const STORY_PREFIX = 'verso.draft.story.';
const CHAPTER_PREFIX = 'verso.draft.storyChapter.';
const PROGRESS_PREFIX = 'verso.story.progress.';

export function storyDraftKeyFor(storyId: string | null): string {
  return `${STORY_PREFIX}${storyId ?? 'new'}`;
}

export function chapterDraftKeyFor(storyId: string, chapterId: string): string {
  return `${CHAPTER_PREFIX}${storyId}.${chapterId}`;
}

export async function loadLocalStoryDraft(key: string): Promise<LocalStoryDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalStoryDraft>;
    if (typeof parsed.title !== 'string' || typeof parsed.synopsis !== 'string') return null;
    return {
      title: parsed.title,
      synopsis: parsed.synopsis,
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0,
    };
  } catch {
    return null;
  }
}

export async function saveLocalStoryDraft(
  key: string,
  draft: { title: string; synopsis: string },
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      key,
      JSON.stringify({ title: draft.title, synopsis: draft.synopsis, savedAt: Date.now() }),
    );
  } catch {
    // best effort — recovery is a convenience, never blocks typing
  }
}

export async function clearLocalStoryDraft(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export async function loadLocalChapterDraft(key: string): Promise<LocalChapterDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalChapterDraft>;
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

export async function saveLocalChapterDraft(
  key: string,
  draft: { title: string; content: string },
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      key,
      JSON.stringify({ title: draft.title, content: draft.content, savedAt: Date.now() }),
    );
  } catch {
    // ignore
  }
}

export async function clearLocalChapterDraft(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/** Reading position — last chapter the reader had open, for "resume". */
export async function saveReadingPosition(storyId: string, chapterId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(`${PROGRESS_PREFIX}${storyId}`, chapterId);
  } catch {
    // ignore
  }
}

export async function loadReadingPosition(storyId: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(`${PROGRESS_PREFIX}${storyId}`);
  } catch {
    return null;
  }
}
