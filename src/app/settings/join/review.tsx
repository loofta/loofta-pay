'use client';

import { useState } from 'react';
import { BadgeCheck, Globe, Twitter, Github, EditIcon } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import PreviousButton from '@/components/PreviousButton';
import Title from '@/components/Title';
import PrimaryBtn from '@/components/PrimaryBtn';
import SecondaryBtn from '@/components/SecondaryBtn';

interface ReviewProfileProps {
  formData: {
    fullName: string;
    twitterHandle: string;
    github?: string;
    website?: string;
    jobTitle: string;
    services: string;
    description: string;
    [key: string]: any;  // For other potential form fields
  };
  isEditMode: boolean;
  onBack: () => void;
  onConfirm: () => void;
}

export default function ReviewProfile({ formData, isEditMode, onBack, onConfirm }: ReviewProfileProps) {
  const [expanded, setExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const handleLinkClick = (url: string) => {
    window.open(url, '_blank');
  };
  const handleConfirm = () => {
    setIsLoading(true);
    onConfirm();
  };

  return (
    <div className='h-screen tg-webview flex flex-col'>
      <div className='flex-1 overflow-y-auto space-y-4 mt-4 px-4 mx-0'>
        <div className='mb-4'>
          <PreviousButton onBack={onBack} />
          <Title text="Review Your Profile" showWallet={false} customProperties='mt-2' />
        </div>

        <div className="bg-white border border-gray-200 p-6 rounded-lg shadow-sm">
          <div className="flex text-lg font-semibold mb-4 justify-center">
            <span className='text-2xl flex items-center'>{formData.fullName}</span>
          </div>

          <div className="flex items-center justify-center space-x-2 mb-4 ">
            {formData.twitterHandle && (
              <Badge variant="outline" className="rounded-full py-1 px-2 cursor-pointer text-md font-medium" onClick={() => handleLinkClick(`https://x.com/${formData.twitterHandle?.replace('@', '')}`)}>
                <Twitter className="w-4 h-4 text-black mr-1" /> Twitter
              </Badge>
            )}
            {formData.github && (
              <Badge variant="outline" className="rounded-full p-1 px-2 cursor-pointer text-md font-medium" onClick={() => handleLinkClick(formData.github!)}>
                <Github className="w-4 h-4 text-black mr-1" /> GitHub
              </Badge>
            )}
            {formData.website && (
              <Badge variant="outline" className="rounded-full py-1 px-2 cursor-pointer text-md font-medium" onClick={() => handleLinkClick(formData.website!)}>
                <Globe className="w-4 h-4 text-black mr-1" /> Website
              </Badge>
            )}
          </div>

          <div className="flex flex-col space-y-2 mb-4">
            <h3 className='font-sans text-xl font-medium italic'>I am</h3>
            <span className='text-gray-600 text-lg'>{formData.jobTitle}</span>
          </div>

          <div className="flex flex-col space-y-2 mb-4">
            <h3 className='font-sans text-xl font-medium italic'>I can do</h3>
            <span className='text-gray-600 text-lg'>{formData.services}</span>
          </div>

          <div className="flex flex-col space-y-2 mb-4">
            <h3 className='font-sans text-xl font-medium italic'>About me</h3>
            <p className="text-gray-600 text-lg mb-6">
              {expanded ? formData.description : formData.description.split(" ").slice(0, 15).join(" ")}
              {formData.description.split(" ").length > 15 && (
                <span
                  className="text-gray-800 text-md font-medium cursor-pointer hover:underline"
                  onClick={() => setExpanded(!expanded)}
                >
                  {expanded ? " Show less" : " Read more"}
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      <div className="w-full bg-white px-4 py-4">
        <SecondaryBtn
          icon={EditIcon}
          text="Make Changes"
          onClick={onBack}
        />
        <PrimaryBtn
          text={isEditMode ? "Update Profile" : "Create Profile"}
          onClick={handleConfirm}
          disabled={isLoading}
          icon={BadgeCheck}
        />
      </div>
    </div>
  );
} 