'use client';

import { useState } from 'react';
import PrimaryBtn from '@/components/PrimaryBtn';
import SecondaryBtn from '@/components/SecondaryBtn';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/hooks/useWallet';
import { TonConnectButton } from '@tonconnect/ui-react';

export default function TroubleshootPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [storageData, setStorageData] = useState<string>('');
  const router = useRouter();
  const { isWalletConnected, isLoading } = useWallet();

  const handleClose = () => {
    window.Telegram?.WebApp?.close();
    router.push('/');
  }
  const handleClearCache = async () => {
    localStorage.clear();
    window.Telegram?.WebApp?.storage?.clear();
    window.Telegram?.WebApp?.close();
    router.push('/');
  };

  const getStorageContent = () => {
    const storage = window.Telegram?.WebApp?.storage;
    const keys = ['profile', 'freelancerProfile', 'userData', 'isWalletConnected'];

    const telegramStorage = keys.map(key => ({
      key,
      value: storage?.getItem(key) || 'null',
      source: 'Telegram Storage'
    }));

    const localStorageItems = keys.map(key => ({
      key,
      value: localStorage.getItem(key) || 'null',
      source: 'Local Storage'
    }));

    return JSON.stringify({ telegramStorage, localStorageItems }, null, 2);
  };

  const handleDebug = () => {
    const content = getStorageContent();
    setStorageData(content);
    setIsModalOpen(true);
  };

  const handleCopyToClipboard = () => {
    navigator.clipboard.writeText(storageData);
  };


  return (
    <div className="tg-webview h-screen flex flex-col">
      <div className="flex-1 p-6 space-y-6">
        <div className="space-y-4">
          <h1 className="text-2xl font-bold">🔧 Having trouble logging in?</h1>

          <p className="text-gray-700">
            We&apos;re sorry you&apos;re experiencing issues! 😔 Let&apos;s try to fix this together.
          </p>

          <div className="bg-blue-50 p-4 rounded-lg">
            <h2 className="font-semibold mb-2">✨ First, try these steps:</h2>
            <ol className="list-decimal ml-4 space-y-2">
              <li>Clear the app cache using the button below</li>
              <li>Wait for the automatic reload</li>
              <li>Try logging in again</li>
            </ol>
          </div>

          <div className="bg-yellow-50 p-4 rounded-lg">
            <p className="text-gray-700">
              ⚠️ If the problem persists after clearing cache, please use the debug storage option and contact our support team at{' '}
              <a
                href="https://t.me/looftaxyz"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 underline"
              >
                t.me/looftaxyz
              </a>
            </p>
          </div>

          <div className="bg-gray-50 p-4 rounded-lg space-y-4">
            <div className="flex flex-col items-center space-y-4">
              <button
                onClick={handleDebug}
                className="text-gray-500 text-sm hover:text-gray-700 bg-white px-4 py-2 rounded-lg border"
              >
                🔍 Click to Debug Storage
              </button>
              <p className="text-sm text-gray-500 text-center">
                Click above to view debug info. Copy and send it to our support team for assistance.
              </p>

              <div className="flex items-center w-full my-4">
                <div className="flex-1 h-px bg-gray-300"></div>
                <span className="px-4 text-gray-500 text-sm">OR</span>
                <div className="flex-1 h-px bg-gray-300"></div>
              </div>

              <div className="w-full flex justify-center">
                <TonConnectButton />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 bg-white">
        <SecondaryBtn text='Close App' onClick={handleClose} />
        <PrimaryBtn
          text="Clear Cache & Reload"
          customProperties="w-full justify-center"
          onClick={handleClearCache}
        />
      </div>

      {/* Debug Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="p-4 border-b flex justify-between items-center">
              <h3 className="text-lg font-semibold">Storage Debug Info</h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <pre className="text-sm bg-gray-50 p-4 rounded whitespace-pre-wrap break-words">
                {storageData}
              </pre>
            </div>

            <div className="p-4 border-t">
              <button
                onClick={handleCopyToClipboard}
                className="text-blue-600 hover:underline"
              >
                Copy to Clipboard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
