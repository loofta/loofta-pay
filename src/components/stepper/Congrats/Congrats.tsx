import Title from "@/components/Title";
import { ClipboardCopy } from "lucide-react";
import LinkToDeal from "./LinkToDeal";
import { useState } from "react";
import { useToast } from "@/components/ui/use-toast";
import { useRouter } from "next/navigation";
import PrimaryBtn from "@/components/PrimaryBtn";
import MobilePillMenu from "@/components/BottomMenu";
import { DEALS_ROUTE } from "@/app/utils/routes";

export default function Congrats({ dealId, amount, displayCta = false }: { dealId: string, amount: string, displayCta?: boolean }) {

    const router = useRouter();
    const handleClose = () => {
        router.push(DEALS_ROUTE);
    }

    return (
        <>

            <Title text="Congratulations" customProperties="mx-4" />

            <div className="flex justify-center pt-24">
                <span className="text-8xl">🥳</span>
            </div>

            <div className="text-center mt-8">
                <p className="text-lg">With this deal, you earned</p>
                <p className="font-bold text-4xl">{Math.round(10 + (+amount * 0.5))} points</p>
            </div>

            <div className="w-full p-4 bg-white">
                <LinkToDeal isCensored={false} dealId={dealId} />
            </div>





        </>

    );
}
