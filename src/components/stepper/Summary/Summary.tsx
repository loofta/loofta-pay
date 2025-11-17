'use client';
import { useState } from "react";
import { useRouter } from 'next/navigation';
import PrimaryBtn from "@/components/PrimaryBtn";
import SecondaryBtn from "@/components/SecondaryBtn";
import Subtitle from "../../Subtitle";
import Title from "../../Title";
import SummarySection from "./SummarySection";
import Congrats from "../Congrats/Congrats";
import PreviousButton from "@/components/PreviousButton"; // Import PreviousButton
import { Freelancer } from "@/app/utils/interfaces";

interface SummaryProps {
    description: string;
    amount: string;
    recipientWalletAddress: string;
    recipient: Freelancer | null;
    delivery: string;
    dealId: string;
    onPayLater: () => void;
}

export default function Summary({ dealId, description, amount, recipientWalletAddress, recipient, delivery, onPayLater }: SummaryProps) {
    const [showCongrats, setCongrats] = useState(false);
    const router = useRouter();

    return (
        showCongrats ? (
            <Congrats dealId={dealId} amount={amount} />
        ) : (
            <div className=" flex flex-col">
                <div className='flex mt-2'>
                    <PreviousButton onBack={() => router.back()} />  {/* Use the PreviousButton component */}
                </div>
                <div className="flex-1 overflow-y-auto space-y-4 p-4">
                    <Title text="Summary" />
                    <div className="p-4 shadow-lg rounded-lg space-y-4 bg-orange-50">
                        <SummarySection title="Description" content={description} isCensored={false} />
                        <SummarySection title="Recipient" content={recipient?.fullName + ' | @' + recipient?.telegramHandle} isCensored={false} />
                        <SummarySection title="Amount" content={amount + " USDT"} isCensored={false} />
                        <SummarySection title="Delivery Date" content={delivery} isCensored={false} />
                    </div>
                </div>

            </div>
        )
    );
}
