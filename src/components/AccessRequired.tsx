import { useTonConnectModal, useTonWallet } from "@tonconnect/ui-react";
import PrimaryBtn from "./PrimaryBtn";

export default function AccessRequired() {
    const { state, open, close } = useTonConnectModal();
    const wallet = useTonWallet();

    const handleConnectWallet = async () => {
        if (wallet === null) {
            open();
        }
    }

    return (
        <div className="flex items-center justify-center h-screen">
            <div className="flex flex-col items-center space-y-4">
                <h1 className="text-3xl font-bold text-gray-800">Who are you?</h1>
                <p className="text-gray-500">We need to confirm that you are allowed to access this section</p>
                <PrimaryBtn text="Connect Wallet" onClick={() => handleConnectWallet()} />
            </div>
        </div>
    );

}