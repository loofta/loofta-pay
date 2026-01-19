import React from 'react';
import { Button } from './ui/button';
import { usePrivy } from '@privy-io/react-auth';
import classNames from 'classnames';
import { ChevronLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface TitleProps {
  text: string;
  customProperties?: string;
  showPrevious?: boolean;
  previousUrl?: string;
  showWallet?: boolean;
}

export default function Title({ text, customProperties, showPrevious = false, previousUrl, showWallet = true }: TitleProps) {
  const { user } = usePrivy();
  const router = useRouter();

  const handleBack = () => {
    if (previousUrl) {
      router.push(previousUrl);
    } else {
      router.back();
    }
  };

  return (
    <div className='flex justify-between items-center'>
      <div className='flex items-center gap-2'>
        {showPrevious && (
          <ChevronLeft
            className="h-6 w-6 cursor-pointer text-gray-600 hover:text-gray-900"
            onClick={handleBack}
          />
        )}
        <h2 className={classNames('font-sans font-bold text-xl md:text-2xl leading-tight', customProperties)}>
          {text}
        </h2>
      </div>

      {showWallet && user?.wallet?.address && (
        <div className="text-sm font-mono text-gray-600">
          {typeof user.wallet.address === 'string'
            ? user.wallet.address.slice(0, 6) + '...' + user.wallet.address.slice(-4)
            : String(user.wallet.address).slice(0, 6) + '...' + String(user.wallet.address).slice(-4)}
        </div>
      )}
    </div>
  );
}
