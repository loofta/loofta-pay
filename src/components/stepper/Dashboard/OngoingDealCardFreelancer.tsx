'use client'

import { confirmDelivery } from "@/app/actions/deals/deals";
import { Freelancer, IOngoingDealCardProps } from "@/app/utils/interfaces";
import useSendPayment from "@/hooks/useSendPayment";
import { useEffect, useState } from "react";
import { useRouter } from 'next/navigation';
import { Timer, PartyPopper, CheckCircle, AlertTriangle, UserIcon, SendIcon, Check, SoupIcon, LoaderIcon, CheckIcon, Clock, ClockIcon } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import en from 'javascript-time-ago/locale/en'
import TimeAgo from "javascript-time-ago";
import { useTonAddress } from "@tonconnect/ui-react";
import { toFriendlyAddress } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { getFreelancerById } from "@/app/actions/freelancers/freelancers";
import { DEAL_DETAILS_ROUTE } from "@/app/utils/routes";
import Image from "next/image";
import { StarIcon } from "lucide-react";
import Linkify from 'react-linkify';
import { Key } from 'react';

TimeAgo.addDefaultLocale(en)

export default function OngoingDealCardFreelancer({ title, dealId, dateCreated, description, amount, points, paymentStatus, recipientWalletAddress, dealStatus, recipientId, senderTgUsername }: IOngoingDealCardProps) {
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

  const handleDetailClick = () => {
    router.push(DEAL_DETAILS_ROUTE(dealId));
  }

  const renderTextWithLineBreaksAndLinks = (text: string) => {
    const truncatedText = text.slice(0, 50) + (text.length > 50 ? '...' : '');
    return truncatedText.split('\\n').map((line: string, index: Key | null | undefined) => (
      <span key={index}>
        <Linkify
          componentDecorator={(decoratedHref, decoratedText, key) => (
            <a href={decoratedHref} key={key} target="_blank" rel="noopener noreferrer" className="text-orange-400 underline break-all">
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
        {index !== truncatedText.split('\\n').length - 1 && <br />}
      </span>
    ));
  };

  return (
    <>
      <div className="flex w-full bg-white border border-gray-200 p-4 rounded-lg shadow-sm mb-2 hover:bg-gray-50 transition cursor-pointer relative" onClick={handleDetailClick}>


        <div className="flex flex-col flex-grow w-auto space-y-2 pl-3">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-2">
              {senderTgUsername === 'looftaxyz' ? (
                <Image src="/loofta.svg" className="mx-auto" onClick={() => window.open(`https://t.me/${senderTgUsername}`, '_blank')} alt="logo" width={60} height={50} />
              ) : (
                <Badge variant="outline" className="text-sm">
                  <span className="py-0 text-gray-800" onClick={() => window.open(`https://t.me/${senderTgUsername}`, '_blank')}>
                    {senderTgUsername ? '@' + senderTgUsername : 'Unknown'}
                  </span>
                </Badge>
              )}
            </div>

            {currentDealStatus === "pending" && (
              <Badge variant="outline" className="bg-amber-50 border-amber-200 text-amber-700 flex items-center gap-1.5">
                <ClockIcon className="w-3.5 h-3.5" />
                <span>Action Required: Review Deal</span>
              </Badge>
            )}
            {currentDealStatus === "ongoing" && (
              <Badge variant="outline" className="bg-blue-50 border-blue-200 text-blue-700 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                <span>Delivery Pending</span>
              </Badge>
            )}
            {currentDealStatus === "done" && currentPaymentStatus === "unpaid" && (
              <Badge variant="outline" className="bg-green-50 border-green-200 text-green-700 flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5" />
                <span>Delivered • Awaiting Payment</span>
              </Badge>
            )}
          </div>

          <div className="flex justify-between items-center text-lg font-semibold text-gray-800">
            <span>
              {title ? title : 'Deal #' + dealId.slice(0, 4)}
            </span>
          </div>

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

          <div className="text-lg font-normal text-gray-500 mt-2">
            {renderTextWithLineBreaksAndLinks(description)}
          </div>

          <div className="text-md text-gray-700 mt-2 flex justify-end">
            <span className="font-light text-gray-400">{timeAgo.format(dateCreated)}</span>
          </div>
        </div>
      </div>
    </>
  );
}
