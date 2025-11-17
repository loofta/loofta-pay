'use client'

import { Freelancer, IOngoingDealCardProps, IPastDealCardProps } from "@/app/utils/interfaces";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { PartyPopper, SendIcon, UserIcon } from "lucide-react";
import { formatDate, toFriendlyAddress } from "@/lib/utils";
import { getFreelancerById } from "@/app/actions/freelancers/freelancers";
import { useEffect, useState } from "react";
import { DEAL_DETAILS_ROUTE } from "@/app/utils/routes";
import Linkify from 'react-linkify';
import { Key } from 'react';

export default function PastDealCard({ title, amount, description, expectedDeliveryDate, earnedPoints, dealId, isReceived, recipientWalletAddress, senderTgUsername, recipientId }: IPastDealCardProps) {
    const router = useRouter();
    const [freelancer, setFreelancer] = useState<Freelancer | null>(null);
    const storedProfile = window.Telegram?.WebApp?.storage?.getItem('profile') || localStorage.getItem('profile');

    useEffect(() => {
        const fetchData = async () => {
            const loadedFreelancer = await getFreelancerById(recipientId);
            setFreelancer(loadedFreelancer);
        };
        fetchData();
    }, [recipientId]);
    const handleDetailClick = () => {
        router.push(DEAL_DETAILS_ROUTE(dealId));
    };

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

    return (
        <div
            className="flex w-full bg-white border border-gray-200 p-4 rounded-lg shadow-sm mb-2 hover:bg-gray-50 transition cursor-pointer"
            onClick={handleDetailClick}
        >
            <div className="flex flex-col flex-grow w-auto space-y-2">
                <div className="flex justify-between items-center text-lg font-semibold text-gray-800">

                    <span>
                        {title ? title : 'Deal #' + dealId.slice(0, 4)}
                    </span>
                    <span>{amount} USDt</span>
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
                        {isReceived ? (
                            <Badge variant="outline" className="bg-green-100 font-medium text-green-700 border-0 text-xs">
                                Paid
                            </Badge>
                        ) : (
                            <Badge variant="outline" className="bg-green-100 font-medium text-green-700 border-0 text-xs">
                                <PartyPopper className="w-4 h-4 mr-1" />
                                {earnedPoints} Points Earned
                            </Badge>
                        )}
                    </div>
                </div>
                <div className="text-lg font-normal text-gray-500 mt-2"> 
                    {renderTextWithLineBreaksAndLinks(description)}
                </div>
                <div className="text-sm text-gray-400">
                    Delivered: {formatDate(expectedDeliveryDate)}
                </div>
            </div>
        </div>
    );
}
