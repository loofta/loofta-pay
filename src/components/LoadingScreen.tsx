
export default function LoadingScreen({ isVisible, text }: { isVisible: boolean, text: string }) {
  return (
    <div
      className={`fixed inset-0 flex items-center justify-center bg-white transition-opacity duration-500 ${
        isVisible ? 'opacity-100 z-50' : 'opacity-0 z-[-1]'
      }`}
    >
      <span className="text-xl font-semibold text-gray-700 animate-pulse">{text}</span>
    </div>
  );
}
