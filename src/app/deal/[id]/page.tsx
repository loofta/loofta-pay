'use client'
import { confirmDelivery, getDeal } from "@/app/actions/deals/deals";
import { DealStatus, PaymentStatus } from "@/app/utils/types";
import InvalidAccess from "@/components/InvalidAccess";
import LoadingScreen from "@/components/LoadingScreen";
import ViewDeal from "@/components/ViewDeal";
import ViewDealFreelancer from "@/components/ViewDealFreelancer";
import { useTelegramUser } from "@/context/TelegramUserContext";
import { useRole } from "@/hooks/useRole";
import { formatDate } from "@/lib/utils";
import { useTonAddress } from "@tonconnect/ui-react";
import { useEffect, useState } from "react";

export default function Deal({ params }: { params: { id: string } }) {
    const userFriendlyAddress = useTonAddress();


    const [invalidAccess, setInvalidAccess] = useState(false);
    const { userData } = useTelegramUser();
    const { role } = useRole({ dealId: params.id, telegramHandle: userData?.username?.toLowerCase() });
    const storedProfile = window.Telegram?.WebApp?.storage?.getItem('profile') || localStorage.getItem('profile');
    const [loading, setLoading] = useState(false);
    const [dealData, setDealData] = useState({
        description: "",
        title: "",
        amount: "",
        points: 0,
        senderTgUsername: null,
        senderTgId: null,
        receiverTgId: null,
        expectedDeliveryDate: "",
        confirmedDeliveryDate: "",
        id: "",
        paymentStatus: "" as PaymentStatus,
        dealStatus: "" as DealStatus,
        recipientWalletAddress: "",
        requireSubmission: false,
        submissions: []
    });



    useEffect(() => {
        setLoading(true);
        console.log("Fetching deal with id: ", params.id);
        const getDealById = async () => {
            const deal = await getDeal(params.id);

            if (deal?.deal) {
                console.log('weshii')
                if (!userData) setInvalidAccess(true);
                if (userData?.id == deal.deal.senderTgId ||
                    userData?.username?.toLowerCase() == deal.deal.senderTgUsername ||
                    userData?.username?.toLowerCase() == deal.deal.recipientTgUsername ||
                    userData?.id == deal.deal.recipientTgId) {
                    console.log('so fa ok??', userData)
                    setInvalidAccess(false)
                } else {
                    console.log('wesh')
                    setInvalidAccess(true);
                }
                const amount = deal.deal.amount;
                const description = deal.deal.description;
                const expectedDeliveryDate = deal.deal.expectedDeliveryDate;
                const confirmedDeliveryDate = deal.deal.confirmedDeliveryDate;
                const id = deal.deal.dealId;
                const title = deal.deal.title;
                const senderTgUsername = deal.deal.senderTgUsername;
                const senderTgId = deal.deal.senderTgId;
                const receiverTgId = deal.deal.recipientTgId;
                const paymentStatus = deal.deal.paymentStatus as PaymentStatus;
                const dealStatus = deal.deal.dealStatus as DealStatus;
                const points = deal.deal.points;
                const requireSubmission = deal.deal.requireSubmission || false;
                const submissions = deal.deal.submission ? JSON.parse(deal.deal.submission) : [];

                setDealData({
                    description,
                    title,
                    amount,
                    points,
                    senderTgUsername,
                    senderTgId,
                    receiverTgId,
                    expectedDeliveryDate: expectedDeliveryDate,
                    confirmedDeliveryDate: confirmedDeliveryDate,
                    id,
                    paymentStatus,
                    dealStatus,
                    recipientWalletAddress: deal.deal.recipientWalletAddress,
                    submissions: submissions,
                    requireSubmission
                });
            }
            setLoading(false);
        };
        getDealById();
    }, [params.id]);

    return (
        <>
            {loading ? (<LoadingScreen text="Loading..." isVisible={true} />) : (
                <>
                    {invalidAccess ? (<InvalidAccess />) :
                        storedProfile === 'freelancer' ? (
                            <ViewDealFreelancer
                                title={dealData.title}
                                description={dealData.description}
                                amount={dealData.amount}
                                senderTgUsername={dealData.senderTgUsername}
                                receiverTgId={dealData.receiverTgId}
                                senderTgId={dealData.senderTgId}
                                expectedDeliveryDate={dealData.expectedDeliveryDate}
                                confirmedDeliveryDate={dealData.confirmedDeliveryDate}
                                id={dealData.id}
                                role={role}
                                points={dealData.points}
                                paymentStatus={dealData.paymentStatus}
                                dealStatus={dealData.dealStatus}
                                requireSubmission={dealData.requireSubmission}
                                submissions={dealData.submissions}
                                recipientWalletAddress={dealData.recipientWalletAddress}
                            />
                        ) : (
                            <ViewDeal
                                title={dealData.title}
                                description={dealData.description}
                                amount={dealData.amount}
                                senderTgUsername={dealData.senderTgUsername}
                                receiverTgId={dealData.receiverTgId}
                                senderTgId={dealData.senderTgId}
                                expectedDeliveryDate={dealData.expectedDeliveryDate}
                                confirmedDeliveryDate={dealData.confirmedDeliveryDate}
                                id={dealData.id}
                                role={role}
                                points={dealData.points}
                                paymentStatus={dealData.paymentStatus}
                                dealStatus={dealData.dealStatus}
                                submissions={dealData.submissions}
                                recipientWalletAddress={dealData.recipientWalletAddress}

                            />
                        )}
                </>
            )}
        </>
    );
}
