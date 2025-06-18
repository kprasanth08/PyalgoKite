/**
 * Symbol Search
 * Handles symbol search functionality and selection
 */

let symbolSearchTimeout = null;

/**
 * Handle symbol search input
 */
function handleSymbolSearch(symbolInput, symbolDropdown) {
    const query = symbolInput.value.trim();

    if (symbolSearchTimeout) {
        clearTimeout(symbolSearchTimeout);
    }

    if (query.length < 2) {
        hideSymbolDropdown(symbolDropdown);
        return;
    }

    symbolSearchTimeout = setTimeout(() => {
        fetch(`/api/search?query=${encodeURIComponent(query)}&exchange=NSE_EQ`)
            .then(response => response.json())
            .then(data => {
                console.log('Search API response:', data);
                if (data.success && data.results) {
                    console.log('Search results:', data.results);
                    // Get the selectedSymbol element from the document
                    const selectedSymbolElement = document.getElementById('selectedSymbol');
                    populateSymbolDropdown(data.results, symbolInput, symbolDropdown, selectedSymbolElement);
                } else {
                    console.error('Search failed or no results:', data);
                    hideSymbolDropdown(symbolDropdown);
                }
            })
            .catch(error => {
                console.error('Error searching symbols:', error);
                hideSymbolDropdown(symbolDropdown);
            });
    }, 300);
}

/**
 * Populate symbol dropdown with search results
 */
function populateSymbolDropdown(results, symbolInput, symbolDropdown, selectedSymbol = null) {
    console.log('Populating dropdown with results:', results);
    symbolDropdown.innerHTML = '';

    if (!results || results.length === 0) {
        const noResults = document.createElement('div');
        noResults.className = 'p-3 text-gray-400 text-sm';
        noResults.textContent = 'No symbols found';
        symbolDropdown.appendChild(noResults);
    } else {
        results.forEach((symbol, index) => {
            console.log(`Symbol ${index}:`, symbol);
            const item = document.createElement('div');
            item.className = 'p-3 hover:bg-gray-600 cursor-pointer border-b border-gray-600 last:border-b-0';

            const displaySymbol = symbol.tradingsymbol || symbol.symbol || 'Unknown';
            const displayName = symbol.name || 'N/A';

            item.innerHTML = `
                <div class="font-medium text-gray-200">${displaySymbol}</div>
                <div class="text-sm text-gray-400">${displayName}</div>
            `;

            item.addEventListener('click', () => selectSymbol(symbol, symbolInput, symbolDropdown, selectedSymbol));
            symbolDropdown.appendChild(item);
        });
    }

    symbolDropdown.classList.remove('hidden');
}

/**
 * Select a symbol from dropdown
 */
function selectSymbol(symbol, symbolInput, symbolDropdown, selectedSymbol) {
    symbolInput.value = symbol.tradingsymbol || symbol.symbol;
    if (selectedSymbol) {
        selectedSymbol.value = symbol.instrument_key || symbol.id || '';
        console.log('Selected symbol:', symbol, 'Setting value:', selectedSymbol.value);
    }
    hideSymbolDropdown(symbolDropdown);
}

/**
 * Hide symbol dropdown
 */
function hideSymbolDropdown(symbolDropdown) {
    setTimeout(() => {
        symbolDropdown.classList.add('hidden');
    }, 200);
}

export { handleSymbolSearch, populateSymbolDropdown, selectSymbol, hideSymbolDropdown };
