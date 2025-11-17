'use client';
import { useRouter } from 'next/navigation';
import Subtitle from '../Subtitle';
import Title from '../Title';
import PreviousButton from '../PreviousButton';  // Import the PreviousButton component

export default function SocialMediaVerify() {
    const router = useRouter();

    return (
        <div className="flex flex-col ">
            <div className='flex mt-2'>
                <PreviousButton onBack={() => router.back()} />  {/* Use the PreviousButton component */}

            </div>
            <div className="flex-1 overflow-y-auto space-y-4 px-4 mt-4">
                <Title text="Set Social Media to Verify" />
                <Subtitle text="To ensure authenticity and ownership of social media accounts, freelancers will be required to verify their social media handles using oAuth. This process allows us to securely confirm that the creator has access to the specified accounts." />
                <div className="mt-8 p-4 bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700">
                    <p className="font-semibold">Coming Soon</p>
                    <p>This feature will be up very soon.</p>
                </div>
            </div>
        </div>
    );
}
