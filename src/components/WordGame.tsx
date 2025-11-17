import { useState, useEffect } from 'react';
import { useWordGame } from '@/hooks/useWordGame';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useRouter } from 'next/navigation';
import PrimaryBtn from './PrimaryBtn';
import { CheckIcon, ArrowLeft } from 'lucide-react';

interface GameState {
  word: string;
  guesses: string[];
  maxGuesses: number;
  isGameOver: boolean;
  isWinner: boolean;
  message: string;
  isValidWord: (word: string) => boolean;
  hasAlreadyCompleted: boolean;
}

interface WordGameProps {
  onGameComplete: (success: boolean) => Promise<void>;
}

export default function WordGame({ onGameComplete }: WordGameProps) {
  const router = useRouter();
  const [guess, setGuess] = useState('');
  const {
    gameState: {
      word,
      guesses,
      maxGuesses,
      isGameOver,
      isWinner,
      message,
      isValidWord,
      hasAlreadyCompleted
    },
    makeGuess
  } = useWordGame();

  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmitGuess = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanGuess = guess.trim().toUpperCase();
    if (cleanGuess && cleanGuess.length === word.length && isValidWord(cleanGuess)) {
      makeGuess(cleanGuess);
      setGuess('');
    }
  };

  console.log('Current guesses:', guesses);

  const handleGameEnd = () => {

  };

  useEffect(() => {
    if (isGameOver) {
      onGameComplete(isWinner);
      handleGameEnd();
    }
  }, [isGameOver, isWinner, onGameComplete]);

  if (hasAlreadyCompleted) {
    return (
      <div className="flex-1 overflow-y-auto h-screen space-y-4 mt-8 px-4 mx-0'">
        <p className="text-xl font-medium mb-4">🎮 Game Complete!</p>
        <div className="bg-orange-50 p-6 rounded-xl shadow-sm">
          <p className="text-gray-700 mb-4">
            You've already completed today's word! Come back soon for a new word.
          </p>
          <p className="text-orange-600 font-medium">
            Leaderboard coming soon! 🏆
          </p>
        </div>
        <button
          onClick={() => router.push('/game')}
          className="mt-6 bg-orange-500 text-white px-6 py-2 rounded-lg font-medium"
        >
          Back to Game Menu
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="fixed top-0 left-0 w-full bg-white border-b px-4 py-3 z-10">
        <button
          onClick={() => window.location.reload()}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-800"
        >
          <ArrowLeft className="h-5 w-5" />
          <span>Quit Game</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 mt-8 px-4 mx-0 ">
        {/* Game Rules */}
        <div className="bg-white p-4 rounded-lg shadow-sm mb-4">
          <h3 className="font-medium text-lg mb-2">📝 How to Play</h3>
          <ul className="space-y-2 text-gray-700">
            <li className="flex items-start gap-2">
              <span>1.</span>
              <span>Type a word and press enter to submit</span>
            </li>
            <li className="flex items-start gap-2">
              <span>2.</span>
              <span>Green tile (🟩) means letter is correct and in right spot</span>
            </li>
            <li className="flex items-start gap-2">
              <span>3.</span>
              <span>Yellow tile (🟨) means letter exists but in wrong spot</span>
            </li>
            <li className="flex items-start gap-2">
              <span>4.</span>
              <span>Gray tile (⬜️) means letter is not in the word</span>
            </li>
          </ul>
        </div>

        {/* Game Status */}
        <div className="text-center mb-4">
          <p className="text-gray-700">
            {message}
          </p>
        </div>

        {/* Game Grid (hide when input is focused) */}
        <div className={`flex-1 ${isInputFocused ? 'hidden' : ''}`}>
          <div className="grid gap-2">
            {guesses?.map((guess: string, guessIndex: number) => (
              <div key={guessIndex} className="flex justify-center gap-1">
                {guess.split('').map((letter, letterIndex) => {
                  const isCorrectPosition = letter === word[letterIndex];
                  const isCorrectLetter = !isCorrectPosition && word.includes(letter);

                  return (
                    <span
                      key={letterIndex}
                      className={`
                      w-7 h-7 flex items-center justify-center border font-bold rounded
                      ${isCorrectPosition
                          ? 'bg-green-500 text-white border-green-600'
                          : isCorrectLetter
                            ? 'bg-yellow-500 text-white border-yellow-600'
                            : 'bg-gray-200 border-gray-300'
                        }
                    `}
                    >
                      {letter}
                    </span>
                  );
                })}
              </div>
            ))}

            {[...Array(maxGuesses - guesses.length || 0)].map((_, i) => (
              <div key={`empty-${i}`} className="flex justify-center gap-1">
                {[...Array(word.length)].map((_, j) => (
                  <span
                    key={j}
                    className="w-7 h-7 border border-gray-200 rounded"
                  />
                ))}
              </div>
            ))}
          </div>
        </div>



      </div>

      {/* Input Section - Only show if game is not over */}
      {!isGameOver && (
        <div className="w-full bg-white flex justify-around p-2 z-50">
          <form onSubmit={handleSubmitGuess} className="flex gap-2 py-3">
            <Input
              type="text"
              value={guess}
              onChange={(e) => setGuess(e.target.value.toUpperCase())}
              maxLength={word.length}
              className="flex-1 text-center text-xl uppercase tracking-wider h-12"
              placeholder="Enter Guess"
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setIsInputFocused(false)}
              autoComplete="off"
              autoCapitalize="characters"
            />
            <Button
              type="submit"
              className="h-12 w-12 flex items-center justify-center"
              disabled={!guess.trim() || guess.length !== word.length}
            >
              <CheckIcon className="h-5 w-5" />
            </Button>
          </form>
        </div>
      )}

      {/* Game Over State */}
      {isGameOver && (
        <div className="w-full bg-white flex justify-around p-2 z-50">
          <div className="w-full text-center space-y-3">
            <p className="text-lg font-medium">
              {isWinner
                ? "🎉 Congratulations! You've guessed the word! \n \n MEMELANDIA - Decentralised Land \n ruled by Memecoins"
                : "Game Over! Try again!"}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="bg-orange-500 text-white px-6 py-2 rounded-lg font-medium w-full max-w-md mx-auto"
            >
              Game Menu
            </button>
          </div>
        </div>
      )}
    </>
  );
} 