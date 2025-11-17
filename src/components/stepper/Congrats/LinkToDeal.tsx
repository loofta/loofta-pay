import { getDeal } from "@/app/actions/deals/deals";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import useCopy from "@/hooks/useCopy";
import { buildDealLink } from "@/lib/utils";
import { useEffect, useState } from "react";
import { ClipboardCopy } from "lucide-react";

export default function LinkToDeal({ dealId, isCensored }: { dealId: string, isCensored: boolean }) {
    const [copiedText, copy] = useCopy();
    const [generatedLink, setGeneratedLink] = useState<string>('');
    const { toast } = useToast();
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const getDealById = async () => {
            const deal = await getDeal(dealId);
            const link = buildDealLink(dealId);
            setGeneratedLink(link || '');
            setIsLoading(false);
        };
        getDealById();
    }, [dealId]);

    return (
        <div className="flex flex-col w-full">
            <p className="font-medium text-center text-lg mb-2">Copy link and share it to the recipient</p>
            <div className="flex items-center space-x-2">
                <Input
                    placeholder={isCensored ? 'Locked' : generatedLink}
                    className={`w-full ${isLoading && "animate-pulse"} ${isCensored ? 'bg-gray-200 text-transparent bg-gradient-to-r  from-gray-200 via-gray-300 to-gray-200 bg-[length:200%_100%] bg-[position:0_0]' : ''}`}
                    readOnly
                />
                {!isCensored && generatedLink && (
                    <Button
                        variant="outline"
                        className="flex items-center space-x-1"
                        onClick={() => {
                            copy(generatedLink);
                            toast({
                                description: "Link copied to clipboard",
                            });
                        }}
                    >
                        <ClipboardCopy className="w-5 h-5" />
                        <span>Copy</span>
                    </Button>
                )}
            </div>
        </div>
    );
}
