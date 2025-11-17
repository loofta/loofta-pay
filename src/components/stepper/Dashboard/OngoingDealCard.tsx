'use client'

import { confirmDelivery } from "@/app/actions/deals/deals";
import { Freelancer, IOngoingDealCardProps } from "@/app/utils/interfaces";
import useSendPayment from "@/hooks/useSendPayment";
import { useEffect, useState } from "react";
import { useRouter } from 'next/navigation';
import { Timer, PartyPopper, CheckCircle, AlertTriangle, UserIcon, SendIcon, Check, SoupIcon, LoaderIcon, CheckIcon, Clock } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import en from 'javascript-time-ago/locale/en'
import TimeAgo from "javascript-time-ago";
import { useTonAddress } from "@tonconnect/ui-react";
import { toFriendlyAddress } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { getFreelancerById } from "@/app/actions/freelancers/freelancers";
import { DEAL_DETAILS_ROUTE } from "@/app/utils/routes";
import Linkify from 'react-linkify';
import { Key } from 'react';

TimeAgo.addDefaultLocale(en)

export default function OngoingDealCard({ title, dealId, dateCreated, description, amount, paymentStatus, recipientWalletAddress, dealStatus, recipientId, senderTgUsername }: IOngoingDealCardProps) {
    const [wasConfirmed, setWasConfirmed] = useState(false);
    const [currentPaymentStatus, setCurrentPaymentStatus] = useState(paymentStatus);
    const [currentDealStatus, setCurrentDealStatus] = useState(dealStatus);
    const router = useRouter();
    const { toast } = useToast();
    const timeAgo = new TimeAgo('en-US');
    const walletAddress = useTonAddress(true);
    const [freelancer, setFreelancer] = useState<Freelancer | null>(null);
    const storedProfile = window.Telegram?.WebApp?.storage?.getItem('profile') || localStorage.getItem('profile');

    useEffect(() => {
        const fetchData = async () => {
            const loadedFreelancer = await getFreelancerById(recipientId);
            setFreelancer(loadedFreelancer);
        };
        fetchData();
    }, [recipientId]);

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

    const handleDetailClick = () => {
        router.push(DEAL_DETAILS_ROUTE(dealId));
    }

    return (
        <>
            < div className="flex w-full bg-white border border-gray-200 p-4 rounded-lg shadow-sm mb-2 hover:bg-gray-50 transition cursor-pointer" onClick={handleDetailClick}>
                <div className="flex flex-col flex-grow w-auto space-y-2">
                    <div className="flex justify-between items-center text-lg font-semibold text-gray-800">
                        {/* Circle Indicator */}


                        <span>
                            {title ? title : 'Deal #' + dealId.slice(0, 4)}
                        </span>
                        <span>{amount} USDt</span>
                    </div>
                    < div className=" text-gray-700 break-all flex justify-between items-center">

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
                                        >
                                            {freelancer?.fullName || toFriendlyAddress(recipientWalletAddress)}
                                        </span>
                                    </>
                                ) : (
                                    <>
                                        {/* Freelancer view: Show sender (client telegram username) */}
                                        <span
                                            className="py-0 text-gray-800 "
                                        >
                                            {senderTgUsername ? '@' + senderTgUsername : 'Unknown'}
                                        </span>
                                    </>
                                )}
                            </Badge>


                        </div>

                        <div className="flex items-center space-x-2">
                            {currentPaymentStatus === 'paid' ? (
                                <Badge variant="outline" className="bg-green-100  font-medium text-green-700 border-0 text-xs">
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

                    <div className="text-lg font-normal text-gray-500 mt-2 flex justify-between">
                        {renderTextWithLineBreaksAndLinks(description)}
                    </div>

                    <div className="text-md text-gray-700 mt-2 flex justify-between">
                        <span className="font-light text-gray-400">{timeAgo.format(dateCreated)}</span>


                        <span className='font-normal inline-flex ml-1'>
                            <Badge variant="outline" className="bg-blue-100 font-medium text-blue-700 border-0 text-xs">

                                {currentDealStatus === "ongoing" &&
                                    <> <SoupIcon className="mr-1 w-4 h-4 text-blue-700" />
                                        In progress
                                    </>
                                }
                                {currentDealStatus === "pending" &&
                                    <> <LoaderIcon className="mr-1 w-4 h-4 text-blue-700" />
                                        Waiting
                                    </>
                                }
                                {currentDealStatus === "done" &&
                                    <> <CheckIcon className="mr-1 w-4 h-4 text-blue-700" />
                                        Done
                                    </>
                                }
                            </Badge>
                        </span>



                    </div>

                </div>
            </div >
        </>





    );
}
