import { useTonConnectModal } from "@tonconnect/ui-react";
import { DealStatus, PaymentStatus, Role } from "@/app/utils/types";
import {
  acceptDeal,
  confirmDelivery,
  deleteDeal,
  getDeal,
  updateTelegramRecipientInformation,
} from "@/app/actions/deals/deals";
import { Key, useEffect, useState } from "react";
import useSendPayment from "@/hooks/useSendPayment";
import MobilePillMenu from "@/components/BottomMenu";
import LoadingScreen from "@/components/LoadingScreen";
import PrimaryBtn from "@/components/PrimaryBtn";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ArrowLeft, CheckCircle, Copy, LoaderIcon, SoupIcon, TimerIcon, Clock, StarIcon, Pencil, X } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import Title from "./Title";
import { notifyDealAccepted, notifyDealDeclined, notifyDealDelivered, notifyPaymentReceived, notifyUserForPayment } from "@/services/notificationService";
import Congrats from "./stepper/Congrats/Congrats";
import { formatDate } from "@/lib/utils";
import { Badge } from "./ui/badge";
import SecondaryBtn from "./SecondaryBtn";
import { useTelegramUser } from "@/context/TelegramUserContext";
import { Freelancer } from '@/app/utils/interfaces';
import { getFreelancerById } from '@/app/actions/freelancers/freelancers';
import LinkBtn from "./LinkBtn";
import { DEALS_ROUTE } from "@/app/utils/routes";
import { formatDistanceToNow, toDate } from 'date-fns';
import Image from 'next/image';
import Linkify from 'react-linkify';
import { uploadImg } from "@/app/actions/deals/uploadImg";
import { Input } from "@/components/ui/input";
import WebApp from '@twa-dev/sdk';

interface ViewDealFreelancerProps {
  title?: string;
  description: string;
  amount: string;
  points?: number;
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
  requireSubmission?: boolean;
  submissions?: string[];
}

