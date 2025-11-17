"use client";
import { useRouter } from 'next/navigation';
import PrimaryBtn from "@/components/PrimaryBtn";
import Dashboard from "@/components/stepper/Dashboard/Dashboard";
import { useWallet } from '@/hooks/useWallet';
import LoadingScreen from '@/components/LoadingScreen';
import MobilePillMenu from '@/components/BottomMenu';
import { useEffect, useState } from 'react';
import { CREATE_DEAL_ROUTE } from '../utils/routes';
import { useTelegramUser } from '@/context/TelegramUserContext';
import { toast } from '@/components/ui/use-toast';
import { isUserAllowed } from '@/config/access';
import { useUnlockCreators } from "@/hooks/useUnlockCreators";
import { UnlockModal } from "@/components/UnlockModal";
import { UNLOCK_CREATORS_ACCESS_AMOUNT } from '@/lib/utils';

export default function DealsPage() {
    const router = useRouter();
    const { isWalletConnected } = useWallet();
    const [isLoading, setIsLoading] = useState(true);
    const { userData } = useTelegramUser();
    const [profile, setProfile] = useState<string | null>(null);
    const [isAllowedUser, setIsAllowedUser] = useState<boolean>(false);
    const { handleUnlock, showConfirmModal, setShowConfirmModal, handleConfirmPayment } = useUnlockCreators();

    useEffect(() => {
        const checkAccess = async () => {
            if (userData?.id) {
                const allowed = await isUserAllowed(userData.id.toString());
                setIsAllowedUser(allowed);
            }
        };

        checkAccess();
    }, [userData?.id]);

    useEffect(() => {
        const storedProfile = localStorage.getItem('profile');
        if (storedProfile) {
            setProfile(storedProfile);
        }
    }, []);

    useEffect(() => {
        if (isWalletConnected !== null) {
            setIsLoading(false);
        }
    }, [isWalletConnected]);

    const redirect = () => {
        router.push(CREATE_DEAL_ROUTE);
    };

    const handleUnlockClick = () => {
        if (!userData) {
            toast({
                title: "Error",
                description: "Please login first",
                variant: "destructive",
            });
            return;
        }

        handleUnlock();
    };

    // Redirect if not allowed client
    if (profile === 'client' && !isAllowedUser) {
        return (
            <div className='h-screen flex flex-col'>
                <div className='flex-1 overflow-y-auto space-y-4 mt-8 px-4 mx-0'>
                    <div className="flex flex-col items-center justify-center h-full p-4 text-center">
                        <div className="w-16 h-16 bg-gradient-to-r from-orange-500 via-pink-500 to-purple-500 rounded-xl flex items-center justify-center shadow-lg shadow-orange-500/20 mb-4">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            </svg>
                        </div>
                        <h2 className="text-xl font-semibold text-gray-900 mb-2">Creators Access Required</h2>
                        <p className="text-gray-600 mb-6">Unlock the Full creators list to view and manage direct deals with KOLs, content creators and ambassadors.</p>
                        <PrimaryBtn
                            text={`Unlock for ${UNLOCK_CREATORS_ACCESS_AMOUNT} USDT`}
                            onClick={handleUnlockClick}
                            customProperties="!w-auto bg-gradient-to-r from-orange-500 via-pink-500 to-purple-500 hover:from-orange-600 hover:via-pink-600 hover:to-purple-600 shadow-lg shadow-orange-500/20 text-sm py-2 font-medium"
                        />
                    </div>
                </div>
                <div className="w-full bg-white px-4 pb-1 mb-0">
                    <MobilePillMenu />
                </div>
                <UnlockModal
                    isOpen={showConfirmModal}
                    onClose={() => setShowConfirmModal(false)}
                    userData={userData}
                />
            </div>
        );
    }

    if (isLoading) {
        return <LoadingScreen text="Loading..." isVisible={true} />;
    }

    return (
        <div className='h-screen flex flex-col'>
            <div className='flex-1 overflow-y-auto space-y-4 mt-8 px-4 mx-0'>
                <Dashboard />
            </div>
            <div className="w-full bg-white px-4 pb-1 mb-0">
                {profile === 'client' && (
                    <PrimaryBtn text="Create deal" onClick={redirect} />
                )}
                <MobilePillMenu />
            </div>
            <UnlockModal
                isOpen={showConfirmModal}
                onClose={() => setShowConfirmModal(false)}
                userData={userData}
            />
        </div>
    );
}
