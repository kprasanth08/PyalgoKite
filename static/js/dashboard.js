/**
 * Dashboard JavaScript for PyalgoKite
 * Handles watchlist management, chart rendering, and real-time market data updates
 */

// Add timeToLocal function at the top of the file
function timeToLocal(originalTime) {
    const d = new Date(originalTime * 1000);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()) / 1000;
}

document.addEventListener('DOMContentLoaded', function() {
    const socket = io({ transports: ['websocket'] }); // Ensure Socket.IO is initialized

    const symbolSearchInput = document.getElementById('symbolSearch');
    const searchResultsDiv = document.getElementById('searchResults');
    const watchlistDiv = document.getElementById('watchlist');
    const chartContainer = document.getElementById('chartContainer');
    const chartSymbolHeader = document.getElementById('chartSymbol');
    const chartStatusSpan = document.getElementById('chartStatus');
    const chartPlaceholder = document.getElementById('chartPlaceholder');
    const timeframeSelect = document.getElementById('timeframeSelect');

    let watchlist = {}; // Keyed by Upstox instrument_key
    let lightweightChart = null;
    let candleSeries = null;
    let activeInstrumentKey = null;
    let currentLiveCandleData = null; // Added: Stores {time, open, high, low, close} for the forming candle

    // --- Load watchlist from backend on page load ---
    fetch('/api/watchlist/load')
        .then(response => response.json())
        .then(async data => {
            console.log('Loaded watchlist data:', data); // Debug loaded data
            if (data && data.success && data.watchlist && Array.isArray(data.watchlist)) {
                for (const savedItem of data.watchlist) { // savedItem can be a string or a basic object
                    const tradingsymbol = typeof savedItem === 'string' ? savedItem : (savedItem.symbol || savedItem.tradingsymbol);
                    if (!tradingsymbol) {
                        console.warn('Skipping saved watchlist item with no tradingsymbol:', savedItem);
                        continue;
                    }
                    try {
                        console.log(`Processing tradingsymbol from watchlist: ${tradingsymbol}`); // Debug processing

                        // If we already have market data in the savedItem, use it directly
                        if (typeof savedItem === 'object' && savedItem.last_price) {
                            console.log(`Using existing market data for ${tradingsymbol}`);
                            const instrumentKey = savedItem.instrument_key || '';
                            watchlist[instrumentKey] = {
                                symbolData: {
                                    tradingsymbol: tradingsymbol,
                                    name: savedItem.name,
                                    instrument_key: instrumentKey
                                },
                                chartSeries: null,
                                lastTick: {
                                    last_price: savedItem.last_price || 0,
                                    change: savedItem.change || 0,
                                    open: savedItem.open || 0,
                                    high: savedItem.high || 0,
                                    low: savedItem.low || 0,
                                    close: savedItem.close || 0,
                                    percentage_change: savedItem.percentage_change || 0,
                                    timestamp: Date.now()
                                }
                            };
                            continue;
                        }

                        // If we don't have market data, fetch full instrument details
                        console.log(`Fetching details for tradingsymbol: ${tradingsymbol}`); // Debug search
                        const searchResp = await fetch(`/search-upstox-symbols?query=${encodeURIComponent(tradingsymbol)}`);
                        const searchData = await searchResp.json();

                        console.log(`Search results for ${tradingsymbol}:`, searchData); // Debug results

                        // Check if we have success and symbols array in the response
                        if (searchData && searchData.success && searchData.symbols && searchData.symbols.length > 0) {
                            // Find exact match by tradingsymbol (case insensitive comparison)
                            const exactMatch = searchData.symbols.find(res =>
                                (res.tradingsymbol && res.tradingsymbol.toUpperCase() === tradingsymbol.toUpperCase())
                            );

                            // Use exact match if found, otherwise use first result
                            const fullItem = exactMatch || searchData.symbols[0];

                            if (fullItem && fullItem.instrument_key) {
                                const instrumentKey = fullItem.instrument_key;
                                console.log(`Adding ${tradingsymbol} to watchlist with key: ${instrumentKey}`);
                                watchlist[instrumentKey] = {
                                    symbolData: {
                                        ...fullItem,
                                        description: fullItem.name || fullItem.description || '',
                                        tradingsymbol: fullItem.tradingsymbol || tradingsymbol
                                    },
                                    chartSeries: null,
                                    lastTick: { last_price: fullItem.last_price || 0, change: 0, open:0, high:0, low:0, close:0, percentage_change:0, timestamp: Date.now() }
                                };
                            } else {
                                console.warn(`Could not find full details or instrument_key for saved tradingsymbol: ${tradingsymbol}`, fullItem);
                            }
                        } else {
                            // If search fails, skip this symbol as we need a valid instrument_key
                            console.warn(`No search results found for tradingsymbol: ${tradingsymbol}. Skipping.`);
                        }
                    } catch (e) {
                        console.error(`Error processing saved watchlist tradingsymbol ${tradingsymbol}:`, e);
                    }
                }

                console.log('Watchlist after loading:', Object.keys(watchlist)); // Debug final watchlist

                renderWatchlist();
                // Subscribe to all loaded watchlist items
                const keysToSubscribe = Object.keys(watchlist);
                if (keysToSubscribe.length > 0) {
                    socket.emit('subscribe_upstox_market_data', { instrument_keys: keysToSubscribe });
                    // If no active symbol yet, load the first one
                    if (!activeInstrumentKey && keysToSubscribe.length > 0) {
                        loadChartForSymbol(keysToSubscribe[0]);
                    }
                }
            } else {
                console.warn('No watchlist data found or invalid format:', data);
            }
        })
        .catch(err => {
            console.error('Failed to load watchlist:', err);
            chartStatusSpan.textContent = 'Error loading watchlist';
            chartStatusSpan.className = 'text-sm text-red-400';
        });

    // --- Save watchlist to backend whenever it changes ---
    function saveWatchlistToBackend() {
        // Only send tradingsymbols to backend
        const symbolsToSave = Object.values(watchlist).map(item => item.symbolData.tradingsymbol);
        fetch('/api/watchlist/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ watchlist: symbolsToSave }) // Use 'watchlist' key for consistency
        })
        .then(response => response.json())
        .then(data => {
            if (!data.success) {
                console.warn('Failed to save watchlist:', data);
            } else {
                console.log('Watchlist saved successfully.');

                // Update the watchlist with the returned data (which includes market data)
                if (data.watchlist && Array.isArray(data.watchlist)) {
                    console.log('Received updated watchlist data with market information');

                    // Process each item from the server response
                    data.watchlist.forEach(serverItem => {
                        if (serverItem.instrument_key && watchlist[serverItem.instrument_key]) {
                            // Update existing items with new market data
                            const localItem = watchlist[serverItem.instrument_key];

                            // Update market data in the lastTick object
                            if (serverItem.last_price || serverItem.ltp) {
                                localItem.lastTick = {
                                    last_price: serverItem.last_price || serverItem.ltp || 0,
                                    change: serverItem.change || 0,
                                    percentage_change: serverItem.percentage_change || 0,
                                    open: serverItem.open || 0,
                                    high: serverItem.high || 0,
                                    low: serverItem.low || 0,
                                    close: serverItem.close || 0,
                                    timestamp: Date.now()
                                };

                                // Update the display for this item
                                updateWatchlistItemDisplay(serverItem.instrument_key);
                            }
                        } else if (serverItem.instrument_key && serverItem.tradingsymbol && !watchlist[serverItem.instrument_key]) {
                            // Handle new items that might be in the server response but not in local watchlist
                            // This can happen if another client added items
                            console.log(`Found new item in server response: ${serverItem.tradingsymbol}`);
                            watchlist[serverItem.instrument_key] = {
                                symbolData: {
                                    tradingsymbol: serverItem.tradingsymbol,
                                    name: serverItem.name || '',
                                    instrument_key: serverItem.instrument_key
                                },
                                chartSeries: null,
                                lastTick: {
                                    last_price: serverItem.last_price || serverItem.ltp || 0,
                                    change: serverItem.change || 0,
                                    percentage_change: serverItem.percentage_change || 0,
                                    open: serverItem.open || 0,
                                    high: serverItem.high || 0,
                                    low: serverItem.low || 0,
                                    close: serverItem.close || 0,
                                    timestamp: Date.now()
                                }
                            };
                        }
                    });

                    // Render watchlist to show updated data
                    renderWatchlist();
                }
            }
        })
        .catch(err => {
            console.error('Error saving watchlist:', err);
        });
    }

    // --- Socket.IO Event Handlers ---
    socket.on('connect', () => {
        console.log('Socket.IO connected for Upstox data.');
        chartStatusSpan.textContent = 'Connected';
        chartStatusSpan.className = 'text-sm text-green-400';
        // If there are items in watchlist, re-subscribe (e.g., on reconnect)
        const keysInWatchlist = Object.keys(watchlist);
        if (keysInWatchlist.length > 0) {
            socket.emit('subscribe_upstox_market_data', { instrument_keys: keysInWatchlist });
        }

        // Setup quote refresh interval when socket connects
        setupQuoteRefreshInterval();
    });

    socket.on('disconnect', () => {
        console.log('Socket.IO disconnected.');
        chartStatusSpan.textContent = 'Disconnected';
        chartStatusSpan.className = 'text-sm text-red-400';
    });

    socket.on('upstox_market_tick', function(tickData) {
        // console.log('Received Upstox Tick:', tickData);
        if (tickData && tickData.instrument_key && watchlist[tickData.instrument_key]) {
            const symbolInfo = watchlist[tickData.instrument_key];
            // Update lastTick for watchlist display (ohlc here is from feed, likely daily or as provided)
            symbolInfo.lastTick = {
                last_price: tickData.last_price,
                change: tickData.change,
                percentage_change: tickData.percentage_change,
                ohlc: tickData.ohlc, // This ohlc from tickData is used for watchlist display if needed, not directly for chart candle formation here
                timestamp: tickData.timestamp || Date.now(),
                last_traded_time: tickData.last_traded_time // Unix timestamp in seconds
            };

            if (candleSeries && activeInstrumentKey === tickData.instrument_key && typeof tickData.last_price !== 'undefined') {
                const ltp = parseFloat(tickData.last_price);
                const lastTradeTimestampSeconds = tickData.last_traded_time ? parseInt(tickData.last_traded_time, 10) : Math.floor(Date.now() / 1000);
                const selectedTimeframe = timeframeSelect.value;
                const tradeDate = new Date(lastTradeTimestampSeconds * 1000); // Work with Date object in UTC

                let candleIntervalStartTime = lastTradeTimestampSeconds; // Fallback

                // Calculate the aligned start time for the current interval in UTC
                if (selectedTimeframe.endsWith('minute')) {
                    const intervalMinutes = parseInt(selectedTimeframe.replace('minute', ''));
                    if (intervalMinutes > 0) {
                        const currentUtcMinutes = tradeDate.getUTCMinutes();
                        const intervalStartUtcMinute = Math.floor(currentUtcMinutes / intervalMinutes) * intervalMinutes;
                        tradeDate.setUTCMinutes(intervalStartUtcMinute, 0, 0); // Set seconds and ms to 0
                        candleIntervalStartTime = Math.floor(tradeDate.getTime() / 1000);
                    }
                } else if (selectedTimeframe === "1hour") { // "1hour" corresponds to "60minute"
                    tradeDate.setUTCMinutes(0, 0, 0); // Zero out minutes, seconds, ms for the current hour
                    candleIntervalStartTime = Math.floor(tradeDate.getTime() / 1000);
                } else if (selectedTimeframe === '1day') {
                    tradeDate.setUTCHours(0, 0, 0, 0); // Start of the UTC day
                    candleIntervalStartTime = Math.floor(tradeDate.getTime() / 1000);
                } else {
                    // For '1week', '1month', client-side aggregation from LTP is complex and often not done this way.
                    // We will only update watchlist display for these, not live chart candles from LTP.
                    updateWatchlistItemDisplay(tickData.instrument_key);
                    return;
                }

                if (!currentLiveCandleData || currentLiveCandleData.time !== candleIntervalStartTime) {
                    // New candle interval has started, or it's the first tick for this chart configuration
                    currentLiveCandleData = {
                        time: candleIntervalStartTime,
                        open: ltp,
                        high: ltp,
                        low: ltp,
                        close: ltp
                    };
                } else {
                    // Update existing current candle
                    currentLiveCandleData.high = Math.max(currentLiveCandleData.high, ltp);
                    currentLiveCandleData.low = Math.min(currentLiveCandleData.low, ltp);
                    currentLiveCandleData.close = ltp;
                }
                // console.log(`[Chart Debug] Updating live candle for ${activeInstrumentKey} (${selectedTimeframe}): Time=${currentLiveCandleData.time}, O=${currentLiveCandleData.open}, H=${currentLiveCandleData.high}, L=${currentLiveCandleData.low}, C=${currentLiveCandleData.close}`);
                candleSeries.update(currentLiveCandleData);
            }
            updateWatchlistItemDisplay(tickData.instrument_key);
        }
    });

    socket.on('upstox_market_data_status', function(data) {
        console.log('Upstox Market Data Status:', data.status);
        // Only show "Connected" status, hide all subscription-related messages
        if (data.status && (
            data.status.includes('Subscribing to') ||
            data.status.includes('subscription') ||
            data.status.includes('Already subscribed') ||
            data.status.includes('WebSocket')
        )) {
            // For subscription messages, just show "Connected" if not already shown
            if (chartStatusSpan.textContent !== 'Connected') {
                chartStatusSpan.textContent = 'Connected';
                chartStatusSpan.className = 'text-sm text-green-400';
            }
            return;
        }

        // Only show non-subscription related status messages
        chartStatusSpan.textContent = data.status;
        chartStatusSpan.className = 'text-sm text-green-400';
    });

    socket.on('upstox_market_data_error', function(data) {
        console.error('Upstox Market Data Error:', data.error);
        chartStatusSpan.textContent = `Error: ${data.error}`;
        chartStatusSpan.className = 'text-sm text-red-400';
    });


    // --- Symbol Search ---
    symbolSearchInput.addEventListener('input', function() {
        const query = this.value.trim();
        if (query.length < 2) {
            searchResultsDiv.innerHTML = '';
            searchResultsDiv.classList.add('hidden');
            return;
        }
        // Use /search-upstox-symbols
        fetch(`${window.location.origin}/search-upstox-symbols?query=${encodeURIComponent(query)}`)
            .then(response => response.json())
            .then(data => {
                searchResultsDiv.innerHTML = '';

                // Check for error in the response
                if (!data.success) {
                    searchResultsDiv.innerHTML = `<div class="p-2 text-red-400">${data.error || 'Error searching for symbols'}</div>`;
                    searchResultsDiv.classList.remove('hidden');
                    return;
                }

                // Access the symbols array from the response
                const symbols = data.symbols || [];

                if (symbols.length > 0) {
                    symbols.forEach(item => { // item from Upstox search should have instrument_key
                        const resultItem = document.createElement('div');
                        resultItem.className = 'p-2 hover:bg-gray-600 cursor-pointer border-b border-gray-500 text-gray-200 text-sm';

                        // Include both symbol and name in the display
                        const symbol = item.symbol || item.tradingsymbol || '';
                        const name = item.name || item.description || '';
                        resultItem.textContent = `${symbol} - ${name}`;

                        resultItem.addEventListener('click', function() {
                            addSymbolToWatchlist(item);
                            symbolSearchInput.value = '';
                            searchResultsDiv.classList.add('hidden');
                        });
                        searchResultsDiv.appendChild(resultItem);
                    });
                } else {
                    searchResultsDiv.innerHTML = '<div class="p-2 text-gray-400 text-sm">No results found</div>';
                }
                searchResultsDiv.classList.remove('hidden');
            })
            .catch(error => {
                console.error('Error searching Upstox symbols:', error);
                searchResultsDiv.innerHTML = '<div class="p-2 text-red-400 text-sm">Error during search.</div>';
                searchResultsDiv.classList.remove('hidden');
            });
    });

    // --- Watchlist Management ---
    function addSymbolToWatchlist(item) { // item is from Upstox search result
        if (!item || !item.instrument_key) {
            console.error("Cannot add symbol: item is invalid or missing instrument_key", item);
            return;
        }
        if (watchlist[item.instrument_key]) {
            console.log("Symbol already in watchlist:", item.instrument_key);
            return; // Already in watchlist
        }

        watchlist[item.instrument_key] = {
            symbolData: { ...item, description: item.name || item.description || item.symbol }, // Ensure description
            chartSeries: null,
            lastTick: { last_price: item.last_price || 0, change: 0, open:0, high:0, low:0, close:0, percentage_change:0, timestamp: Date.now() }
        };
        renderWatchlist();
        saveWatchlistToBackend();

        socket.emit('subscribe_upstox_market_data', { instrument_keys: [item.instrument_key] });

        if (!activeInstrumentKey) {
            loadChartForSymbol(item.instrument_key);
        }
    }

    function removeSymbolFromWatchlist(instrumentKeyToRemove) { // Argument is Upstox instrument_key
        if (!watchlist[instrumentKeyToRemove]) return;

        // No direct series removal in Chart.js like Lightweight Charts, chart is destroyed and recreated
        delete watchlist[instrumentKeyToRemove];
        renderWatchlist();
        saveWatchlistToBackend();

        socket.emit('unsubscribe_upstox_market_data', { instrument_keys: [instrumentKeyToRemove] });

        if (activeInstrumentKey === instrumentKeyToRemove) {
            activeInstrumentKey = null;
            chartSymbolHeader.textContent = 'Live Chart';
            if (lightweightChart) {
                lightweightChart.remove();
                lightweightChart = null;
            }
            // Ensure chartContainer is empty and placeholder is visible
            chartContainer.innerHTML = ''; // Clear any canvas
            const placeholder = document.createElement('p');
            placeholder.id = 'chartPlaceholder';
            placeholder.className = 'absolute inset-0 flex items-center justify-center text-gray-500';
            placeholder.textContent = 'Select a symbol from the watchlist to view its chart.';
            chartContainer.appendChild(placeholder);

            const remainingKeys = Object.keys(watchlist);
            if (remainingKeys.length > 0) {
                loadChartForSymbol(remainingKeys[0]); // Load first from remaining
            }
        }
    }

    function renderWatchlist() {
        watchlistDiv.innerHTML = '';
        const instrumentKeys = Object.keys(watchlist);
        if (instrumentKeys.length === 0) {
            watchlistDiv.innerHTML = '<p class="text-gray-500 text-sm px-1">No symbols added yet.</p>';
            return;
        }

        instrumentKeys.forEach(currentInstrumentKey => {
            const item = watchlist[currentInstrumentKey];
            if (!item || !item.symbolData) {
                console.warn("Skipping rendering for invalid watchlist item with key:", currentInstrumentKey, item);
                return;
            }
            const itemData = item.symbolData;
            const lastTick = item.lastTick || {};

            const ltp = lastTick.last_price !== undefined ? Number(lastTick.last_price).toFixed(2) : '-';
            const change = lastTick.change !== undefined ? Number(lastTick.change).toFixed(2) : '0.00';
            const percentageChange = lastTick.percentage_change !== undefined ? Number(lastTick.percentage_change).toFixed(2) : '0.00';

            let changeClass = 'text-gray-400';
            if (parseFloat(change) > 0) changeClass = 'text-positive';
            if (parseFloat(change) < 0) changeClass = 'text-negative';

            const symbolItemDiv = document.createElement('div');
            // Use tradingsymbol for id instead of data-token with instrument_key
            symbolItemDiv.className = `watchlist-item p-2 rounded-md cursor-pointer flex flex-col ${currentInstrumentKey === activeInstrumentKey ? 'active-symbol' : 'bg-gray-800'}`;
            symbolItemDiv.id = `watchlist-${itemData.tradingsymbol}`;
            symbolItemDiv.addEventListener('click', () => loadChartForSymbol(currentInstrumentKey));

            const topRow = document.createElement('div');
            topRow.className = 'flex justify-between items-center w-full';
            const symbolName = document.createElement('span');
            symbolName.className = 'symbol-name font-semibold text-sm text-gray-100 truncate';
            symbolName.textContent = itemData.tradingsymbol;
            topRow.appendChild(symbolName);
            const ltpSpan = document.createElement('span');
            ltpSpan.className = `symbol-ltp text-sm font-medium ${currentInstrumentKey === activeInstrumentKey ? 'text-white' : 'text-gray-200'}`;
            ltpSpan.textContent = ltp;
            topRow.appendChild(ltpSpan);
            symbolItemDiv.appendChild(topRow);

            const descriptionRow = document.createElement('div');
            descriptionRow.className = 'flex justify-between items-center w-full mt-0.5';
            const descriptionSpan = document.createElement('span');
            descriptionSpan.className = `symbol-description text-xs ${currentInstrumentKey === activeInstrumentKey ? 'text-white' : 'text-gray-400'} truncate`;
            descriptionSpan.textContent = itemData.name;
            descriptionSpan.style.maxWidth = '60%';
            descriptionRow.appendChild(descriptionSpan);
            const changeDetailsContainer = document.createElement('div');
            changeDetailsContainer.className = 'flex items-baseline';
            const changeSpan = document.createElement('span');
            changeSpan.className = `symbol-change text-xs ${changeClass}`;
            changeSpan.textContent = change;
            changeDetailsContainer.appendChild(changeSpan);
            const percentageChangeSpan = document.createElement('span');
            percentageChangeSpan.className = `symbol-percentage-change text-xs ${changeClass} ml-1`;
            percentageChangeSpan.textContent = `(${percentageChange}%)`;
            changeDetailsContainer.appendChild(percentageChangeSpan);
            descriptionRow.appendChild(changeDetailsContainer);
            symbolItemDiv.appendChild(descriptionRow);

            const removeBtn = document.createElement('button');
            removeBtn.innerHTML = '&times;';
            removeBtn.className = 'absolute top-1 right-1 text-gray-500 hover:text-red-400 text-xs px-1';
            removeBtn.style.lineHeight = '1';
            removeBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                removeSymbolFromWatchlist(currentInstrumentKey);
            });
            symbolItemDiv.style.position = 'relative';
            symbolItemDiv.appendChild(removeBtn);
            watchlistDiv.appendChild(symbolItemDiv);
        });
    }

    function updateWatchlistItemDisplay(instrumentKeyToUpdate) { // Argument is Upstox instrument_key
        if (!watchlist[instrumentKeyToUpdate] || !watchlist[instrumentKeyToUpdate].lastTick) return;

        const item = watchlist[instrumentKeyToUpdate];
        const tradingsymbol = item.symbolData.tradingsymbol;
        const itemDiv = document.getElementById(`watchlist-${tradingsymbol}`);
        if (!itemDiv) return;

        const lastTick = item.lastTick;
        const ltp = lastTick.last_price !== undefined ? Number(lastTick.last_price).toFixed(2) : '-';
        const change = lastTick.change !== undefined ? Number(lastTick.change).toFixed(2) : '0.00';
        const percentageChange = lastTick.percentage_change !== undefined ? Number(lastTick.percentage_change).toFixed(2) : '0.00';

        const ltpSpan = itemDiv.querySelector('.symbol-ltp');
        if (ltpSpan) ltpSpan.textContent = ltp;

        const changeSpan = itemDiv.querySelector('.symbol-change');
        const percentageChangeSpan = itemDiv.querySelector('.symbol-percentage-change');
        let changeClass = 'text-gray-400';
        if (parseFloat(change) > 0) changeClass = 'text-positive';
        if (parseFloat(change) < 0) changeClass = 'text-negative';

        if (changeSpan) {
            changeSpan.textContent = change;
            changeSpan.className = `symbol-change text-xs ${changeClass}`;
        }
        if (percentageChangeSpan) {
            percentageChangeSpan.textContent = `(${percentageChange}%)`;
            percentageChangeSpan.className = `symbol-percentage-change text-xs ${changeClass} ml-1`;
        }
        if (instrumentKeyToUpdate === activeInstrumentKey) {
            if(ltpSpan) ltpSpan.classList.add('text-white'); // Ensure active item LTP is white
        }
    }

    function loadChartForSymbol(instrumentKeyToLoad) { // Argument is Upstox instrument_key
        if (!watchlist[instrumentKeyToLoad]) return;

        activeInstrumentKey = instrumentKeyToLoad;
        currentLiveCandleData = null; // Added: Reset for new chart/symbol/timeframe

        const symbolData = watchlist[instrumentKeyToLoad].symbolData;
        chartSymbolHeader.textContent = `${symbolData.tradingsymbol} (${symbolData.name || 'N/A'})`;

        const placeholder = document.getElementById('chartPlaceholder');
        if(placeholder) placeholder.classList.add('hidden');

        if (lightweightChart) {
            lightweightChart.remove();
            lightweightChart = null;
        }

        chartContainer.innerHTML = '';

        try {
            console.log('[Chart Debug] Attempting to create chart. LightweightCharts object:', LightweightCharts);
            if (typeof LightweightCharts !== 'object' || typeof LightweightCharts.createChart !== 'function') {
                console.error('[Chart Debug] LightweightCharts library not loaded correctly or createChart is not a function.');
                throw new Error('LightweightCharts library not loaded correctly.');
            }
            if (!chartContainer || !document.body.contains(chartContainer)) {
                console.error('[Chart Debug] chartContainer element is invalid or not in DOM:', chartContainer);
                throw new Error('chartContainer element is invalid.');
            }
            console.log(`[Chart Debug] chartContainer dimensions: width=${chartContainer.clientWidth}, height=${chartContainer.clientHeight}`);

            lightweightChart = LightweightCharts.createChart(chartContainer, {
                width: chartContainer.clientWidth,
                height: chartContainer.clientHeight,
                layout: {
                    // V5 API for background:
                    background: { type: 'solid', color: '#1f2937' },
                    textColor: '#d1d5db',
                },
                grid: {
                    vertLines: { color: '#374151' },
                    horzLines: { color: '#374151' },
                },
                crosshair: {
                    mode: LightweightCharts.CrosshairMode.Normal,
                },
                rightPriceScale: {
                    borderColor: '#4b5563',
                },
                timeScale: {
                    borderColor: '#4b5563',
                    timeVisible: true,
                    secondsVisible: false,
                }
            });

            console.log('[Chart Debug] Chart object created:', lightweightChart);
            if (!lightweightChart) {
                console.error('[Chart Debug] LightweightCharts.createChart returned null or undefined.');
                throw new Error('Failed to create chart object.');
            }

            // Using addCandlestickSeries, which is correct for v4.2.0
            if (typeof lightweightChart.addCandlestickSeries !== 'function') {
                console.error('[Chart Debug] lightweightChart.addCandlestickSeries IS NOT a function. Available keys on chart object:', Object.keys(lightweightChart));
                throw new TypeError('lightweightChart.addCandlestickSeries is not a function. Ensure Lightweight Charts v3.1+ or v4.x is loaded.');
            }

            candleSeries = lightweightChart.addCandlestickSeries({
                upColor: '#22c55e',
                downColor: '#ef4444',
                borderDownColor: '#ef4444',
                borderUpColor: '#22c55e',
                wickDownColor: '#ef4444',
                wickUpColor: '#22c55e',
            });
            console.log('[Chart Debug] Candlestick series created successfully using addCandlestickSeries().');

            // Check for setMarkers immediately after series creation
            if (typeof candleSeries.setMarkers !== 'function') {
                console.error('[Chart Debug] setMarkers is NOT a function on the candleSeries object. Available keys:', Object.keys(candleSeries));
                throw new TypeError('candleSeries.setMarkers is not a function');
            }
            console.log('[Chart Debug] setMarkers IS a function on the candleSeries object.');

        } catch (e) {
            console.error("Error creating Lightweight Chart:", e);
            chartStatusSpan.textContent = 'Error creating chart';
            chartStatusSpan.className = 'text-sm text-red-400';
            if(placeholder) placeholder.classList.remove('hidden');
            return;
        }

        renderWatchlist(); // Re-render to update active styles

        const selectedTimeframe = timeframeSelect.value;

        // Use tradingsymbol directly - don't try to extract from instrument_key
        const tradingsymbol = watchlist[instrumentKeyToLoad].symbolData.tradingsymbol;

        console.log(`Loading historical data for Lightweight Chart: ${tradingsymbol} with timeframe ${selectedTimeframe}`);

        // Pass only tradingsymbol parameter, not instrument_key or symbol
        fetch(`/api/merged-chart-data?tradingsymbol=${tradingsymbol}&interval=${selectedTimeframe}`)
            .then(response => response.json())
            .then(data => {
                if (data && data.success && data.data && Array.isArray(data.data)) {
                    const candles = data.data.map(d => ({
                        time: timeToLocal(new Date(d[0]).getTime() / 1000),
                        open: d[1],
                        high: d[2],
                        low: d[3],
                        close: d[4]
                    })).sort((a, b) => a.time - b.time);

                    if (candleSeries) {
                        candleSeries.setData(candles);

                        lightweightChart.timeScale().fitContent();
                    }
                } else {
                    console.warn(`No historical data or invalid format for ${tradingsymbol}:`, data);
                }
            })
            .catch(err => {
                console.error('Error fetching historical data:', err);
            });
    }

    // New function to fetch market quotes directly from Upstox API
    async function fetchMarketQuotesDirectlyFromUpstox(instrumentKeys) {
        if (!instrumentKeys || instrumentKeys.length === 0) {
            return {};
        }

        try {
            console.log(`Fetching market quotes directly from Upstox for ${instrumentKeys.length} instruments`);

            // First, get the auth token from our backend
            const tokenResponse = await fetch('/api/upstox-auth-token');

            if (!tokenResponse.ok) {
                throw new Error(`HTTP error getting auth token: ${tokenResponse.status}`);
            }

            const tokenData = await tokenResponse.json();

            if (!tokenData.success || !tokenData.token) {
                throw new Error(tokenData.error || 'Failed to get Upstox auth token');
            }

            const authToken = tokenData.token;

            // Build the Upstox API request
            const instrumentKeysParam = instrumentKeys.join(',');
            const url = `https://api.upstox.com/v2/market-quote/quotes?instrument_key=${encodeURIComponent(instrumentKeysParam)}`;

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                }
            });

            if (!response.ok) {
                throw new Error(`Upstox API error: ${response.status}`);
            }

            const data = await response.json();

            if (!data.data) {
                throw new Error('Invalid response format from Upstox API');
            }

            console.log(`Successfully fetched data directly from Upstox API for ${Object.keys(data.data).length} instruments`);
            return data.data;
        } catch (error) {
            console.error('Error fetching market quotes directly from Upstox:', error);
            return {};
        }
    }

    // Function to update watchlist items with fresh market data
    async function refreshWatchlistQuotes() {
        const instrumentKeys = Object.keys(watchlist);
        if (instrumentKeys.length === 0) {
            return;
        }

        // Split instrument keys into batches of 5 to avoid too large requests
        const batchSize = 5;
        const batches = [];

        for (let i = 0; i < instrumentKeys.length; i += batchSize) {
            batches.push(instrumentKeys.slice(i, i + batchSize));
        }

        console.log(`Refreshing quotes for ${instrumentKeys.length} symbols in ${batches.length} batches`);

        for (const batch of batches) {
            try {
                // Fetch directly from Upstox API
                const quotes = await fetchMarketQuotesDirectlyFromUpstox(batch);

                // Update watchlist with new quote data
                for (const instrumentKey of batch) {
                    const quote = quotes[instrumentKey];

                    if (quote && watchlist[instrumentKey]) {
                        watchlist[instrumentKey].lastTick = {
                            last_price: quote.last_price || 0,
                            change: quote.change || quote.net_change || 0,
                            percentage_change: quote.percentage_change || quote.change_percent || 0,
                            open: quote.ohlc?.open || 0,
                            high: quote.ohlc?.high || 0,
                            low: quote.ohlc?.low || 0,
                            close: quote.ohlc?.close || 0,
                            volume: quote.volume || 0,
                            timestamp: Date.now()
                        };

                        // Update the UI for this item
                        updateWatchlistItemDisplay(instrumentKey);
                    }
                }
            } catch (error) {
                console.error(`Error refreshing quotes for batch:`, error);
            }

            // Small delay between batches to avoid overwhelming the server
            if (batches.length > 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
    }

    // Set up periodic refresh of market quotes
    let quoteRefreshInterval;

    function setupQuoteRefreshInterval() {
        // Clear any existing interval
        if (quoteRefreshInterval) {
            clearInterval(quoteRefreshInterval);
        }

        // During market hours (9:15 AM to 3:30 PM IST on weekdays), refresh every 30 seconds
        // Otherwise, refresh every 5 minutes
        const now = new Date();
        const hour = now.getHours();
        const minute = now.getMinutes();
        const day = now.getDay();

        // Check if it's a weekday (1-5) and trading hours (9:15 AM to 3:30 PM)
        const isMarketHours = day >= 1 && day <= 5 &&
            ((hour === 9 && minute >= 15) || (hour > 9 && hour < 15) || (hour === 15 && minute <= 30));

        const refreshTime = isMarketHours ? 10000 : 300000; // 10 seconds during market hours, 5 minutes otherwise

        console.log(`Setting up quote refresh interval: ${refreshTime}ms (Market hours: ${isMarketHours})`);

        quoteRefreshInterval = setInterval(() => {
            if (Object.keys(watchlist).length > 0) {
                refreshWatchlistQuotes();
            }
        }, refreshTime);
    }

    // Initialize quote refresh when the page loads
    setupQuoteRefreshInterval();

    // Refresh the interval setup every hour to adjust for market hours changes
    setInterval(setupQuoteRefreshInterval, 360000); // 1 hour

    // --- Timeframe Change Handling ---
    timeframeSelect.addEventListener('change', function() {
        if (activeInstrumentKey) {
            loadChartForSymbol(activeInstrumentKey);
        }
    });

    new ResizeObserver(entries => {
        if (entries.length === 0 || entries[0].target !== chartContainer) { return; }
        if (lightweightChart) {
            lightweightChart.resize(chartContainer.clientWidth, chartContainer.clientHeight);
        }
    }).observe(chartContainer);

    // Initial render in case watchlist is empty or fails to load fully
    renderWatchlist();

    // --- Socket.IO LTPC (Last Traded Price & Change) live updates ---
    socket.on('ltpc_update', function(data) {
        // Skip if we don't have the instrument in our watchlist
        if (!data.instrument_key || !watchlist[data.instrument_key]) {
            return;
        }

        // Update the watchlist object with the latest LTPC data
        const item = watchlist[data.instrument_key];
        item.ltp = data.ltp;
        item.last_price = data.ltp; // Keep both fields updated for compatibility
        item.change = data.change;
        item.percentage_change = data.percentage_change;
        item.close_price = data.close_price;
        item.last_trade_time = data.last_trade_time;

        // Find the watchlist item in the DOM using getElementById with tradingsymbol
        const tradingsymbol = item.symbolData.tradingsymbol;
        const element = document.getElementById(`watchlist-${tradingsymbol}`);
        if (element) {
            // Update the price display
            const ltpElement = element.querySelector('.symbol-ltp');
            if (ltpElement) {
                ltpElement.textContent = data.ltp.toFixed(2);
            }

            // Update the change display
            const changeElement = element.querySelector('.symbol-change');
            if (changeElement) {
                // Format the change value
                const changeValue = data.change.toFixed(2);
                const changeText = changeValue > 0 ? `+${changeValue}` : changeValue;
                changeElement.textContent = changeText;

                // Update the color
                const isPositive = data.change > 0;
                changeElement.className = `symbol-change text-xs ${isPositive ? 'text-positive' : 'text-negative'}`;
            }

            // Update percentage change
            const pctChangeElement = element.querySelector('.symbol-percentage-change');
            if (pctChangeElement) {
                const pctValue = data.percentage_change.toFixed(2);
                const pctText = pctValue > 0 ? `+${pctValue}%` : `${pctValue}%`;
                pctChangeElement.textContent = pctText;

                // Update the color
                const isPositive = data.percentage_change > 0;
                pctChangeElement.className = `symbol-percentage-change text-xs ${isPositive ? 'text-positive' : 'text-negative'}`;
            }

            // Add a subtle flash effect (optional)
            element.classList.add('bg-gray-700');
            setTimeout(() => {
                element.classList.remove('bg-gray-700');
            }, 300);
        }

        // If this is the active symbol, update the chart title as well
        if (data.instrument_key === activeInstrumentKey && chartSymbolHeader) {
            const symbol = item.symbolData.tradingsymbol;
            const priceText = data.ltp.toFixed(2);
            const changeText = data.change > 0 ? `+${data.change.toFixed(2)}` : data.change.toFixed(2);
            const pctText = data.percentage_change > 0 ? `+${data.percentage_change.toFixed(2)}%` : `${data.percentage_change.toFixed(2)}%`;
            const colorClass = data.change > 0 ? 'text-positive' : 'text-negative';

            chartSymbolHeader.innerHTML = `
                ${symbol}
                <span class="text-lg ml-2">${priceText}</span>
                <span class="text-sm ml-2 ${colorClass}">${changeText} (${pctText})</span>
            `;
        }
    });
});

