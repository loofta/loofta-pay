import { useTonConnectModal } from "@tonconnect/ui-react";
import { DealStatus, PaymentStatus, Role } from "@/app/utils/types";
import {
    acceptDeal,
    confirmDelivery,
    deleteDeal,
    getDeal,
    updateTelegramRecipientInformation,
    updateDealPaymentStatus,
    updateDealStatus,
    declineDeal,
} from "@/app/actions/deals/deals";
import { Key, useEffect, useState } from "react";
import useSendPayment from "@/hooks/useSendPayment";
import MobilePillMenu from "@/components/BottomMenu";
import LoadingScreen from "@/components/LoadingScreen";
import PrimaryBtn from "@/components/PrimaryBtn";
import { useRouter } from "next/navigation";
import Linkify from 'react-linkify';
import { Button } from "@/components/ui/button";
import { AlertTriangle, ArrowLeft, CheckCircle, CheckIcon, Copy, LoaderIcon, SendIcon, SoupIcon, TimerIcon, UserIcon, Clock, StarIcon } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import Title from "./Title";
import { notifyDealAccepted, notifyDealDeclined, notifyDealDelivered, notifyPaymentReceived, notifyUserForPayment, messageNotification } from "@/services/notificationService";
import Congrats from "./stepper/Congrats/Congrats";
import { formatDate, toFriendlyAddress } from "@/lib/utils";
import { Badge } from "./ui/badge";
import SecondaryBtn from "./SecondaryBtn";
import { useTelegramUser } from "@/context/TelegramUserContext"; // Import the useTelegramUser hook
import { Freelancer } from '@/app/utils/interfaces';
import { getFreelancerById } from '@/app/actions/freelancers/freelancers';
import LinkBtn from "./LinkBtn";
import { DEALS_ROUTE, FREELANCER_DETAILS_ROUTE } from "@/app/utils/routes";
import Image from 'next/image';

interface ViewDealProps {
    title?: string;
    description: string;
    amount: string;
    points: number;
    senderTgUsername: string | number | null;
    senderTgId: string | number | null;
    receiverTgId: string | number | null;
    expectedDeliveryDate: string;
    confirmedDeliveryDate?: string;
    id: string;
    role: Role | null;
    paymentStatus: PaymentStatus;
    dealStatus: DealStatus;
    recipientWalletAddress: string;
    submissions?: string[];
}

