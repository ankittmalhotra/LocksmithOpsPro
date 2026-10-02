'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';

type Suggestion = {
  id: string;
  name?: string;
  place_formatted?: string;
  full_address?: string;
  place_name?: string;
};

type AddressAutocompleteProps = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  required?: boolean;
  'aria-label'?: string;
};

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || '';

export default function AddressAutocomplete({
  value,
  onChange,
  className = '',
  placeholder = 'Start typing an address',
  required,
  'aria-label': ariaLabel,
}: AddressAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const requestVersion = useRef(0);
  const skipNextQuery = useRef<string | null>(null);
  const blurTimeout = useRef<number | null>(null);
  const listId = useId();

  useEffect(() => () => {
    if (blurTimeout.current !== null) window.clearTimeout(blurTimeout.current);
  }, []);

  useEffect(() => {
    const version = ++requestVersion.current;
    const query = value.trim();
    if (skipNextQuery.current === value) {
      skipNextQuery.current = null;
      setSuggestions([]);
      setLoading(false);
      return;
    }
    if (!TOKEN || query.length < 3) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setMessage('');
      try {
        const params = new URLSearchParams({
          q: query,
          country: 'CA',
          types: 'address',
          language: 'en',
          limit: '5',
          autocomplete: 'true',
          permanent: 'true',
          access_token: TOKEN,
        });
        const response = await fetch(`https://api.mapbox.com/search/geocode/v6/forward?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error('Address suggestions are unavailable right now.');
        const data = await response.json();
        if (version === requestVersion.current) {
          setSuggestions(Array.isArray(data.features) ? data.features.map((feature: any, index: number) => ({
            id: feature.id || `${query}-${index}`,
            name: feature.properties?.name,
            full_address: feature.properties?.full_address,
            place_formatted: feature.properties?.place_formatted,
            place_name: feature.place_name,
          })) : []);
          setActiveIndex(-1);
        }
      } catch (error) {
        if (!controller.signal.aborted && version === requestVersion.current) {
          setSuggestions([]);
          setMessage(error instanceof Error ? error.message : 'Address suggestions are unavailable right now.');
        }
      } finally {
        if (version === requestVersion.current) setLoading(false);
      }
    }, 300);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [value]);

  const chooseSuggestion = (suggestion: Suggestion) => {
    const address = suggestion.full_address || suggestion.place_name || [suggestion.name, suggestion.place_formatted].filter(Boolean).join(', ');
    if (address && address !== value) {
      skipNextQuery.current = address;
      onChange(address);
    }
    setSuggestions([]);
    setActiveIndex(-1);
  };

  return (
    <div className="relative">
      <input
        type="text"
        required={required}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={suggestions.length > 0}
        aria-controls={listId}
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setSuggestions([]);
          setActiveIndex(-1);
          setMessage('');
        }}
        onKeyDown={(event) => {
          if (!suggestions.length) return;
          if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((index) => (index + 1) % suggestions.length); }
          if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1)); }
          if (event.key === 'Enter' && activeIndex >= 0) { event.preventDefault(); void chooseSuggestion(suggestions[activeIndex]); }
          if (event.key === 'Escape') setSuggestions([]);
        }}
        onBlur={() => { blurTimeout.current = window.setTimeout(() => setSuggestions([]), 120); }}
        onFocus={() => {
          if (blurTimeout.current !== null) window.clearTimeout(blurTimeout.current);
          if (value.trim().length >= 3 && TOKEN) setMessage('');
        }}
        className={`${className}${loading ? ' pr-16' : ''}`}
      />
      {suggestions.length > 0 && <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-40 mt-1 max-h-64 overflow-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
        {suggestions.map((suggestion, index) => <li key={suggestion.id} role="option" aria-selected={index === activeIndex}>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => chooseSuggestion(suggestion)} className={`flex w-full items-start gap-2 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-blue-50 ${activeIndex === index ? 'bg-blue-50' : ''}`}>
            <MapPin size={15} className="mt-0.5 shrink-0 text-blue-600" />
            <span><span className="block font-semibold text-slate-800">{suggestion.full_address || suggestion.name}</span>{(suggestion.place_formatted || suggestion.place_name) && <span className="mt-0.5 block text-xs text-slate-500">{suggestion.place_formatted || suggestion.place_name}</span>}</span>
          </button>
        </li>)}
      </ul>}
      {loading && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-slate-400">Searching…</span>}
      {message && !suggestions.length && <p role="status" className="mt-1 text-[10px] text-amber-700">{message}</p>}
      {TOKEN && <span className="sr-only">Address suggestions provided by Mapbox.</span>}
    </div>
  );
}