export default function ViewDealFreelancer({
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
  requireSubmission,
  submissions,
}: ViewDealFreelancerProps) {
  const { open } = useTonConnectModal();
  const { sendPayment, verifyPaymentStatus } = useSendPayment();
  const { toast } = useToast();
  const router = useRouter();
  const { userData } = useTelegramUser();
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
  const [expanded, setExpanded] = useState(true);
  const [showCongrats, setShowCongrats] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);
  const [freelancer, setFreelancer] = useState<Freelancer | null>(null);
  const [localSubmissions, setLocalSubmissions] = useState<string[]>(() => {
    console.log('Initial submissions:', submissions);
    return submissions || [];
  });
  const [currentInput, setCurrentInput] = useState("");
  const [isSubmissionConfirmed, setIsSubmissionConfirmed] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const MAX_SUBMISSIONS = 10;
  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
  const ALLOWED_FILE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

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

    if (id !== null) {
      fetchData();
    }
  }, [id]);

  useEffect(() => {
    if (submissions) {
      if (typeof submissions === 'string') {
        try {
          setLocalSubmissions(JSON.parse(submissions));
        } catch {
          setLocalSubmissions([]);
        }
      } else {
        setLocalSubmissions(submissions);
      }
    }
  }, [submissions]);

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


  // Function to accept the deal
  const handleAcceptDeal = async () => {
    setIsLoading(true);
    await acceptDeal(id);
    const deal = await getDeal(id);
    if (deal?.deal) {
      setCurrentDealStatus(deal.deal.dealStatus);
      setCurrentPaymentStatus(deal.deal.paymentStatus);
      notifyDealAccepted(id, deal.deal.senderTgId);
      if (userData?.id && userData?.username) {
        updateTelegramRecipientInformation(id, userData.id, userData.username.toLowerCase());
      }
    }
    setIsLoading(false);
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


  const handleCloseConfirmModal = () => {
    setIsConfirmModalOpen(false);
  }

  const handleCloseAcceptModal = () => {
    setIsAcceptModalOpen(false);
  }
  const handleCloseDeclineModal = () => {
    setIsDeclineModalOpen(false);
  }


  // Function to confirm the delivery
  const handleConfirmDelivery = async () => {
    if (requireSubmission && localSubmissions.length === 0) {
      toast({
        title: "Submission required",
        description: "Please provide at least one link to your work.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    await confirmDelivery(id, JSON.stringify(localSubmissions)); // Send as JSON string
    const deal = await getDeal(id);
    if (deal?.deal) {
      notifyDealDelivered(id, deal.deal.senderTgId);
      setCurrentDealDeliveryDate(new Date(Date.now()).toISOString());
      setCurrentDealStatus(deal.deal.dealStatus);
      setCurrentPaymentStatus(deal.deal.paymentStatus);
    }
    setIsLoading(false);
  };

  // Function to decline the deal
  const handleDeclineDeal = async () => {
    setIsLoading(true);
    const response = await deleteDeal(id);
    if (response.success) {
      notifyDealDeclined(response?.deal?.id, response?.deal?.senderTgId);
      toast({
        title: "Deal declined",
        description: "Deal has been successfully declined.",
      });
      router.push(DEALS_ROUTE);
    }
    setIsLoading(false);
  };

  // Function to request payment
  const handleRequestPayment = async () => {
    if (isRequesting) {
      toast({
        title: "Request in progress",
        description: "Please wait until the current request is completed.",
      });
      return;
    }
    setIsRequesting(true);

    if (senderTgUsername && senderTgId) {
      try {
        await notifyUserForPayment(senderTgId.toString(), id.toString(), amount);
        toast({
          title: amount && +amount > 0 ? "Payment successfully requested" : "Rewards successfully requested",
          description: amount && +amount > 0 ? "The client has been notified to settle the payment." : "The client has been notified to settle the rewards.",
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

  const isValidUrl = (string: string) => {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  };

  const handleAddLink = () => {
    const input = currentInput.trim();
    if (!input) return;

    // Handle common mobile input issues
    let url = input;

    // Remove any accidental spaces
    url = url.replace(/\s+/g, '');

    // Add https if missing
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    try {
      new URL(url);
      if (localSubmissions.length >= MAX_SUBMISSIONS) {
        toast({
          title: "Maximum submissions reached",
          description: `You can only submit up to ${MAX_SUBMISSIONS} items.`,
          variant: "destructive",
        });
        return;
      }
      setLocalSubmissions([...localSubmissions, url]);
      setCurrentInput("");


    } catch (_) {
      toast({
        title: "Invalid link format",
        description: "Please paste a valid link (e.g., https://twitter.com/your-post)",
        variant: "destructive",
      });
    }
  };

  const handleRemoveLink = (index: number) => {
    setLocalSubmissions(localSubmissions.filter((_, i) => i !== index));
  };

  const handleSubmissionConfirm = () => {
    console.log('Confirming submissions:', localSubmissions);
    if (requireSubmission && localSubmissions.length === 0) {
      toast({
        title: "Submission required",
        description: "Please provide at least one link to your work.",
        variant: "destructive",
      });
      return;
    }
    setIsSubmissionConfirmed(true);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files || !event.target.files[0]) return;

    const file = event.target.files[0];

    // Validate file type
    if (!ALLOWED_FILE_TYPES.includes(file.type)) {
      toast({
        title: "Invalid file type",
        description: "Please upload only images (JPG, PNG, GIF, WebP)",
        variant: "destructive",
      });
      return;
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      toast({
        title: "File too large",
        description: "Please upload images under 5MB",
        variant: "destructive",
      });
      return;
    }

    // Check total submissions
    if (localSubmissions.length >= MAX_SUBMISSIONS) {
      toast({
        title: "Maximum submissions reached",
        description: `You can only submit up to ${MAX_SUBMISSIONS} items (links or images combined)`,
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const url = await uploadImg(formData);
      if (url) {
        setLocalSubmissions([...localSubmissions, url]);
      }
    } catch (error) {
      toast({
        title: "Upload failed",
        description: "Failed to upload image. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    try {
      e.preventDefault();
      // Use clipboard data directly
      const pastedText = e.clipboardData.getData('text');

      if (pastedText) {
        setCurrentInput(pastedText);
      } else {
        // Fallback to navigator clipboard
        const text = await navigator.clipboard.readText();
        setCurrentInput(text);
      }
    } catch (error) {
      console.error('Paste error:', error);
      toast({
        description: "Could not paste text. Please try typing manually.",
        variant: "destructive"
      });
    }
  };

  const renderActions = () => {

    if (currentDealStatus === "pending") {
      return (
        <>
          <>
            <SecondaryBtn text="Decline Deal" onClick={() => setIsDeclineModalOpen(true)} />
            <PrimaryBtn text="Accept Deal" onClick={() => setIsAcceptModalOpen(true)} />

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


          </>

        );
      } else {
        return (
          <PrimaryBtn text="Request Payment" onClick={handleRequestPayment} disabled={isRequesting} />
        );
      }

    }

  };

  const shortDescription = description.split("\\n")[0]; // Take only first paragraph
  const isLongDescription = description.split("\\n").length > 1;

  const getTimeLeft = (date: string) => {
    const targetDate = new Date(date);
    return targetDate > new Date() ? formatDistanceToNow(targetDate, { addSuffix: true }) : 'Overdue';
  };

  // Add this helper function
  const trimUrl = (url: string, maxLength = 50) => {
    return url.length > maxLength ? url.substring(0, maxLength) + '...' : url;
  };

  if (showCongrats) {
    return (
      <div className='tg-webview h-screen'>
        <div className="flex flex-col h-full">
          <div className="flex-1 h-full overflow-y-auto space-y-4 mt-8 mx-0">
            <Congrats dealId={id} amount={amount} displayCta />
          </div>
          <div className="w-full bg-white p-2 pb-1">
            <PrimaryBtn onClick={() => router.push(DEALS_ROUTE)} text="Got it!" />
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


        {isTransactionLoading ? (
          <LoadingScreen isVisible={isTransactionLoading} text={loadingText} />
        ) : (
          <div className="flex-1 overflow-y-auto space-y-4 mt-4 mx-4">
            <Title text="Deal Receipt" previousUrl={DEALS_ROUTE} showPrevious />
            <div className="p-6 bg-white rounded-xl shadow-lg space-y-4 border border-gray-200">


              <div className="text-gray-700 break-all flex justify-between items-center">
                <div className="flex items-center space-x-2">
                  {senderTgUsername === 'looftaxyz' ? (
                    <Image src="/loofta.svg" className="mx-auto" onClick={() => window.open(`https://t.me/${senderTgUsername}`, '_blank')} alt="logo" width={60} height={50} />
                  ) : (
                    <Badge variant="outline" className="text-sm">
                      <span
                        className="py-0 text-gray-800"
                        onClick={() => window.open(`https://t.me/${senderTgUsername}`, '_blank')}
                      >
                        {senderTgUsername ? '@' + senderTgUsername : 'Unknown'}
                      </span>
                    </Badge>
                  )}
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
              </div>


              <div className="flex justify-center mt-2 text-xl font-semibold text-gray-800">
                <span>{title ? title : 'Deal #' + id.slice(0, 4)}

                  <span className="ml-1 inline-flex ">
                    (
                    {currentDealStatus === "done" && (
                      <>
                        Completed
                      </>
                    )}
                    {currentDealStatus === "ongoing" && (
                      <>
                        In progress
                      </>
                    )}
                    {currentDealStatus === "pending" && (
                      <>
                        Pending
                      </>
                    )}
                    )
                  </span>
                </span>
              </div>

              <div className="text-lg font-normal text-gray-700 mt-2 flex w-full">
                <p className="whitespace-pre-wrap break-words w-full overflow-hidden">
                  {expanded ? (
                    renderTextWithLineBreaksAndLinks(description)
                  ) : (
                    <>
                      {renderTextWithLineBreaksAndLinks(shortDescription)}
                      {isLongDescription && "..."}
                    </>
                  )}
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



              <div className="flex w-full justify-between items-center">
                {currentDealDeliveryDate && dealStatus === 'done' ? (
                  <span className="flex items-center">
                    Delivered on {formatDate(currentDealDeliveryDate)}
                  </span>
                ) : (
                  <span className="flex items-center">
                    <Clock className="w-4 h-4 text-blue-500 mr-1" />
                    Delivery Expected: {getTimeLeft(expectedDeliveryDate)}
                  </span>
                )}

                {currentPaymentStatus === 'paid' && (
                  <Badge variant="outline" className="px-2 py-1 flex items-center space-x-1 bg-green-50 border-green-200">
                    <CheckCircle className="w-4 h-4 text-green-500" />
                    <span className="text-green-700">
                      {amount && +amount > 0 ? 'Payment Received' : 'Points Received'}
                    </span>
                  </Badge>
                )}
              </div>
            </div>
          </div>
        )}

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
                <PrimaryBtn text="Yes, Confirm" onClick={() => { handleAcceptDeal(); handleCloseAcceptModal() }} />
              </div>
            </div>
          </>
        )}


        {isConfirmModalOpen && (
          <>

            {/* Overlay */}
            <div
              id="modalOverlay"
              className="fixed inset-0 bg-black opacity-50 z-40"
              onClick={handleCloseConfirmModal}
            ></div>

            <div className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-white rounded-t-lg shadow-lg animate-slide-up">
              <div className="absolute top-2 right-2 cursor-pointer text-gray-500" onClick={handleCloseConfirmModal}>
                <span className='inline-flex'>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </span>
              </div>

              <div className="mt-6 text-center">
                <h2 className="text-lg font-semibold">
                  {requireSubmission && !isSubmissionConfirmed ? 'Submit your work' : 'Confirm delivery'}
                </h2>

                {requireSubmission && (
                  <div className="mt-4">
                    {!isSubmissionConfirmed ? (
                      <>
                        <div className="mb-4">
                          <div className="text-gray-600 text-sm space-y-2">
                            <p className="font-medium text-orange-600">Important: Please read carefully</p>
                            <p>
                              • If you created a post on X or other platforms, please submit the direct link to your post. Paste the link to the post then click on add link
                            </p>
                            <p>
                              • For other actions (join TG channel, follows, likes, comments, etc.), please attach screenshots as proof
                            </p>
                          </div>
                        </div>

                        <div className="space-y-4">
                          {/* Submissions list */}
                          {localSubmissions.length > 0 && (
                            <div className="flex flex-col gap-2">
                              {localSubmissions.map((link, index) => (
                                <div key={index} className="flex items-center justify-between bg-gray-50 p-2 rounded-lg">
                                  <a
                                    href={link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-orange-600 hover:underline text-sm truncate flex-1"
                                  >
                                    {link.includes('firebasestorage') ? '📷 Screenshot' : trimUrl(link)}
                                  </a>
                                  <Button
                                    variant="ghost"
                                    onClick={() => handleRemoveLink(index)}
                                    className="text-gray-500 hover:text-red-500"
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Submission options */}
                          <div className="flex flex-col gap-3">


                            {/* Add link option */}
                            <div className="flex flex-col gap-2">
                              {/* Mobile-friendly input */}
                              <Input
                                type="text"
                                inputMode="url"
                                placeholder="Paste your link here"
                                className="w-full p-3 text-base"
                                value={currentInput}
                                onChange={(e) => setCurrentInput(e.target.value)}
                                onPaste={handlePaste}
                                autoCapitalize="none"
                                autoCorrect="off"
                                autoComplete="off"
                                spellCheck="false"
                                enterKeyHint="done"
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.currentTarget.blur();
                                    handleAddLink();
                                  }
                                }}
                              />

                              {/* Separate button for better mobile UX */}
                              <Button
                                variant="outline"
                                onClick={handleAddLink}
                                disabled={!currentInput.trim() || localSubmissions.length >= MAX_SUBMISSIONS}
                                className="w-full py-3 border-orange-200 text-orange-600 hover:bg-orange-50 text-base font-medium"
                              >
                                Add Link
                              </Button>
                            </div>

                            {/* Upload image option */}
                            <div className="w-full">
                              <input
                                type="file"
                                id="file-upload"
                                className="hidden"
                                accept={ALLOWED_FILE_TYPES.join(',')}
                                onChange={handleFileUpload}
                                disabled={localSubmissions.length >= MAX_SUBMISSIONS || isUploading}
                              />
                              <label
                                htmlFor="file-upload"
                                className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 border-dashed border-orange-200 
                                  ${localSubmissions.length >= MAX_SUBMISSIONS ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-orange-50'}`}
                              >
                                {isUploading ? (
                                  <LoaderIcon className="h-4 w-4 animate-spin text-orange-600" />
                                ) : (
                                  <span className="text-xl">📷</span>
                                )}
                                <span className="text-orange-600 text-sm font-medium">
                                  {isUploading ? "Uploading..." : "Upload Screenshot"}
                                </span>
                              </label>
                            </div>

                            {/* Submission counter */}
                            <div className="text-sm text-gray-500 text-right">
                              {localSubmissions.length}/{MAX_SUBMISSIONS} submissions
                            </div>
                          </div>

                          <PrimaryBtn
                            text="Submit Work"
                            onClick={handleSubmissionConfirm}
                            className="mt-4 w-full"
                            disabled={localSubmissions.length === 0}
                          />
                        </div>
                      </>
                    ) : (
                      <div className="mt-4">
                        <div className="bg-gray-50 p-3 rounded-lg">
                          <div className="flex items-center justify-between mb-2">
                            <p className="font-medium">Submitted Links:</p>
                            <Button
                              variant="outline"
                              onClick={() => {
                                console.log('Edit clicked, submissions:', submissions);
                                console.log('Current localSubmissions:', localSubmissions);
                                setIsSubmissionConfirmed(false);
                                if (submissions?.length) {
                                  setLocalSubmissions(submissions);
                                }
                                setIsConfirmModalOpen(true);
                              }}
                              className="text-sm flex items-center gap-1 border-orange-200 text-orange-600 hover:bg-orange-50"
                            >
                              <Pencil className="h-4 w-4" />
                              Edit
                            </Button>
                          </div>
                          <div className="space-y-2">
                            {localSubmissions.map((link, index) => (
                              <a
                                key={index}
                                href={link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-orange-600 hover:underline text-sm block truncate"
                              >
                                {trimUrl(link)}
                              </a>
                            ))}
                          </div>
                        </div>
                        <p className="text-gray-600 mt-4">
                          Are you sure you want to confirm the delivery?
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {(!requireSubmission || isSubmissionConfirmed) && (
                  <div className="flex flex-col space-y-2 mt-4 mb-4">
                    <SecondaryBtn text="Cancel" onClick={handleCloseConfirmModal} />
                    <PrimaryBtn
                      text="Yes, Confirm Delivery"
                      onClick={() => { handleConfirmDelivery(); handleCloseConfirmModal(); }}
                    />
                  </div>
                )}
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

        <div className="w-full bg-white p-4 pb-1 border-t border-gray-200">
          {getTimeLeft(expectedDeliveryDate) === 'Overdue' && dealStatus !== 'done' ? (
            <>
              <div className="mb-4 p-4 bg-orange-50 border border-orange-200 rounded-lg">
                <div className="flex items-center justify-center gap-2">
                  <span className="text-xl">⏰</span>
                  <p className="text-orange-700 text-center font-medium">
                    Delivery date has passed. Remember to deliver on time to earn rewards and maintain your reputation.
                  </p>
                </div>
              </div>
              <PrimaryBtn text="Got it!" onClick={() => router.push(DEALS_ROUTE)} />
            </>
          ) : (
            <>

              {currentDealStatus === "pending" ? (
                <>
                  <SecondaryBtn text="Decline Deal" onClick={() => setIsDeclineModalOpen(true)} />
                  <PrimaryBtn text="Accept Deal" onClick={() => setIsAcceptModalOpen(true)} />
                </>
              ) : currentDealStatus === "ongoing" ? (
                <PrimaryBtn text="Confirm Delivery" onClick={() => setIsConfirmModalOpen(true)} />
              ) : currentPaymentStatus !== "paid" ? (
                <>
                  {/* Add this before the request payment/rewards button */}
                  {requireSubmission && (

                    <Button
                      variant="outline"
                      onClick={() => {
                        console.log('Edit clicked, submissions:', submissions);
                        console.log('Current localSubmissions:', localSubmissions);
                        setIsSubmissionConfirmed(false);
                        if (submissions?.length) {
                          setLocalSubmissions(submissions);
                        }
                        setIsConfirmModalOpen(true);
                      }}
                      className="w-full mb-2 border-orange-200 text-orange-600 hover:bg-orange-50"
                    >
                      <Pencil className="w-4 h-4 mr-2" />
                      Edit Submission
                    </Button>

                  )}
                  <PrimaryBtn text={amount && +amount > 0 ? "Request Payment" : "Request Rewards"} onClick={handleRequestPayment} disabled={isRequesting} />

                </>
              ) : (
                <PrimaryBtn text="Done" onClick={() => router.push(DEALS_ROUTE)} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
