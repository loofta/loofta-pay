import React, { useState } from 'react';
import { Badge } from './ui/badge';
import { useTonConnectUI } from '@tonconnect/ui-react';
import SecondaryBtn from './SecondaryBtn';
import PrimaryBtn from './PrimaryBtn';

interface AddressPillProps {
    address?: string;
}

export default function AddressPill({ address }: AddressPillProps) {
    const [tonConnectUI] = useTonConnectUI();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isClosing, setIsClosing] = useState(false);

    const disconnectWallet = async () => {
        await tonConnectUI.disconnect();
        handleCloseModal(); // Close modal after disconnecting
    };

    const handleCloseModal = () => {
        setIsClosing(true);
        setTimeout(() => {
            setIsModalOpen(false);
            setIsClosing(false);
        }, 300); // Match the animation duration
    };

    if (!address || address.length < 8) {
        return <div>Invalid address</div>;
    }

    const start = address.slice(0, 4);
    const end = address.slice(-4);

    return (
        <>
            <Badge variant="outline" onClick={() => setIsModalOpen(true)}>
                {start}...{end}
            </Badge>

            {isModalOpen && (
                <>
                    {/* Overlay */}
                    <div
                        id="modalOverlay"
                        className="fixed inset-0 bg-black opacity-50 z-40"
                        onClick={handleCloseModal} // Close on outside click
                    ></div>

                    {/* Modal Content */}
                    <div className={`fixed bottom-0 left-0 right-0 z-50 p-4 bg-white rounded-t-lg shadow-lg ${isClosing ? 'animate-slide-down' : 'animate-slide-up'}`}>
                        {/* Close Cross */}
                        <div className="absolute top-2 right-2 cursor-pointer text-gray-500" onClick={handleCloseModal}>
                            <span className='inline-flex'>
                                Close
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </span>
                        </div>

                        <div className="mt-6 text-center">
                            <h2 className="text-lg font-semibold">Disconnect Your Wallet</h2>
                            <p className="text-gray-600">
                                Are you sure you want to disconnect your wallet from Loofta? You can always reconnect it.
                            </p>
                        </div>

                        <div className="flex flex-col space-y-2 mt-4 mb-4">
                            <SecondaryBtn
                                className='py-2 px-4'
                                text='Cancel'
                                onClick={handleCloseModal}
                            >
                            </SecondaryBtn>
                            <PrimaryBtn
                                text=' Yes, Disconnect'
                                onClick={disconnectWallet}
                            >

                            </PrimaryBtn>
                        </div>
                    </div>
                </>
            )}
        </>
    );
}
