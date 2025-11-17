"use client";

import React, { useEffect, useState, useMemo } from 'react';
import Image from 'next/image';
import Select, { SingleValue } from 'react-select';
import { Freelancer } from '@/app/utils/interfaces';
import { Button } from "@/components/ui/button";
import { CalendarIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format, startOfTomorrow } from "date-fns";
import { Select as SelectShadcn, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface CreateDealFormProps {
  formData: {
    description: string;
    amount: string;
    freelancerId: string;
    expectedDeliveryDate: Date | undefined;
    valid: boolean;
  };
  setFormData: (data: any) => void;
  freelancers: Freelancer[];
}

const CreateDealForm = ({ formData, setFormData, freelancers }: CreateDealFormProps) => {
  const TokenImg = "/images/usdt.png";

  // Set default value for expectedDeliveryDate if not already set
  useEffect(() => {
    if (!formData.expectedDeliveryDate) {
      setFormData((prevData: any) => ({
        ...prevData,
        expectedDeliveryDate: startOfTomorrow(),
      }));
    }
  }, [formData.expectedDeliveryDate, setFormData]);

  const freelancerOptions = useMemo(() => freelancers.map(freelancer => ({
    ...freelancer,
    value: freelancer.id,
    label: freelancer.fullName,
  })), [freelancers]);

  const [selectedFreelancer, setSelectedFreelancer] = useState(() => {
    return freelancerOptions.find(option => option.value === formData.freelancerId) || null;
  });

  const validateForm = () => {
    return (
      formData.description &&
      formData.amount &&
      (formData.expectedDeliveryDate || startOfTomorrow()) &&
      !!selectedFreelancer
    );
  };

  useEffect(() => {
    const matchingFreelancer = freelancerOptions.find(option => option.value === formData.freelancerId);
    if (matchingFreelancer && (!selectedFreelancer || selectedFreelancer.value !== matchingFreelancer.value)) {
      setSelectedFreelancer(matchingFreelancer);
    }
  }, [formData.freelancerId, selectedFreelancer, freelancerOptions]);

  useEffect(() => {
    setFormData((prevData: any) => ({
      ...prevData,
      valid: validateForm(),
    }));
  }, [formData.description, formData.amount, formData.expectedDeliveryDate, selectedFreelancer, setFormData]);

  useEffect(() => {
    validateForm();
  }, [validateForm]);

  const handleFreelancerChange = (newValue: SingleValue<any>) => {
    const freelancerId = newValue.value;
    const selectedFreelancer = freelancerOptions.find(f => f.id === freelancerId);

    setSelectedFreelancer(selectedFreelancer ?? null);
    setFormData((prevData: any) => ({
      ...prevData,
      freelancer: selectedFreelancer,
      walletAddress: selectedFreelancer?.walletAddress,
      freelancerId: selectedFreelancer ? selectedFreelancer.value : '',
    }));
  };

  const handleInputChange = (field: string, value: string | Date | undefined) => {
    setFormData((prevData: any) => ({
      ...prevData,
      [field]: value,
    }));
  };

  const customStyles = {
    control: (provided: any) => ({
      ...provided,
      borderColor: '#e2e8f0',
      '&:hover': {
        borderColor: '#cbd5e0',
      },
    }),
    option: (provided: any, state: { isSelected: any; }) => ({
      ...provided,
      backgroundColor: state.isSelected ? '#e2e8f0' : 'white',
      color: '#1a202c',
      '&:hover': {
        backgroundColor: '#edf2f7',
      },
    }),
  };

  return (
    <div className="flex flex-col bg-gray-50 p-4 rounded-lg shadow-lg my-6 space-y-4">
      <form className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label className="pb-1 text-sm font-medium">Description</label>
          <textarea
            className="p-3 border rounded-lg text-sm"
            placeholder="Describe your request (i.e: Write one Twitter shill post from @CryptoKing)"
            rows={4}
            value={formData.description}
            onChange={(e) => handleInputChange('description', e.target.value)}
            style={{ fontSize: '16px' }}
          ></textarea>
        </div>

        <div className="flex flex-col gap-2">
          <label className="pb-1 text-sm font-medium">Amount</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              className="p-3 border rounded-lg flex-1 text-sm"
              placeholder="Set an amount to be sent"
              value={formData.amount}
              onChange={(e) => handleInputChange('amount', e.target.value)}
              style={{ fontSize: '16px' }}
              inputMode="decimal"
            />
            <SelectShadcn value="USDT">
              <SelectTrigger className="w-1/3">
                <SelectValue placeholder="USDT" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="USDT">
                    <span className="inline-flex items-center font-medium">
                      <Image alt="usdt icon" className="mr-2 h-4 w-4" width={20} height={20} src={TokenImg} />
                      USDT
                    </span>
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </SelectShadcn>
          </div>
        </div>


        <div className="flex flex-col gap-2">
          <label className="pb-1 text-lg font-medium">Freelancer</label>
          <Select
            options={freelancerOptions}
            value={selectedFreelancer}
            onChange={(newValue) => handleFreelancerChange(newValue)}
            placeholder="Search freelancer..."
            styles={customStyles}
            formatOptionLabel={({ label, status }) => (
              <div className="flex items-center">
                <span>{label}</span>
                {status && (
                  <span
                    className={`w-4 h-4 ml-1 inline-block ${status === 'verified' ? 'text-blue-500' : 'text-yellow-500'
                      }`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
                      <path
                        fillRule="evenodd"
                        d="M8.603 3.799A4.49 4.49 0 0 1 12 2.25c1.357 0 2.573.6 3.397 1.549a4.49 4.49 0 0 1 3.498 1.307 4.491 4.491 0 0 1 1.307 3.497A4.49 4.49 0 0 1 21.75 12a4.49 4.49 0 0 1-1.549 3.397 4.491 4.491 0 0 1-1.307 3.497 4.491 4.491 0 0 1-3.497 1.307A4.49 4.49 0 0 1 12 21.75a4.49 4.49 0 0 1-3.397-1.549 4.49 4.49 0 0 1-3.498-1.306 4.491 4.491 0 0 1-1.307-3.498A4.49 4.49 0 0 1 2.25 12c0-1.357.6-2.573 1.549-3.397a4.49 4.49 0 0 1 1.307-3.497 4.49 4.49 0 0 1 3.497-1.307Zm7.007 6.387a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </span>
                )}
              </div>
            )}
          />
        </div>


        <div className="flex flex-col gap-2">
          <label className="pb-1 text-sm font-medium">Expected Delivery Date</label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={"outline"}
                className="w-full justify-start text-left font-normal p-3 rounded-lg text-sm"
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {formData.expectedDeliveryDate ? format(formData.expectedDeliveryDate, "PPP") : format(startOfTomorrow(), "PPP")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={formData.expectedDeliveryDate || startOfTomorrow()}
                onSelect={(date: any) => handleInputChange('expectedDeliveryDate', date || startOfTomorrow())}
                disabled={(date: Date) => date < startOfTomorrow()}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </div>
      </form>
    </div>
  );
};

export default CreateDealForm;
