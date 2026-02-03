'use client'

import React, { useState, useRef, useEffect } from 'react';
import { GiphyFetch } from '@giphy/js-fetch-api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Search, Image as ImageIcon, X } from 'lucide-react';

// Initialize Giphy - requires a valid API key
// Get a free API key at: https://developers.giphy.com/dashboard/
// Add it to your .env.local file as: NEXT_PUBLIC_GIPHY_API_KEY=your_key_here
const giphyApiKey = process.env.NEXT_PUBLIC_GIPHY_API_KEY;
const gf = giphyApiKey ? new GiphyFetch(giphyApiKey) : null;

interface MessageInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  className?: string;
  gifUrl?: string | null;
  onGifChange?: (gifUrl: string | null) => void;
}

export function MessageInput({ value, onChange, placeholder = "Type a message...", maxLength = 500, className, gifUrl, onGifChange }: MessageInputProps) {
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [gifSearchQuery, setGifSearchQuery] = useState('');
  const [trendingGifs, setTrendingGifs] = useState<any[]>([]);
  const [searchGifs, setSearchGifs] = useState<any[]>([]);
  const [isLoadingGifs, setIsLoadingGifs] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  
  // Internal state for GIF if not controlled
  const [internalGifUrl, setInternalGifUrl] = useState<string | null>(null);
  const currentGifUrl = gifUrl !== undefined ? gifUrl : internalGifUrl;
  const handleGifChange = onGifChange || setInternalGifUrl;

  // Load money-related GIFs when GIF picker opens (default to money-related)
  useEffect(() => {
    if (showGifPicker && trendingGifs.length === 0 && !gifSearchQuery) {
      loadMoneyGifs();
    }
  }, [showGifPicker]);

  const loadTrendingGifs = async () => {
    if (!gf) {
      console.warn('Giphy API key not configured');
      setTrendingGifs([]);
      return;
    }
    setIsLoadingGifs(true);
    try {
      const { data } = await gf.trending({ limit: 20 });
      setTrendingGifs(data);
    } catch (error: any) {
      console.error('Error loading trending GIFs:', error);
      // Set empty array on error to prevent infinite loading
      setTrendingGifs([]);
    } finally {
      setIsLoadingGifs(false);
    }
  };

  const loadMoneyGifs = async () => {
    if (!gf) {
      console.warn('Giphy API key not configured');
      setTrendingGifs([]);
      return;
    }
    setIsLoadingGifs(true);
    try {
      const { data } = await gf.search('money', { limit: 20 });
      setTrendingGifs(data);
    } catch (error: any) {
      console.error('Error loading money GIFs:', error);
      // Set empty array on error to prevent infinite loading
      setTrendingGifs([]);
    } finally {
      setIsLoadingGifs(false);
    }
  };

  const handleGifSearch = async (query: string) => {
    if (!gf) {
      console.warn('Giphy API key not configured');
      setSearchGifs([]);
      return;
    }
    setGifSearchQuery(query);
    if (!query.trim()) {
      loadMoneyGifs();
      setSearchGifs([]);
      return;
    }
    setIsLoadingGifs(true);
    try {
      const { data } = await gf.search(query, { limit: 20 });
      setSearchGifs(data);
    } catch (error: any) {
      console.error('Error searching GIFs:', error);
      // Set empty array on error to prevent infinite loading
      setSearchGifs([]);
    } finally {
      setIsLoadingGifs(false);
    }
  };

  const handleGifClick = (gif: any) => {
    const selectedGifUrl = gif.images.original.url;
    handleGifChange(selectedGifUrl);
    setShowGifPicker(false);
    inputRef.current?.focus();
  };
  
  const handleRemoveGif = () => {
    handleGifChange(null);
  };

  const insertText = (text: string) => {
    const cursorPos = inputRef.current?.selectionStart || value.length;
    const newValue = value.slice(0, cursorPos) + text + value.slice(cursorPos);
    onChange(newValue);
    setTimeout(() => {
      inputRef.current?.setSelectionRange(cursorPos + text.length, cursorPos + text.length);
      inputRef.current?.focus();
    }, 0);
  };

  return (
    <div className={className}>
      {/* GIF Attachment Preview */}
      {currentGifUrl && (
        <div className="mb-2 relative inline-block">
          <div className="relative rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
            <img
              src={currentGifUrl}
              alt="Selected GIF"
              className="max-h-32 w-auto object-contain"
            />
            <button
              type="button"
              onClick={handleRemoveGif}
              className="absolute top-1 right-1 bg-black/60 hover:bg-black/80 text-white rounded-full p-1 transition-colors"
              aria-label="Remove GIF"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      
      <div className="relative">
        <Input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          className="pr-12 text-base"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          <Popover open={showGifPicker} onOpenChange={setShowGifPicker}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-gray-500 hover:text-gray-700"
                disabled={!gf}
                title={!gf ? 'Giphy API key required' : 'Search GIFs'}
              >
                <ImageIcon className="h-5 w-5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[350px] sm:w-[400px] p-0 border-0 shadow-xl" align="end" side="top">
              <div className="bg-white rounded-lg">
                {!gf ? (
                  <div className="p-6 text-center">
                    <div className="text-sm text-gray-600 mb-2">
                      Giphy API key not configured
                    </div>
                    <div className="text-xs text-gray-500 mb-4">
                      Get a free API key at{' '}
                      <a
                        href="https://developers.giphy.com/dashboard/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        developers.giphy.com
                      </a>
                    </div>
                    <div className="text-xs text-gray-500">
                      Add to <code className="bg-gray-100 px-1 py-0.5 rounded">.env.local</code>:
                      <br />
                      <code className="bg-gray-100 px-1 py-0.5 rounded">NEXT_PUBLIC_GIPHY_API_KEY=your_key</code>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Search bar */}
                    <div className="p-3 border-b border-gray-200 sticky top-0 bg-white z-10">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <Input
                          type="text"
                          value={gifSearchQuery}
                          onChange={(e) => handleGifSearch(e.target.value)}
                          placeholder="Search GIFs..."
                          className="pl-9 pr-9 h-9 text-sm"
                        />
                        {gifSearchQuery && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                            onClick={() => {
                              setGifSearchQuery('');
                              loadMoneyGifs();
                              setSearchGifs([]);
                            }}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* GIF Grid */}
                    <div className="max-h-[400px] overflow-y-auto p-3">
                      {isLoadingGifs ? (
                        <div className="flex items-center justify-center py-8">
                          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-2">
                          {(gifSearchQuery ? searchGifs : trendingGifs).map((gif) => (
                            <button
                              key={gif.id}
                              type="button"
                              onClick={() => handleGifClick(gif)}
                              className="relative aspect-square rounded-lg overflow-hidden hover:opacity-80 transition-opacity bg-gray-100"
                            >
                              <img
                                src={gif.images.fixed_height_small.url}
                                alt={gif.title || 'GIF'}
                                className="w-full h-full object-cover"
                                loading="lazy"
                                crossOrigin="anonymous"
                                onError={(e) => {
                                  console.error('Failed to load GIF image:', gif.images.fixed_height_small.url);
                                  // Try fallback to original URL
                                  const target = e.target as HTMLImageElement;
                                  if (target.src !== gif.images.original.url) {
                                    target.src = gif.images.original.url;
                                  }
                                }}
                              />
                            </button>
                          ))}
                        </div>
                      )}
                      {!isLoadingGifs && (gifSearchQuery ? searchGifs : trendingGifs).length === 0 && (
                        <div className="text-center py-8 text-gray-500 text-sm">
                          {giphyApiKey ? 'No GIFs found' : 'Giphy API key required'}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
      {maxLength && (
        <div className="text-xs text-gray-500 mt-1 text-right">
          {value.length}/{maxLength}
        </div>
      )}
    </div>
  );
}
