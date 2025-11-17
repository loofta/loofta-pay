"use server"

import { WordEntry, LeaderboardEntry, GameEntry } from '@/types/game';
import db from '@/firebase/firebase';

// Add these constants at the top
const MAX_ATTEMPTS_PER_DAY = 10;
const ATTEMPT_COOLDOWN_MS = 30000; // 30 seconds between attempts

// Add this new function to check rate limits
async function checkRateLimit(userId: string): Promise<boolean> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const attempts = await db
    .collection('gameEntries')
    .where('userId', '==', userId)
    .where('createdAt', '>=', today)
    .get();

  if (attempts.size >= MAX_ATTEMPTS_PER_DAY) {
    return false;
  }

  const lastAttempt = attempts.docs
    .map(doc => doc.data().createdAt?.toDate())
    .sort((a, b) => b - a)[0];

  if (lastAttempt && (Date.now() - lastAttempt.getTime()) < ATTEMPT_COOLDOWN_MS) {
    return false;
  }

  return true;
}

// Fetch the current word for the week
export const fetchCurrentWord = async (): Promise<WordEntry | null> => {
  try {
    const currentWeek = getWeekNumber(new Date());
    const currentYear = new Date().getFullYear();
    const wordDoc = await db
      .collection('words')
      .doc(`${currentYear}-${currentWeek}`)
      .get();

    if (!wordDoc.exists) {
      return null;
    }

    return wordDoc.data() as WordEntry;
  } catch (error) {
    console.error("Error fetching current word:", error);
    throw error;
  }
};

// Update the leaderboard with a new entry
export const updateLeaderboard = async (entry: LeaderboardEntry) => {
  try {
    await db
      .collection('leaderboard')
      .add({
        ...entry,
        createdAt: new Date()
      });
  } catch (error) {
    console.error("Error updating leaderboard:", error);
    throw error;
  }
};


export const fetchGameEntries = async (userId: string) => {
  const snapshot = await db
    .collection('gameEntries')
    .where('userId', '==', userId)
    .get();

  return snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id,
      userId: String(data.userId),
      telegramId: String(data.telegramId),
      pointsSpent: Number(data.pointsSpent),
      timestamp: Number(data.timestamp || Date.now())
    };
  });
};

export const createGameEntry = async (entry: Omit<GameEntry, 'id'>) => {
  const canAttempt = await checkRateLimit(entry.userId);
  if (!canAttempt) {
    // throw new Error('Rate limit exceeded. Please wait before trying again.');
  }

  const docRef = await db
    .collection('gameEntries')
    .add({
      ...entry,
      createdAt: new Date()
    });
  return { id: docRef.id, ...entry };
};

// Add or update the word for the current week
export const setWeeklyWord = async (word: string, definition: string) => {
  try {
    const currentWeek = getWeekNumber(new Date());
    const currentYear = new Date().getFullYear();
    
    await db
      .collection('words')
      .doc(`${currentYear}-${currentWeek}`)
      .set({
        word,
        definition,
        weekNumber: currentWeek,
        year: currentYear,
        active: true,
        createdAt: new Date()
      }, { merge: true });
  } catch (error) {
    console.error("Error setting weekly word:", error);
    throw error;
  }
};

// Get leaderboard entries for current week
export const getWeeklyLeaderboard = async (): Promise<LeaderboardEntry[]> => {
  try {
    const currentWeek = getWeekNumber(new Date());
    const currentYear = new Date().getFullYear();

    const leaderboardSnapshot = await db
      .collection('leaderboard')
      .where('weekNumber', '==', currentWeek)
      .where('year', '==', currentYear)
      .where('success', '==', true)
      .orderBy('attempts', 'asc')
      .orderBy('timeElapsed', 'asc')
      .limit(10)
      .get();

    // Serialize the data properly
    return leaderboardSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        userId: data.userId,
        telegramId: data.telegramId,
        telegramUsername: data.telegramUsername,
        attempts: data.attempts,
        timeElapsed: data.timeElapsed,
        success: data.success,
        weekNumber: data.weekNumber,
        year: data.year,
        word: data.word,
        id: doc.id,
        createdAt: data.createdAt?.toDate().toISOString(),
        completedAt: data.completedAt?.toDate().toISOString(),
      } as LeaderboardEntry;
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('requires an index')) {
      console.error('Please create the following composite index in Firebase:');
      console.error(`
Collection: leaderboard
Fields to index:
- weekNumber (ascending)
- year (ascending)
- success (ascending)
- attempts (ascending)
- timeElapsed (ascending)
      `);
    }
    throw error;
  }
};

// Helper function to get the current week number
function getWeekNumber(date: Date) {
  const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
  const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
  return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
} 