import { useState } from "react";

const useCopy = () => {
    const [copiedText, setCopiedText] = useState<any>(null);

  const copy = async (text: string) => {
    if (!navigator?.clipboard) {
      console.warn("Clipboard not supported");
      return false;
    }

    try {
      await navigator.clipboard.writeText(text);
      setCopiedText(text);
    } catch (error) {
      console.error(`Failed copying the text ${text}`, error);
      setCopiedText(null);
    }
  };

  return [copiedText, copy];
};

export default useCopy;