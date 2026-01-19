import PrimaryBtn from "./PrimaryBtn";
import { useRouter } from 'next/navigation';

export default function InvalidAccess() {
    const router = useRouter();

    const handleGoBack = () => {
        router.push("/");
    };

    return (
        <div className="tg-webview flex flex-col h-screen">
            <div className="flex-1 flex flex-col items-center justify-center px-4">
                <h1 className="text-3xl font-bold text-gray-800">Invalid Access</h1>
                <p className="text-gray-500 mt-2 text-center">You are not authorized to access this page.</p>
            </div>

            <div className="w-full bg-white p-4 pb-1">
                <PrimaryBtn text="Go Back" onClick={handleGoBack} customProperties="w-full" />
            </div>
        </div>
    );
}
