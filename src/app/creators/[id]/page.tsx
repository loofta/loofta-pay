'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import WebApp from '@twa-dev/sdk';
import Title from '@/components/Title';
import { Badge } from "@/components/ui/badge";
import { Twitter, Github, Globe, MessageSquareText, Briefcase, Pin, Wallet, Copy, NotepadText, BadgeCheck, MapPinIcon } from "lucide-react";
import PrimaryBtn from "@/components/PrimaryBtn";
import { getFreelancerById } from '@/app/actions/freelancers/freelancers';
import PreviousButton from '@/components/PreviousButton';
import LoadingScreen from '@/components/LoadingScreen';
import { Freelancer } from '@/app/utils/interfaces';
import { toast } from "@/components/ui/use-toast";
import SecondaryBtn from '@/components/SecondaryBtn';
import LinkBtn from '@/components/LinkBtn';
import { CREATE_DEAL_ROUTE, FREELANCER_DETAILS_ROUTE } from '@/app/utils/routes';
import DashboardLayout from '@/components/layouts/DashboardLayout';
import { usePrivy } from '@privy-io/react-auth';
import { isCreatorAccessGranted } from '@/app/actions/creators/creators';
import Subtitle from '@/components/Subtitle';

export default function FreelancerDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { user } = usePrivy();
  const [freelancer, setFreelancer] = useState<Freelancer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [hasCommunicated, setHasCommunicated] = useState(false); // Track if communication was made
  const [isModalOpen, setIsModalOpen] = useState(false); // Track modal visibility
  const [hasAccess, setHasAccess] = useState(false);

  const handleContinueDeal = () => {
    // Navigate to start deal flow
    router.push(CREATE_DEAL_ROUTE + `?freelancerId=${freelancer?.id}`);
  };

  const handleOutsideClick = (e: any) => {
    if (e.target.id === 'modalOverlay') {
      setIsModalOpen(false);
    }
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      WebApp.expand();
    }

    async function checkAccess() {
      if (user?.id) {
        const access = await isCreatorAccessGranted(user.id);
        setHasAccess(access);
        if (!access) {
          router.push('/creators');
        }
      }
    }

    async function fetchFreelancer() {
      try {
        const fetchedFreelancer = await getFreelancerById(params.id);
        setFreelancer(fetchedFreelancer);
      } catch (error) {
        console.error("Error fetching freelancer:", error);
      } finally {
        setIsLoading(false);
      }
    }

    checkAccess();
    fetchFreelancer();
  }, [params.id, user?.id, router]);

  if (isLoading) {
    return <LoadingScreen text="Loading..." isVisible={true} />;
  }

  if (!hasAccess) {
    return null;
  }

  if (!freelancer) {
    return <div>Freelancer not found</div>;
  }

  const handleTalkClick = () => {
    window.open(`https://t.me/${freelancer.telegramHandle.replace('@', '')}`, '_blank');
    setHasCommunicated(true); // Mark that communication happened
  };

  const handleLinkClick = (url: string) => {
    window.open(url, '_blank');
  };

  const shortDescription = freelancer.description.split(" ").slice(0, 15).join(" ");
  const isLongDescription = freelancer.description.split(" ").length > 15;

  const handleCopyWalletAddress = () => {
    if (freelancer) {
      navigator.clipboard.writeText(freelancer.walletAddress);
      toast({
        title: "Copied!",
        description: "Wallet address copied to clipboard.",
      });
    }
  };

  const handleCopyProfileLink = () => {
    const profileLink = `${window.location.origin}${FREELANCER_DETAILS_ROUTE(params.id)}`;
    navigator.clipboard.writeText(profileLink);
    toast({
      title: "Copied!",
      description: "Profile link copied to clipboard.",
    });
  };

  return (
    <DashboardLayout>
      <div className='h-screen tg-webview flex flex-col relative'>
        <div className='flex-1 overflow-y-auto p-4'>
          <div className="mb-6">
            <Title text="Creator Profile" showWallet={false} showPrevious={true} />
            <Subtitle text={`Start a deal with ${freelancer?.fullName}`} customProperties="mt-4" />
          </div>

          <div className="max-w-4xl mx-auto">
            <div className={`
              rounded-lg p-6 relative
              ${freelancer.status === 'platinium'
                ? 'bg-gradient-to-r from-orange-50/50 to-white border-2 border-orange-400 shadow-lg'
                : 'bg-white border border-gray-200'
              }
            `}>
              {/* Platinium Top Creator Badge */}
              {freelancer.status === 'platinium' && (
                <div className="absolute -top-3 -right-px bg-orange-600 text-white px-4 py-1 rounded-full font-medium shadow-md">
                  Top Creator
                </div>
              )}

              <div className="flex text-lg font-semibold mb-4 justify-center relative">
                <span className='text-2xl flex items-center'>
                  {freelancer.status === 'platinium' && <span className="text-2xl mr-2">💎</span>}
                  {freelancer.fullName}
                  {freelancer.status !== 'unverified' && (
                    <span className={`w-5 h-5 ml-1 ${freelancer.status === 'platinium' ? 'text-orange-500' :
                      freelancer.status === 'vip' ? 'text-yellow-500' :
                        'text-blue-500'
                      }`}>
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                        <path fillRule="evenodd" d="M8.603 3.799A4.49 4.49 0 0112 2.25c1.357 0 2.573.6 3.397 1.549a4.49 4.49 0 013.498 1.307 4.491 4.491 0 011.307 3.497A4.49 4.49 0 0121.75 12a4.49 4.49 0 01-1.549 3.397 4.491 4.491 0 01-1.307 3.497 4.491 4.491 0 01-3.497 1.307A4.49 4.49 0 0112 21.75a4.49 4.49 0 01-3.397-1.549 4.49 4.49 0 01-3.498-1.306 4.491 4.491 0 01-1.307-3.498A4.49 4.49 0 012.25 12c0-1.357.6-2.573 1.549-3.397a4.49 4.49 0 011.307-3.497 4.49 4.49 0 013.497-1.307zm7.007 6.387a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
                      </svg>
                    </span>
                  )}
                </span>
              </div>

              {freelancer.status !== 'unverified' && (
                <div className='flex text-md font-semibold justify-between space-x-1 mb-4 bg-orange-50'>
                  {freelancer.engagementRate && (
                    <Badge variant="outline" className="rounded-md text-center w-full flex flex-col border-0">
                      <span className='inline-flex text-lg'>
                        <span className='mr-2'>
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-6"> <path strokeLinecap="round" strokeLinejoin="round" d="M6.633 10.25c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 0 1 2.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 0 0 .322-1.672V2.75a.75.75 0 0 1 .75-.75 2.25 2.25 0 0 1 2.25 2.25c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282m0 0h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 0 1-2.649 7.521c-.388.482-.987.729-1.605.729H13.48c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 0 0-1.423-.23H5.904m10.598-9.75H14.25M5.904 18.5c.083.205.173.405.27.602.197.4-.078.898-.523.898h-.908c-.889 0-1.713-.518-1.972-1.368a12 12 0 0 1-.521-3.507c0-1.553.295-3.036.831-4.398C3.387 9.953 4.167 9.5 5 9.5h1.053c.472 0 .745.556.5.96a8.958 8.958 0 0 0-1.302 4.665c0 1.194.232 2.333.654 3.375Z" /> </svg>
                        </span>
                        {freelancer.engagementRate ? (freelancer.engagementRate * 100).toFixed(0) : 0}%
                      </span>
                      <span className='font-normal text-md  ml-1 text-gray-600'>Engagement Rate</span>
                    </Badge>
                  )}
                  <Badge variant="outline" className="rounded-md text-center w-full  flex flex-col border-0">
                    <span className='inline-flex text-lg'>
                      <span className='mr-2'>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-6">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
                        </svg>
                      </span>
                      {freelancer.followersCount}</span>
                    <span className='font-normal ml-1   text-gray-600'>Followers</span>
                  </Badge>
                </div>
              )}

              <div className="flex items-center justify-center space-x-2 mb-4 ">
                {freelancer.twitterHandle && (
                  <Badge variant="outline" className="rounded-full py-1 px-2 cursor-pointer text-md font-medium" onClick={() => handleLinkClick(`https://x.com/${freelancer.twitterHandle?.replace('@', '')}`)}>
                    <Twitter className="w-4 h-4 text-black mr-1" /> Twitter
                  </Badge>
                )}
                {freelancer.github && (
                  <Badge variant="outline" className="rounded-full p-1 px-2 cursor-pointer text-md font-medium" onClick={() => handleLinkClick(freelancer.github!)}>
                    <Github className="w-4 h-4 text-black mr-1" /> GitHub
                  </Badge>
                )}
                {freelancer.website && (
                  <Badge variant="outline" className="rounded-full py-1 px-2 cursor-pointer text-md font-medium" onClick={() => handleLinkClick(freelancer.website!)}>
                    <Globe className="w-4 h-4 text-black mr-1" /> Website
                  </Badge>
                )}
              </div>

              <div className="flex flex-col space-y-2 mb-4">
                <h3 className='font-sans text-xl font-medium italic'>I am</h3>
                <span className={`text-xl mb-6 ${freelancer.status === 'platinium' ? 'text-gray-800' : 'text-gray-600'
                  }`}>
                  {freelancer.jobTitle}
                </span>
              </div>

              <div className="flex flex-col space-y-2 mb-4">
                <h3 className='font-sans text-xl font-medium italic'>I can do</h3>
                <span className={`${freelancer.status === 'platinium' ? 'text-gray-800' : 'text-gray-600'
                  } text-lg`}>
                  {freelancer.services}
                </span>
              </div>

              <div className="flex flex-col space-y-2 mb-4">
                <h3 className='font-sans text-xl font-medium italic'>About me</h3>
                <p className={`${freelancer.status === 'platinium' ? 'text-gray-800' : 'text-gray-600'
                  } text-lg mb-6`}>
                  {expanded ? freelancer.description : shortDescription}
                  {isLongDescription && (
                    <>  <br />
                      <span
                        className="text-gray-900 text-md font-medium cursor-pointer hover:underline"
                        onClick={() => setExpanded(!expanded)}
                      >
                        {expanded ? "Show less" : "Read more"}
                      </span>
                    </>
                  )}
                </p>
              </div>
            </div>

            {/* Desktop CTA section */}
            <div className="hidden lg:block mt-6">
              <div className="flex flex-col gap-3">
                <LinkBtn
                  icon={Copy}
                  text='Copy & Share Profile'
                  onClick={handleCopyProfileLink}
                  className="w-full"
                />
                <PrimaryBtn
                  text="Start a Deal"
                  onClick={!hasCommunicated ? () => setIsModalOpen(true) : handleContinueDeal}
                  icon={Briefcase}
                  className="w-full"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Mobile CTA section */}
        <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 p-4">
          <div className="max-w-2xl mx-auto">
            <div className="flex flex-col gap-3">
              <LinkBtn
                icon={Copy}
                text='Copy & Share Profile'
                onClick={handleCopyProfileLink}
                className="w-full"
              />
              <PrimaryBtn
                text="Start a Deal"
                onClick={!hasCommunicated ? () => setIsModalOpen(true) : handleContinueDeal}
                icon={Briefcase}
                className="w-full"
              />
            </div>
          </div>
        </div>

        {/* Desktop Modal */}
        {isModalOpen && (
          <>
            <div
              id="modalOverlay"
              className="fixed inset-0 bg-black opacity-50 z-40"
              onClick={handleOutsideClick}
            ></div>

            <div className="hidden lg:block fixed inset-0 z-50">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md">
                <div className="bg-white rounded-lg shadow-lg p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-semibold">Are you ready to send your first deal request?</h2>
                    <button
                      onClick={() => setIsModalOpen(false)}
                      className="text-gray-500 hover:text-gray-700"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <p className="text-gray-600 mb-4">
                    We suggest you talk with the creator first before sending them a deal.
                  </p>
                  <div className="flex flex-col space-y-2">
                    <SecondaryBtn
                      text="Talk with Freelancer"
                      onClick={handleTalkClick}
                      icon={MessageSquareText}
                    />
                    <div className="relative">
                      <PrimaryBtn
                        text="Create Deal"
                        onClick={() => { }}
                        icon={Briefcase}
                        className="w-full opacity-50 cursor-not-allowed"
                      />
                      <div className="absolute -top-2 -right-2">
                        <span className="bg-orange-500 text-white text-xs px-2 py-1 rounded-full">Coming Soon</span>
                      </div>
                    </div>
                    <div className="mt-4 p-4 bg-orange-50 rounded-lg border border-orange-100">
                      <div className="flex items-start gap-3">
                        <div className="bg-orange-100 p-2 rounded-lg">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-orange-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                        <div>
                          <h3 className="font-medium text-orange-800">Secure Deal Creation Coming Soon</h3>
                          <p className="text-sm text-orange-700 mt-1">
                            We're building an escrow system to ensure safe transactions between clients and freelancers. This will protect both parties and ensure fair payment upon successful completion of work.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Mobile Modal */}
            <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50">
              <div className="max-w-2xl mx-auto">
                <div className="bg-white rounded-t-lg shadow-lg p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-semibold">Are you ready to send your first deal request?</h2>
                    <button
                      onClick={() => setIsModalOpen(false)}
                      className="text-gray-500 hover:text-gray-700"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <p className="text-gray-600 mb-4">
                    We suggest you talk with the creator first before sending them a deal.
                  </p>
                  <div className="flex flex-col space-y-2">
                    <SecondaryBtn
                      text="Talk with Freelancer"
                      onClick={handleTalkClick}
                      icon={MessageSquareText}
                    />
                    <div className="relative">
                      <PrimaryBtn
                        text="Create Deal"
                        onClick={() => { }}
                        icon={Briefcase}
                        className="w-full opacity-50 cursor-not-allowed"
                      />
                      <div className="absolute -top-2 -right-2">
                        <span className="bg-orange-500 text-white text-xs px-2 py-1 rounded-full">Coming Soon</span>
                      </div>
                    </div>
                    <div className="mt-4 p-4 bg-orange-50 rounded-lg border border-orange-100">
                      <div className="flex items-start gap-3">
                        <div className="bg-orange-100 p-2 rounded-lg">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-orange-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                        <div>
                          <h3 className="font-medium text-orange-800">Secure Deal Creation Coming Soon</h3>
                          <p className="text-sm text-orange-700 mt-1">
                            We're building an escrow system to ensure safe transactions between clients and freelancers. This will protect both parties and ensure fair payment upon successful completion of work.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
