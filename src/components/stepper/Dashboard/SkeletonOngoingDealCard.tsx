'use client'

export default function SkeletonOngoingDealCard() {

    const Skeleton = () => {
        return (
            <div className="flex w-full bg-white border-b-2 border-l-stone-700 border-opacity-50 flex-col p-4">
                <div className="animate-pulse">
                    <div className="flex justify-between mb-2">
                        <div className="bg-gray-300 h-4 w-1/4 rounded"></div>
                        <div className="flex items-center space-x-2">
                            <div className="bg-gray-300 h-4 w-1/5 rounded"></div>
                            <div className="bg-gray-300 h-4 w-8 rounded"></div>
                        </div>
                    </div>
                    <div className="bg-gray-300 h-4 w-full rounded"></div>
                </div>
                <div className="flex justify-end my-2 animate-pulse">
                    <div className="bg-gray-300 h-4 w-1/4 rounded"></div>
                </div>
            </div>
        );
    }

    return (
        <div>
            {Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} />
            ))}
        </div>
    );
}
