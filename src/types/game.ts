export interface GameState {
  currentWord: string;
  attempts: string[];
  gameStatus: 'playing' | 'won' | 'lost';
  startTime?: number;
  endTime?: number;
  definition?: string;
}

export interface LeaderboardEntry {
  id: string;
  userId: string;
  telegramId: number;
  telegramUsername: string;
  attempts: number;
  timeElapsed: number;
  weekNumber: number;
  year: number;
  word: string;
  completedAt: Date;
  success: boolean;
}

export interface WordEntry {
  word: string;
  definition: string;
  weekNumber: number;
  year: number;
  active: boolean;
}

export interface GameEntry {
  id: string;
  userId: string;
  telegramId: string;
  pointsSpent: number;
  timestamp: number;
} 