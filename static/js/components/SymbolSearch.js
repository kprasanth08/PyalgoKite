import React, { useState, useEffect, useRef } from 'react';

/**
 * SymbolSearch component that allows searching and selecting trading symbols
 */
function SymbolSearch({ onSelect, selected }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef(null);

  // Handle search input change
  const handleSearchChange = (e) => {
    const value = e.target.value;
    setQuery(value);

    if (value.length >= 2) {
      searchSymbols(value);
    } else {
      setResults([]);
    }
  };

  // Search symbols via API
  const searchSymbols = async (searchQuery) => {
    if (searchQuery.length < 2) return;

    setIsLoading(true);
    setShowResults(true);

    try {
      const response = await fetch(`/search-upstox-symbols?query=${encodeURIComponent(searchQuery)}`);
      const data = await response.json();

      if (data.success && data.symbols) {
        setResults(data.symbols);
      } else {
        setResults([]);
      }
    } catch (error) {
      console.error('Error searching symbols:', error);
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle symbol selection
  const handleSelectSymbol = (symbol) => {
    onSelect(symbol);
    setShowResults(false);
    setQuery('');  // Optional: clear the search after selection
  };

  // Close the results dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setShowResults(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div className="symbol-search" ref={searchRef}>
      <label className="form-label">
        Symbol:
        {selected ? (
          <div className="selected-symbol">
            <span className="symbol-name">{selected.tradingsymbol}</span>
            <span className="symbol-details">
              {selected.name || selected.description || ''}
            </span>
            <button
              className="clear-button"
              onClick={() => onSelect(null)}
              aria-label="Clear selection"
            >
              ×
            </button>
          </div>
        ) : (
          <div className="search-container">
            <input
              type="text"
              className="search-input"
              placeholder="Search for a symbol..."
              value={query}
              onChange={handleSearchChange}
              onFocus={() => query.length >= 2 && setShowResults(true)}
            />
            {isLoading && (
              <div className="search-loading">Loading...</div>
            )}
            {showResults && results.length > 0 && (
              <div className="search-results">
                {results.map((symbol) => (
                  <div
                    key={symbol.instrument_key}
                    className="search-result-item"
                    onClick={() => handleSelectSymbol(symbol)}
                  >
                    <span className="result-symbol">{symbol.tradingsymbol}</span>
                    <span className="result-name">{symbol.name || symbol.description || ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </label>
    </div>
  );
}

export default SymbolSearch;
