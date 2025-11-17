import { useState, useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';

export function useWallet() {
    const { authenticated, user } = usePrivy();
    const [isWalletConnected, setIsWalletConnected] = useState<boolean | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const cachedWalletStatus = localStorage.getItem('isWalletConnected');

        if (cachedWalletStatus === 'true' && authenticated) {
            setIsWalletConnected(true);
            setIsLoading(false);
        } else if (authenticated) {
            setIsWalletConnected(true);
            localStorage.setItem('isWalletConnected', 'true');
            window.Telegram?.WebApp?.storage?.setItem('isWalletConnected', 'true');
            setIsLoading(false);
        } else {
            setIsWalletConnected(false);
            localStorage.removeItem('isWalletConnected');
            window.Telegram?.WebApp?.storage?.removeItem('isWalletConnected');
            setIsLoading(false);
        }
    }, [authenticated]);

    return { isWalletConnected, isLoading };
}
