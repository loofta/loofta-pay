import { useState, useEffect } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { fetchCurrentWord, fetchGameEntries, getWeeklyLeaderboard, updateLeaderboard } from '@/app/actions/wordGame/wordGame';
import { useUser } from './useUser';

interface GameState {
  currentWord: string;
  word: string;
  maskedWord: string;
  attempts: string[];
  gameStatus: 'playing' | 'won' | 'lost';
  startTime?: number;
  endTime?: number;
  definition?: string;
  maxAttempts: number;
  isGameOver: boolean;
  isWinner: boolean;
  message: string;
  guesses: string[];
  maxGuesses: number;
  isValidWord: (word: string) => boolean;
  hasAlreadyCompleted: boolean;
}

export const useWordGame = () => {
  const { userProfile } = useUser();
  const [startTime] = useState(Date.now());
  const [isLoading, setIsLoading] = useState(false);
  const [gameState, setGameState] = useState<GameState>(() => {
    // Try to get completion status from localStorage first
    const cachedCompletion = typeof window !== 'undefined' 
      ? window.Telegram?.WebApp?.storage?.getItem(`wordGame_completed_${userProfile?.id}`) || localStorage.getItem(`wordGame_completed_${userProfile?.id}`)
      : null;

    return {
      currentWord: "MEMELANDIA",
      word: "MEMELANDIA",
      guesses: [],
      maskedWord: "_".repeat(9),
      attempts: [],
      gameStatus: 'playing',
      maxAttempts: 5,
      isGameOver: false,
      isWinner: false,
      message: "",
      maxGuesses: 5,
      isValidWord: (word: string) => true,
      hasAlreadyCompleted: cachedCompletion === 'true'
    };
  });

  const getLetterStatus = (letter: string, position: number, attempt: string): "correct" | "misplaced" | "incorrect" => {
    const word = gameState.word.toUpperCase();
    letter = letter.toUpperCase();

    if (word[position] === letter) {
      return "correct";
    }
    if (word.includes(letter)) {
      return "misplaced";
    }
    return "incorrect";
  };

  const makeGuess = async (guess: string) => {
    if (gameState.isGameOver) return;
    
    const formattedGuess = guess.toUpperCase();
    if (formattedGuess.length !== gameState.word.length) {
      setGameState(prev => ({
        ...prev,
        message: `Word must be ${gameState.word.length} letters long`
      }));
      return;
    }

    const newAttempts = [...gameState.attempts, formattedGuess];
    const newGuesses = [...gameState.guesses, formattedGuess];
    const endTime = Date.now();

    const saveToLeaderboard = async (success: boolean) => {
      if (!userProfile) return;
      
      await updateLeaderboard({
        id: crypto.randomUUID(),
        userId: userProfile.id,
        telegramId: userProfile?.telegramId || 0,
        telegramUsername: userProfile.telegramHandle || 'Anonymous',
        attempts: newAttempts.length,
        timeElapsed: endTime - startTime,
        weekNumber: getWeekNumber(new Date()),
        year: new Date().getFullYear(),
        word: gameState.word,
        completedAt: new Date(),
        success: success
      });
    };

    if (formattedGuess === gameState.word) {
      await saveToLeaderboard(true);
      setGameState(prev => ({
        ...prev,
        attempts: newAttempts,
        guesses: newGuesses,
        isGameOver: true,
        isWinner: true,
        message: "Congratulations! You've guessed the word 🎉"
      }));
    } else if (newAttempts.length >= 5) {
      await saveToLeaderboard(false);
      setGameState(prev => ({
        ...prev,
        attempts: newAttempts,
        guesses: newGuesses,
        isGameOver: true,
        message: `You used all of your attempts. Try again!`
      }));
    } else {
      setGameState(prev => ({
        ...prev,
        attempts: newAttempts,
        guesses: newGuesses,
        message: `${5 - newAttempts.length} attempts remaining`
      }));
    }
  };

  // Check completion status from server and update cache
  useEffect(() => {
    const checkCompletion = async () => {
      if (!userProfile?.id) return;
      
      try {
        const [leaderboardEntries, gameEntries] = await Promise.all([
          getWeeklyLeaderboard(),
          fetchGameEntries(userProfile.id)
        ]);
        
        // Check both leaderboard and game entries
        const hasCompleted = 
          leaderboardEntries?.length > 0 && 
          gameEntries?.length > 0 && 
          leaderboardEntries.some(entry => 
            entry.userId === userProfile.id && 
            entry.success && 
            entry.word === gameState.word
          );
        
        // Update localStorage
        localStorage.setItem(`wordGame_completed_${userProfile.id}`, String(hasCompleted));
        window.Telegram?.WebApp?.storage?.setItem(`wordGame_completed_${userProfile.id}`, String(hasCompleted));
        
        setGameState(prev => ({
          ...prev,
          hasAlreadyCompleted: hasCompleted
        }));
      } catch (error) {
        console.error('Error checking completion:', error);
        setGameState(prev => ({
          ...prev,
          hasAlreadyCompleted: false
        }));
      }
    };

    checkCompletion();
  }, [gameState.word]);

  return {
    gameState: {
      ...gameState,
      hasAlreadyCompleted: gameState.hasAlreadyCompleted
    },
    makeGuess,
    getLetterStatus,
    isLoading
  };
};

function getWeekNumber(date: Date) {
  const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
  const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
  return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
} 