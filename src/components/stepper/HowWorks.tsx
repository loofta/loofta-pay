'use client'
import '../../app/globals.css';
import Subtitle from '../Subtitle';
import Title from '../Title';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { DEALS_ROUTE } from '@/app/utils/routes';

interface HowWorksProps {
    customText?: string;
}

export default function HowWorks({ customText }: HowWorksProps) {
    const router = useRouter();
    const handleGoBack = () => {
        router.push(DEALS_ROUTE); // Navigate to the previous page
    };

    const defaultText = `Create and customize your deal with clear terms. Choose a creator to collaborate with and set the terms of your agreement. Once you submit the deal, the creator will be able to accept it using their wallet address.

After the deal is confirmed, you can choose to pay upfront or at the time of delivery. For every transaction, you'll earn reward points. Please note that a small platform fee will be applied to each deal.

By clicking 'Got it,' you agree to the terms and conditions of the platform. If you need any assistance, our support team is available on Telegram to help with any issues.`;

    return (
        <div className="flex flex-col ">
            <div className="flex-1 overflow-y-auto space-y-4 mt-2  mx-0">
                <Button variant="ghost" className="flex items-center space-x-2" onClick={handleGoBack}>
                    <ArrowLeft className="w-5 h-5" />
                    <span>Previous</span>
                </Button>
                <Title text="How it works?" customProperties='mx-4' />
                <div className='mx-4'>
                    <div className="text-gray-600 text-xl whitespace-pre-wrap">
                        {customText || defaultText}
                    </div>
                </div>
            </div>
        </div>
    );
}