export default function ViewDeal({
    title,
    description,
    amount,
    points,
    senderTgUsername,
    senderTgId,
    receiverTgId,
    expectedDeliveryDate,
    confirmedDeliveryDate,
    id,
    role,
    paymentStatus,
    dealStatus,
    recipientWalletAddress,
    submissions,
}: ViewDealProps) {
    console.log('Submissions in ViewDeal:', submissions);

    const { open } = useTonConnectModal();
    const { sendPayment, verifyPaymentStatus } = useSendPayment();
    const { toast } = useToast();
    const router = useRouter();
    const { userData } = useTelegramUser(); // Use global state for userData
    const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
    const [isPayModalOpen, setIsPayModalOpen] = useState(false);
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
    const [isAcceptModalOpen, setIsAcceptModalOpen] = useState(false);
    const [isDeclineModalOpen, setIsDeclineModalOpen] = useState(false);
    const [currentDealStatus, setCurrentDealStatus] = useState<DealStatus>(dealStatus);
    const [currentDealDeliveryDate, setCurrentDealDeliveryDate] = useState<string | undefined>(confirmedDeliveryDate);
    const [currentPaymentStatus, setCurrentPaymentStatus] = useState<PaymentStatus>(paymentStatus);
    const [loadingText, setLoadingText] = useState<string>("Processing transaction...");
    const [isLoading, setIsLoading] = useState(true);
    const [isTransactionLoading, setIsTransactionLoading] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [showCongrats, setShowCongrats] = useState(false);
    const [isRequesting, setIsRequesting] = useState(false);
    const [freelancer, setFreelancer] = useState<Freelancer | null>(null);
    const storedProfile = window.Telegram?.WebApp?.storage?.getItem('profile') || localStorage.getItem('profile');
    const [isViewsubmissionsModalOpen, setIsViewsubmissionsModalOpen] = useState(false);

    useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true);
            const deal = await getDeal(id);
            if (deal?.deal) {
                setCurrentDealStatus(deal.deal.dealStatus);
                if (deal?.deal.paymentStatus === 'in_progress') {
                    if (deal?.deal?.transactionHash) {
                        const success = await verifyPaymentStatus(id, deal.deal.transactionHash);
                        if (success) {
                            setCurrentPaymentStatus('paid');
                            toast({
                                title: "Payment Confirmed",
                                description: "The payment has been confirmed successfully.",
                            });
                        } else {
                            setCurrentPaymentStatus('unpaid');
                            toast({
                                title: "Payment Verification Failed",
                                description: "Failed to verify payment. Please try again later.",
                                variant: "destructive",
                            });
                        }
                    }
                } else {
                    setCurrentPaymentStatus(deal.deal.paymentStatus);
                }
                if (deal.deal.recipientId) {
                    const loadedFreelancer = await getFreelancerById(deal.deal.recipientId);
                    setFreelancer(loadedFreelancer);
                }
            }
            setIsLoading(false);
        };

        if (id) {
            fetchData();
        }
    }, [id]);

    const renderTextWithLineBreaksAndLinks = (text: string) => {
        return text.split('\\n').map((line: string, index: Key | null | undefined) => (
            <span key={index}>
                <Linkify
                    componentDecorator={(decoratedHref, decoratedText, key) => (
                        <a
                            href={decoratedHref}
                            key={key}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-orange-400 underline break-all"
                        >
                            {decoratedText}
                        </a>
                    )}
                >
                    {line.split(/(\*\*.*?\*\*)/).map((part, i) => {
                        if (part.startsWith('**') && part.endsWith('**')) {
                            return <span className="font-medium text-gray-900" key={i}>{part.slice(2, -2)}</span>;
                        }
                        return part;
                    })}
                </Linkify>
                {index !== text.split('\\n').length - 1 && <br />}
            </span>
        ));
    };

    const handleClosePayModal = () => {
        setIsPayModalOpen(false);
    }

    const handleCloseConfirmModal = () => {
        setIsConfirmModalOpen(false);
    }
    const handleCloseCancelModal = () => {
        setIsCancelModalOpen(false);
    };

    const handleCloseAcceptModal = () => {
        setIsAcceptModalOpen(false);
    }
    const handleCloseDeclineModal = () => {
        setIsDeclineModalOpen(false);
    }
    const handleCancelDeal = async () => {
        setIsLoading(true);
        const response = await deleteDeal(id);
        if (response.success) {
            toast({
                title: "Deal Cancelled",
                description: "Deal is successfully cancelled.",
            });
            router.push(DEALS_ROUTE);
        }
    };

    const handleDeclineDeal = async () => {
        setIsLoading(true);
        const response = await declineDeal(id);
        const deal = await getDeal(id);
        if (deal?.deal) {
            notifyDealDeclined(deal?.deal?.id, deal?.deal?.senderTgId);
            toast({
                title: "Deal declined",
                description: "Deal has been successfully declined.",
            });
            router.push(DEALS_ROUTE);
        }
    };

    const handleAcceptDeal = async () => {
        setIsLoading(true);
        await acceptDeal(id);
        const deal = await getDeal(id);
        if (deal?.deal) {
            setCurrentDealStatus(deal.deal.dealStatus);
            setCurrentPaymentStatus(deal.deal.paymentStatus);
            notifyDealAccepted(id, deal.deal.senderTgId);
            if (userData?.id && userData?.username) {
                updateTelegramRecipientInformation(
                    id,
                    userData.id,
                    userData.username.toLowerCase()
                );
            }
        }
        setIsLoading(false);
    };

    useEffect(() => {
        if (isTransactionLoading) {
            const messages = [
                "Don't close this window...",
                "Processing transaction...",
                "Waiting for network confirmation...",
                "A few seconds more...",
                "Transaction is being confirmed...",
            ];
            let messageIndex = 0;

            const interval = setInterval(() => {
                messageIndex = (messageIndex + 1) % messages.length;
                setLoadingText(messages[messageIndex]);
            }, 3000);

            return () => clearInterval(interval);
        }
    }, [isTransactionLoading]);

    const handleConfirmDelivery = async () => {
        setIsLoading(true);
        await confirmDelivery(id);
        const deal = await getDeal(id);
        if (deal?.deal) {
            notifyDealDelivered(id, deal.deal.senderTgId);
            setCurrentDealDeliveryDate(new Date(Date.now()).toISOString());
            setCurrentDealStatus(deal.deal.dealStatus);
            setCurrentPaymentStatus(deal.deal.paymentStatus);
        }
        setIsLoading(false);
    };

    const handlePayNow = async () => {
        console.log('handlePayNow debug:', {
            amount: amount,
            amountType: typeof amount,
            parsedAmount: parseFloat(amount),
            isZero: parseFloat(amount) === 0,
            condition: amount && parseFloat(amount) === 0
        });

        setIsTransactionLoading(true);

        if (amount !== undefined && parseFloat(amount) === 0) {
            console.log('Zero amount condition triggered');
            await updateDealPaymentStatus(id, 'paid');
            await updateDealStatus(id, 'done').then(() => {
                //setShowCongrats(true);
                setCurrentPaymentStatus('paid');
                notifyPaymentReceived(id, receiverTgId);
                setIsTransactionLoading(false);
            });

        } else {
            console.log('Non-zero amount condition triggered');
            const paymentSuccess = parseFloat(amount) > 0
                ? await sendPayment(title ? title : 'Deal #' + id.slice(0, 4), amount, recipientWalletAddress, id)
                : true;
            if (paymentSuccess) {
                //setShowCongrats(true);
                setCurrentPaymentStatus('paid');
                notifyPaymentReceived(id, receiverTgId);
                setIsTransactionLoading(false);
            } else {
                setIsTransactionLoading(false);
                toast({
                    title: "Payment failed",
                    description: "There was an issue processing the payment. Check your balance.",
                    variant: "destructive",
                });
            }
        }
    };

    const handleRequestPayment = async () => {
        if (isRequesting) {
            toast({
                title: "Request in progress",
                description: "Please wait until the current request is completed.",
            });
            return;
        }

        setIsRequesting(true);

        if (senderTgUsername) {
            try {
                await notifyUserForPayment(
                    senderTgUsername.toString(),
                    id.toString(),
                    amount
                );
                toast({
                    title: "Payment successfully requested",
                    description: "The client has been notified to settle the payment.",
                });
            } catch (error) {
                toast({
                    title: "Error",
                    description: "Failed to request payment.",
                    variant: "destructive",
                });
            } finally {
                setIsRequesting(false);
            }
        } else {
            toast({
                title: "Error",
                description: "Failed to request payment.",
                variant: "destructive",
            });
            setIsRequesting(false);
        }
    };

    const handleCopyLink = () => {
        const dealLink = `${window.location.origin}/deal/${id}`;
        navigator.clipboard.writeText(dealLink);
        toast({
            title: "Link copied",
            description: "The deal link has been copied to your clipboard.",
        });
    };

    const handleClose = () => {
        router.push(DEALS_ROUTE);
    };

    const handleCopyWalletAddress = () => {
        navigator.clipboard.writeText(recipientWalletAddress);
        toast({
            title: "Copied",
            description: "Recipient wallet address has been copied.",
        });
    };

    const SubmissionModal = () => (
        <>
            <div
                className="fixed inset-0 bg-black opacity-50 z-40"
                onClick={() => setIsViewsubmissionsModalOpen(false)}
            />
            <div className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-white rounded-t-lg shadow-lg animate-slide-up max-h-[90vh] overflow-y-auto">
                <div className="absolute top-2 right-2 cursor-pointer text-gray-500"
                    onClick={() => setIsViewsubmissionsModalOpen(false)}>
                    <span className='inline-flex'>Close</span>
                </div>

                <div className="mt-6">
                    <h2 className="text-lg font-semibold mb-4">Submissions</h2>
                    <div className="space-y-2">
                        {submissions && submissions?.length > 0 ? (
                            submissions.map((link, index) => (
                                <div key={index} className="p-3 bg-gray-50 rounded-lg break-all">
                                    <a
                                        href={link}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-orange-400 hover:text-orange-500 underline"
                                    >
                                        {link.slice(0, 30)}...
                                    </a>
                                </div>
                            ))
                        ) : (
                            <div className="text-gray-500 text-center p-4">
                                No submissions yet
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex flex-col space-y-2 mt-6">
                    {currentDealStatus === 'done' && (
                        <>
                            <PrimaryBtn text="Approve & Pay" onClick={() => {
                                setIsViewsubmissionsModalOpen(false);
                                setIsPayModalOpen(true);
                            }} />
                            <SecondaryBtn
                                text="Request Changes"
                                onClick={async () => {
                                    try {
                                        const message = `<strong>🚫 Almost There</strong><br><br>Your submissions for "${title}" didn't meet the deal requirements yet, so we can't send your rewards.<br><br>Follow the instructions carefully, complete the deal, and confirm again—we're rooting for you! 💪`;
                                        await messageNotification(message, receiverTgId);
                                        await updateDealPaymentStatus(id, "ongoing");

                                        setCurrentDealStatus("ongoing");
                                        setIsViewsubmissionsModalOpen(false);
                                        toast({
                                            title: "submissions Declined",
                                            description: "The freelancer has been notified to make changes.",
                                        });
                                    } catch (error) {
                                        console.error('Error declining submissions:', error);
                                        toast({
                                            title: "Error",
                                            description: "Failed to decline submissions.",
                                            variant: "destructive",
                                        });
                                    }
                                }}
                            />
                        </>
                    )}
                    <SecondaryBtn text="Close" onClick={() => setIsViewsubmissionsModalOpen(false)} />
                </div>
            </div>
        </>
    );



    const renderActions = () => {

        if (storedProfile === null) {
            return <PrimaryBtn text="Connect Wallet" onClick={open} />;
        }

        if (storedProfile === "freelancer") {
            if (currentDealStatus === "pending") {
                return (
                    <>
                        <>
                            <SecondaryBtn text="Decline Deal" onClick={() => setIsDeclineModalOpen(true)} />
                            <PrimaryBtn text="Accept Deal" onClick={() => setIsAcceptModalOpen(true)} />
                            {isAcceptModalOpen && (
                                <>

                                    {/* Overlay */}
                                    <div
                                        id="modalOverlay"
                                        className="fixed inset-0 bg-black opacity-50 z-40"
                                        onClick={handleCloseAcceptModal} // Close on outside click
                                    ></div>

                                    {/* Modal Content */}
                                    <div className={`fixed bottom-0 left-0 right-0 z-50 p-4 bg-white rounded-t-lg shadow-lg animate-slide-up`}>
                                        {/* Close Cross */}
                                        <div className="absolute top-2 right-2 cursor-pointer text-gray-500" onClick={handleCloseAcceptModal}>
                                            <span className='inline-flex'>
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                                </svg>
                                            </span>
                                        </div>

                                        <div className="mt-6 text-center">
                                            <h2 className="text-lg font-semibold">Accept Deal</h2>
                                            <p className="text-gray-600">
                                                Are you sure you want to accept the deal?
                                            </p>
                                        </div>

                                        <div className="flex flex-col space-y-2 mt-4 mb-4">
                                            <SecondaryBtn text="Cancel" onClick={handleCloseAcceptModal} />
                                            <PrimaryBtn text="Yes, Confirm" onClick={handleAcceptDeal} />
                                        </div>
                                    </div>
                                </>
                            )}
                            {isDeclineModalOpen && (
                                <>

                                    {/* Overlay */}
                                    <div
                                        id="modalOverlay"
                                        className="fixed inset-0 bg-black opacity-50 z-40"
                                        onClick={handleCloseDeclineModal} // Close on outside click
                                    ></div>

                                    {/* Modal Content */}
                                    <div className={`fixed bottom-0 left-0 right-0 z-50 p-4 bg-white rounded-t-lg shadow-lg animate-slide-up`}>
                                        {/* Close Cross */}
                                        <div className="absolute top-2 right-2 cursor-pointer text-gray-500" onClick={handleCloseDeclineModal}>
                                            <span className='inline-flex'>
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                                </svg>
                                            </span>
                                        </div>

                                        <div className="mt-6 text-center">
                                            <h2 className="text-lg font-semibold">Decline Deal</h2>
                                            <p className="text-gray-600">
                                                Are you sure you want to decline this deal?
                                            </p>
                                        </div>

                                        <div className="flex flex-col space-y-2 mt-4 mb-4">
                                            <SecondaryBtn text="Close" onClick={handleCloseDeclineModal} />
                                            <PrimaryBtn text="Yes, Decline" onClick={handleDeclineDeal} />
                                        </div>
                                    </div>
                                </>
                            )}
                        </>
                    </>
                );
            }

            if (currentPaymentStatus === "paid") {

                return <PrimaryBtn text="Done" onClick={handleClose} />;
            } else {

                if (currentDealStatus === "ongoing") {
                    return (

                        <>

                            <PrimaryBtn text="Confirm Delivery" onClick={() => setIsConfirmModalOpen(true)} />

                            {isConfirmModalOpen && (
                                <>

                                    {/* Overlay */}
                                    <div
                                        id="modalOverlay"
                                        className="fixed inset-0 bg-black opacity-50 z-40"
                                        onClick={handleCloseConfirmModal} // Close on outside click
                                    ></div>

                                    {/* Modal Content */}
                                    <div className={`fixed bottom-0 left-0 right-0 z-50 p-4 bg-white rounded-t-lg shadow-lg animate-slide-up`}>
                                        {/* Close Cross */}
                                        <div className="absolute top-2 right-2 cursor-pointer text-gray-500" onClick={handleCloseConfirmModal}>
                                            <span className='inline-flex'>
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                                </svg>
                                            </span>
                                        </div>

                                        <div className="mt-6 text-center">
                                            <h2 className="text-lg font-semibold">Confirm delivery</h2>
                                            <p className="text-gray-600">
                                                Are you sure you want to confirm the delivery?
                                            </p>
                                        </div>

                                        <div className="flex flex-col space-y-2 mt-4 mb-4">
                                            <SecondaryBtn text="Cancel" onClick={handleCloseConfirmModal} />
                                            <PrimaryBtn text="Yes, Confirm" onClick={handleConfirmDelivery} />
                                        </div>
                                    </div>
                                </>
                            )}

                        </>

                    );
                } else {
                    return (
                        <PrimaryBtn text={amount && +amount > 0 ? "Request Payment" : "Request Rewards"} onClick={handleRequestPayment} disabled={isRequesting} />
                    );
                }

            }
        }

        if (storedProfile === "client") {
            if (currentPaymentStatus !== 'paid') {
                if (currentDealStatus === "done") {
                    return (
                        <div className="flex flex-col gap-2">
                            <SecondaryBtn
                                text={`View submissions${submissions?.length ? ` (${submissions.length})` : ''}`}
                                onClick={() => setIsViewsubmissionsModalOpen(true)}
                            />
                            {isViewsubmissionsModalOpen && <SubmissionModal />}

                            <div className="flex gap-2">

                                <PrimaryBtn
                                    text="Pay Now"
                                    onClick={() => setIsPayModalOpen(true)}
                                />


                                {
                                    isPayModalOpen && (
                                        <>

                                            {/* Overlay */}
                                            <div
                                                id="modalOverlay"
                                                className="fixed inset-0 bg-black opacity-50 z-40"
                                                onClick={handleClosePayModal} // Close on outside click
                                            ></div>

                                            {/* Modal Content */}
                                            <div className={`fixed bottom-0 left-0 right-0 z-50 p-4 bg-white rounded-t-lg shadow-lg animate-slide-up`}>
                                                {/* Close Cross */}
                                                <div className="absolute top-2 right-2 cursor-pointer text-gray-500" onClick={handleCloseCancelModal}>
                                                    <span className='inline-flex'>
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                                        </svg>
                                                    </span>
                                                </div>

                                                <div className="mt-6 text-center">
                                                    <h2 className="text-lg font-semibold">Confirm Payment</h2>
                                                    <p className="text-gray-600">
                                                        Are you sure you want to proceed with the payment?
                                                    </p>
                                                </div>

                                                <div className="flex flex-col space-y-2 mt-4 mb-4">
                                                    <SecondaryBtn text="Close" onClick={handleClosePayModal} />
                                                    <PrimaryBtn text="Confirm Payment" onClick={handlePayNow} />
                                                </div>
                                            </div>
                                        </>
                                    )
                                }
                            </div>
                        </div>
                    );


                }
                // ... rest of your existing conditions
            }
        }
        // ... rest of your existing renderActions code
    };



    const shortDescription = description.split(" ").slice(0, 15).join(" ");
    const isLongDescription = description.split(" ").length > 15;

    if (showCongrats) {
        return (
            <div className='tg-webview h-screen'>
                <div className="flex flex-col h-full">
                    <div className="flex-1 h-full overflow-y-auto space-y-4 mt-8 mx-0">
                        <Congrats dealId={id} amount={amount} displayCta />
                    </div>
                    <div className="w-full bg-white p-2 pb-1">
                        <PrimaryBtn onClick={handleClose} text="Got it!" />
                        <MobilePillMenu />
                    </div>
                </div>
            </div>
        );
    }

    if (isLoading) {
        return <LoadingScreen text="Loading deal details..." isVisible={true} />;
    }

    return (
        <div className="tg-webview h-screen">
            <div className="flex flex-col h-full">
                <div className="p-4">
                    <Button
                        variant="ghost"
                        className="flex items-center space-x-2"
                        onClick={() => router.push(DEALS_ROUTE)}
                    >
                        <ArrowLeft className="w-5 h-5" />
                        <span>Previous</span>
                    </Button>
                </div>

                {isLoading || isTransactionLoading ? (
                    <>
                        {isTransactionLoading ? (
                            <LoadingScreen isVisible={isTransactionLoading} text={loadingText} />
                        ) : (
                            <LoadingScreen isVisible={true} text={"Getting details of the deal..."} />
                        )}
                    </>
                ) : (
                    <div className="flex-1 overflow-y-auto space-y-4 mt-0 mx-4">
                        <Title text="Deal Receipt" />
                        <div className="p-6 bg-white rounded-xl shadow-lg space-y-4 border border-gray-200">
                            <div className="flex justify-between text-lg font-semibold text-gray-800">
                                <span>{title ? title : 'Deal #' + id.slice(0, 4)}</span>

                                <div className="flex items-center space-x-2">
                                    {amount && +amount > 0 ? (
                                        <Badge variant='outline' className="px-3 py-1 flex items-center space-x-2 bg-green-50 border-green-200">
                                            <Image src="/images/usdt.svg" alt="USDT" width={16} height={16} />
                                            <span className="font-semibold text-green-700">+{amount} USDt</span>
                                        </Badge>
                                    ) : null}

                                    {points && points > 0 ? (
                                        <Badge variant='outline' className="px-3 py-1 flex items-center space-x-2 bg-blue-50 border-blue-200">
                                            <StarIcon className="w-4 h-4 text-blue-500" />
                                            <span className="font-semibold text-blue-700">+{points} points</span>
                                        </Badge>
                                    ) : null}
                                </div>
                            </div>
                            <div className="text-gray-700 break-all flex justify-between items-center">
                                <div className="flex items-center space-x-2">
                                    <b className="font-medium">

                                        {storedProfile === 'client' ? 'Sent to: ' : 'Sent by: '}
                                    </b>
                                    <Badge variant="outline" className="text-sm">
                                        {storedProfile === 'client' ? (
                                            <>
                                                <UserIcon className="mr-1 w-4 h-4" />

                                                {/* Client view: Show recipient (freelancer full name) */}
                                                <span
                                                    className="py-0 text-gray-800 "
                                                    onClick={() => router.push(FREELANCER_DETAILS_ROUTE(freelancer?.id ?? ''))}
                                                >
                                                    {freelancer?.fullName || toFriendlyAddress(recipientWalletAddress)}
                                                </span>
                                            </>
                                        ) : (
                                            <>
                                                {/* Freelancer view: Show sender (client telegram username) */}
                                                <span
                                                    className="py-0 text-gray-800 "
                                                    onClick={() => window.open(`https://t.me/${senderTgUsername}`, '_blank')}
                                                >
                                                    {senderTgUsername ? '@' + senderTgUsername : 'Unknown'}
                                                </span>
                                            </>
                                        )}
                                    </Badge>


                                </div>

                                <div className="flex items-center space-x-2">
                                    {currentPaymentStatus === 'paid' ? (
                                        <Badge variant="outline" className="bg-green-100 font-medium text-green-700 border-0 text-xs">
                                            <CheckCircle className="mr-1 w-4 h-4" /> Paid
                                        </Badge>
                                    ) : currentPaymentStatus === 'unpaid' ? (
                                        <Badge variant="outline" className="bg-orange-100 font-medium text-orange-700 border-0 text-xs">
                                            <AlertTriangle className="mr-1 w-4 h-4" /> Payment due
                                        </Badge>
                                    ) : (

                                        <Badge variant="outline" className="bg-blue-100 font-medium text-blue-700 border-0 text-xs">
                                            <Clock className="mr-1 w-4 h-4" /> In Progress
                                        </Badge>
                                    )}
                                </div>
                            </div>

                            <div className="text-gray-700 break-all flex justify-between items-center">
                                <div className="flex items-center space-x-2">
                                    <Badge variant="outline" className="bg-gray-100 font-medium text-gray-700 border-0 text-xs">

                                        <span
                                            className="py-0 text-gray-800 cursor-pointer hover:text-orange-500"
                                            onClick={() => {
                                                navigator.clipboard.writeText(recipientWalletAddress);
                                                toast({
                                                    title: "Copied",
                                                    description: "Wallet address copied to clipboard",
                                                });
                                            }}
                                        >
                                            {toFriendlyAddress(recipientWalletAddress)}
                                        </span>
                                    </Badge>
                                </div>
                            </div>


                            <div className="text-lg font-normal text-gray-500 mt-2 flex">
                                <p>
                                    {/* Conditionally render either the full or shortened description with line breaks and clickable links */}
                                    {expanded ? renderTextWithLineBreaksAndLinks(description) : renderTextWithLineBreaksAndLinks(shortDescription + (isLongDescription ? '...' : ''))}

                                    {isLongDescription && (
                                        <>
                                            <br />
                                            <span
                                                className="text-gray-800 text-md font-medium cursor-pointer hover:underline"
                                                onClick={() => setExpanded(!expanded)}
                                            >
                                                {expanded ? "Show less" : "Read more"}
                                            </span>
                                        </>
                                    )}
                                </p>
                            </div>

                            <div className="text-md font-normal text-gray-500 mt-4 flex justify-between">
                                <span className="text-gray-700 font-medium">
                                    {currentDealStatus === "done" ? 'Delivery date' : 'Expected delivery date'}
                                </span>
                                <span>{currentDealDeliveryDate ? formatDate(currentDealDeliveryDate) : formatDate(expectedDeliveryDate)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-700 font-medium">Status:</span>
                                <div className="font-normal text-center text-gray-800">


                                    <Badge variant="outline" className="bg-blue-100 font-medium text-blue-700 border-0 text-xs">
                                        {currentDealStatus === "done" &&
                                            <> <CheckIcon className="mr-1 w-4 h-4 text-blue-700" />
                                                Deal completed
                                            </>
                                        }
                                        {currentDealStatus === "ongoing" &&
                                            <> <SoupIcon className="mr-1 w-4 h-4 text-blue-700" />
                                                Deal in progress
                                            </>
                                        }
                                        {currentDealStatus === "pending" &&
                                            <> <LoaderIcon className="mr-1 w-4 h-4 text-blue-700" />
                                                Waiting for confirmation
                                            </>
                                        }
                                    </Badge>


                                </div>
                            </div>
                        </div>
                    </div>
                )}
                <div className="w-full bg-white p-4 pb-1 border-t border-gray-200">
                    <div className="mb-4">
                        <LinkBtn
                            classname="w-full "
                            icon={Copy}
                            text="Copy & Share Deal"
                            onClick={handleCopyLink}
                        />
                    </div>

                    {currentPaymentStatus === 'paid' && (
                        <div className="mb-4">
                            <PrimaryBtn
                                text="Close"
                                onClick={handleClose}
                            />
                        </div>
                    )}

                    {renderActions()}
                </div>
            </div>
        </div >
    );
}
