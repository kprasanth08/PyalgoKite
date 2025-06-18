/**
 * Backtest page functionality for PyalgoKite platform
 * Handles strategy backtesting configuration and execution
 */

document.addEventListener('DOMContentLoaded', function() {
    // DOM elements
    const backtestForm = document.getElementById('backtestForm');
    const strategySelect = document.getElementById('strategySelect');
    const symbolInput = document.getElementById('symbolInput');
    const symbolDropdown = document.getElementById('symbolDropdown');
    const selectedSymbol = document.getElementById('selectedSymbol');
    const startDate = document.getElementById('startDate');
    const endDate = document.getElementById('endDate');
    const initialCapital = document.getElementById('initialCapital');
    const strategyParams = document.getElementById('strategyParams');
    const runBacktestBtn = document.getElementById('runBacktestBtn');

    // Results elements
    const backtestLoading = document.getElementById('backtestLoading');
    const backtestResults = document.getElementById('backtestResults');
    const backtestError = document.getElementById('backtestError');
    const backtestStatus = document.getElementById('backtestStatus');

    // Metrics elements
    const totalReturn = document.getElementById('totalReturn');
    const sharpeRatio = document.getElementById('sharpeRatio');
    const maxDrawdown = document.getElementById('maxDrawdown');
    const winRate = document.getElementById('winRate');
    const tradeLog = document.getElementById('tradeLog');
    const backtestChart = document.getElementById('backtestChart');

    // Set default dates
    const today = new Date();
    const oneYearAgo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());

    endDate.value = today.toISOString().split('T')[0];
    startDate.value = oneYearAgo.toISOString().split('T')[0];

    let chart = null;
    let symbolSearchTimeout = null;

    // Strategy parameter configurations
    const strategyConfigs = {
        'moving_average_crossover': {
            name: 'Moving Average Crossover',
            params: [
                { name: 'short_window', label: 'Short MA Period', type: 'number', default: 20, min: 5, max: 50 },
                { name: 'long_window', label: 'Long MA Period', type: 'number', default: 50, min: 20, max: 200 }
            ]
        },
        'rsi_strategy': {
            name: 'RSI Strategy',
            params: [
                { name: 'rsi_period', label: 'RSI Period', type: 'number', default: 14, min: 5, max: 30 },
                { name: 'oversold_threshold', label: 'Oversold Threshold', type: 'number', default: 30, min: 20, max: 40 },
                { name: 'overbought_threshold', label: 'Overbought Threshold', type: 'number', default: 70, min: 60, max: 80 }
            ]
        },
        'bollinger_bands': {
            name: 'Bollinger Bands',
            params: [
                { name: 'period', label: 'Period', type: 'number', default: 20, min: 10, max: 50 },
                { name: 'std_dev', label: 'Standard Deviation', type: 'number', default: 2, min: 1, max: 3, step: 0.1 }
            ]
        }
    };

    // Event listeners
    strategySelect.addEventListener('change', updateStrategyParams);
    symbolInput.addEventListener('input', handleSymbolSearch);
    symbolInput.addEventListener('blur', hideSymbolDropdown);
    backtestForm.addEventListener('submit', runBacktest);

    /**
     * Update strategy parameters based on selected strategy
     */
    function updateStrategyParams() {
        const selectedStrategy = strategySelect.value;
        strategyParams.innerHTML = '';

        if (selectedStrategy && strategyConfigs[selectedStrategy]) {
            const config = strategyConfigs[selectedStrategy];

            config.params.forEach(param => {
                const paramDiv = document.createElement('div');
                paramDiv.className = 'space-y-2';

                const label = document.createElement('label');
                label.textContent = param.label;
                label.className = 'block text-sm font-medium text-gray-300';
                label.setAttribute('for', param.name);

                const input = document.createElement('input');
                input.type = param.type;
                input.id = param.name;
                input.name = param.name;
                input.value = param.default;
                input.className = 'w-full p-2 border border-gray-600 bg-gray-700 text-gray-200 rounded-md focus:ring-blue-500 focus:border-blue-500';

                if (param.min !== undefined) input.min = param.min;
                if (param.max !== undefined) input.max = param.max;
                if (param.step !== undefined) input.step = param.step;

                paramDiv.appendChild(label);
                paramDiv.appendChild(input);
                strategyParams.appendChild(paramDiv);
            });
        }
    }

    /**
     * Handle symbol search
     */
    function handleSymbolSearch() {
        const query = symbolInput.value.trim();

        if (symbolSearchTimeout) {
            clearTimeout(symbolSearchTimeout);
        }

        if (query.length < 2) {
            hideSymbolDropdown();
            return;
        }

        symbolSearchTimeout = setTimeout(() => {
            fetch(`/api/search?query=${encodeURIComponent(query)}&exchange=NSE_EQ`)
                .then(response => response.json())
                .then(data => {
                    console.log('Search API response:', data);
                    if (data.success && data.results) {
                        console.log('Search results:', data.results);
                        populateSymbolDropdown(data.results);
                    } else {
                        console.error('Search failed or no results:', data);
                        hideSymbolDropdown();
                    }
                })
                .catch(error => {
                    console.error('Error searching symbols:', error);
                    hideSymbolDropdown();
                });
        }, 300);
    }

    /**
     * Populate symbol dropdown with search results
     */
    function populateSymbolDropdown(results) {
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

                item.addEventListener('click', () => selectSymbol(symbol));
                symbolDropdown.appendChild(item);
            });
        }

        symbolDropdown.classList.remove('hidden');
    }

    /**
     * Select a symbol from dropdown
     */
    function selectSymbol(symbol) {
        symbolInput.value = symbol.tradingsymbol || symbol.symbol;
        selectedSymbol.value = symbol.instrument_key;
        hideSymbolDropdown();
    }

    /**
     * Hide symbol dropdown
     */
    function hideSymbolDropdown() {
        setTimeout(() => {
            symbolDropdown.classList.add('hidden');
        }, 200);
    }

    /**
     * Run backtest
     */
    function runBacktest(event) {
        event.preventDefault();

        // Validate inputs
        if (!selectedSymbol.value) {
            alert('Please select a symbol');
            return;
        }

        if (!strategySelect.value) {
            alert('Please select a strategy');
            return;
        }

        if (!startDate.value || !endDate.value) {
            alert('Please select date range');
            return;
        }

        // Collect strategy parameters
        const params = {};
        const paramInputs = strategyParams.querySelectorAll('input');
        paramInputs.forEach(input => {
            params[input.name] = parseFloat(input.value) || input.value;
        });

        // Prepare backtest request
        const backtestData = {
            instrument_key: selectedSymbol.value,
            strategy: strategySelect.value,
            start_date: startDate.value,
            end_date: endDate.value,
            initial_capital: parseFloat(initialCapital.value),
            params: params
        };

        // Show loading state
        showLoading();

        // Run backtest
        fetch('/api/backtest', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(backtestData)
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                displayResults(data.data, data.metrics);
            } else {
                showError(data.message || 'Backtest failed');
            }
        })
        .catch(error => {
            console.error('Error running backtest:', error);
            showError('Network error occurred');
        });
    }

    /**
     * Show loading state
     */
    function showLoading() {
        backtestLoading.classList.remove('hidden');
        backtestResults.classList.add('hidden');
        backtestError.classList.add('hidden');
        backtestStatus.textContent = 'Running backtest...';
        runBacktestBtn.disabled = true;
        runBacktestBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Running...';
    }

    /**
     * Display backtest results
     */
    function displayResults(data, metrics) {
        // Hide loading, show results
        backtestLoading.classList.add('hidden');
        backtestResults.classList.remove('hidden');
        backtestError.classList.add('hidden');
        backtestStatus.textContent = 'Backtest completed successfully';

        // Add detailed logging to debug data structure
        console.log('Backtest data structure:', data);
        console.log('Portfolio data:', data.equity);
        console.log('Metrics data:', metrics);

        // Update metrics - Add checks for undefined or null values
        totalReturn.textContent = metrics && metrics.total_return !== undefined && metrics.total_return !== null ? `${(metrics.total_return * 100).toFixed(2)}%` : 'N/A';
        sharpeRatio.textContent = metrics && metrics.sharpe_ratio !== undefined && metrics.sharpe_ratio !== null ? metrics.sharpe_ratio.toFixed(2) : 'N/A';
        maxDrawdown.textContent = metrics && metrics.max_drawdown !== undefined && metrics.max_drawdown !== null ? `${(metrics.max_drawdown * 100).toFixed(2)}%` : 'N/A';
        winRate.textContent = metrics && metrics.win_rate !== undefined && metrics.win_rate !== null ? `${(metrics.win_rate * 100).toFixed(1)}%` : 'N/A';

        // Create chart
        createChart(data, metrics);

        // Update trade log
        updateTradeLog(metrics.trades || []);

        // Reset button
        runBacktestBtn.disabled = false;
        runBacktestBtn.innerHTML = '<i class="fas fa-play mr-2"></i>Run Backtest';
    }

    /**
     * Show error state
     */
    function showError(message) {
        backtestLoading.classList.add('hidden');
        backtestResults.classList.add('hidden');
        backtestError.classList.remove('hidden');
        backtestStatus.textContent = 'Backtest failed';

        const errorMessageDiv = document.getElementById('errorMessage');
        if (errorMessageDiv) {
            errorMessageDiv.textContent = message || 'An error occurred while running the backtest';
        }

        // Reset button
        runBacktestBtn.disabled = false;
        runBacktestBtn.innerHTML = '<i class="fas fa-play mr-2"></i>Run Backtest';
    }

    /**
     * Create price and equity chart
     */
    function createChart(data, metrics) {
        const chartContainer = document.getElementById('backtestChart');
        if (!chartContainer) return;

        // Clear any existing chart
        if (chart) {
            chart.destroy();
        }

        // Add detailed logging for debugging
        console.log('Creating chart with data:', data);
        console.log('Portfolio/Equity data:', data.equity);

        // Prepare canvas
        chartContainer.innerHTML = '';
        const canvas = document.createElement('canvas');
        canvas.id = 'priceChart';
        canvas.width = chartContainer.clientWidth;
        canvas.height = chartContainer.clientHeight;
        chartContainer.appendChild(canvas);

        // Create datasets
        const priceData = [];
        const equityData = [];
        const buySignals = [];
        const sellSignals = [];
        const shortMaData = [];
        const longMaData = [];

        const labels = data.candles.map(candle => {
            const date = new Date(candle.timestamp);
            return date.toLocaleDateString();
        });

        // Price data
        data.candles.forEach(candle => {
            priceData.push(candle.close);
        });

        // Equity data - Handle different possible data structures with enhanced debugging
        console.log('Processing equity data');
        if (data.equity) {
            console.log('Portfolio data structure:', data.equity);
            console.log('Portfolio data type:', typeof data.equity);
            console.log('Is array:', Array.isArray(data.equity));

            if (data.equity.length > 0) {
                console.log('First equity item:', data.equity[0]);
                console.log('First equity item type:', typeof data.equity[0]);
            }

            // Check what format the equity data is in and process accordingly
            if (Array.isArray(data.equity)) {
                if (data.equity.length > 0) {
                    if (typeof data.equity[0] === 'object' && data.equity[0].portfolio_value !== undefined) {
                        // Format is array of objects with portfolio_value property
                        console.log('Processing equity as objects with portfolio_value property');
                        data.equity.forEach(point => {
                            equityData.push(point.portfolio_value);
                        });
                    } else if (typeof data.equity[0] === 'object' && data.equity[0].value !== undefined) {
                        // Format is array of objects with value property
                        console.log('Processing equity as objects with value property');
                        data.equity.forEach(point => {
                            equityData.push(point.value);
                        });
                    } else if (typeof data.equity[0] === 'number') {
                        // Format is array of numbers
                        console.log('Processing equity as array of numbers');
                        equityData = [...data.equity];
                    }
                }
            } else if (typeof data.equity === 'object') {
                // Format might be an object with values array or similar
                console.log('Processing equity as object with values or portfolio array');
                if (data.equity.values && Array.isArray(data.equity.values)) {
                    equityData = [...data.equity.values];
                } else if (data.equity.portfolio && Array.isArray(data.equity.portfolio)) {
                    equityData = [...data.equity.portfolio];
                }
            }

            console.log('Processed equity data:', equityData);
            console.log('Equity data length:', equityData.length);
        } else {
            console.log('No equity data found in the response.');
        }

        // If portfolio data is still empty, try to create synthetic data
        if (!equityData.length) {
            console.log('Creating synthetic equity curve');
            const initialCapValue = parseFloat(initialCapital.value) || 100000;
            console.log('Initial capital:', initialCapValue);

            if (metrics && metrics.total_return !== undefined) {
                console.log('Using metrics total_return:', metrics.total_return);
                const finalValue = initialCapValue * (1 + metrics.total_return);

                // Create a simple linear growth from initial to final value
                const dataPoints = data.candles.length;
                for (let i = 0; i < dataPoints; i++) {
                    const progress = i / (dataPoints - 1);
                    equityData.push(initialCapValue + progress * (finalValue - initialCapValue));
                }
                console.log('Created synthetic equity data:', equityData);
            }
        }

        // Signals data
        if (data.signals) {
            if (data.signals.buy) {
                data.signals.buy.forEach(signal => {
                    const index = labels.findIndex(date => {
                        const tradeDate = new Date(signal.timestamp);
                        return date === tradeDate.toLocaleDateString();
                    });

                    if (index !== -1) {
                        buySignals.push({
                            x: index,
                            y: priceData[index],
                            r: 5
                        });
                    }
                });
            }

            if (data.signals.sell) {
                data.signals.sell.forEach(signal => {
                    const index = labels.findIndex(date => {
                        const tradeDate = new Date(signal.timestamp);
                        return date === tradeDate.toLocaleDateString();
                    });

                    if (index !== -1) {
                        sellSignals.push({
                            x: index,
                            y: priceData[index],
                            r: 5
                        });
                    }
                });
            }
        }

        // MA data if available
        if (data.indicators) {
            if (data.indicators.short_ma) {
                data.indicators.short_ma.forEach(point => {
                    shortMaData.push(point.value);
                });
            }

            if (data.indicators.long_ma) {
                data.indicators.long_ma.forEach(point => {
                    longMaData.push(point.value);
                });
            }
        }

        // Create datasets array
        const datasets = [
            {
                label: symbolInput.value + ' Price',
                data: priceData,
                borderColor: '#60a5fa',
                backgroundColor: 'rgba(96, 165, 250, 0.1)',
                borderWidth: 2,
                fill: false,
                tension: 0.1,
                yAxisID: 'y'
            },
            {
                label: 'Portfolio Value',
                data: equityData,
                borderColor: '#10b981',
                borderWidth: 2,
                fill: false,
                tension: 0.1,
                yAxisID: 'y1'
            }
        ];

        // Add indicator datasets if available
        if (shortMaData.length > 0) {
            datasets.push({
                label: 'Short MA',
                data: shortMaData,
                borderColor: '#f59e0b',
                borderWidth: 2,
                fill: false,
                tension: 0.1,
                yAxisID: 'y',
                pointRadius: 0
            });
        }

        if (longMaData.length > 0) {
            datasets.push({
                label: 'Long MA',
                data: longMaData,
                borderColor: '#ef4444',
                borderWidth: 2,
                fill: false,
                tension: 0.1,
                yAxisID: 'y',
                pointRadius: 0
            });
        }

        // Add buy/sell signals
        if (buySignals.length > 0) {
            datasets.push({
                label: 'Buy Signals',
                data: buySignals,
                backgroundColor: 'rgba(16, 185, 129, 0.8)',
                borderColor: 'rgba(16, 185, 129, 1)',
                borderWidth: 1,
                pointStyle: 'triangle',
                pointRadius: 8,
                pointRotation: 0,
                type: 'bubble',
                yAxisID: 'y'
            });
        }

        if (sellSignals.length > 0) {
            datasets.push({
                label: 'Sell Signals',
                data: sellSignals,
                backgroundColor: 'rgba(239, 68, 68, 0.8)',
                borderColor: 'rgba(239, 68, 68, 1)',
                borderWidth: 1,
                pointStyle: 'triangle',
                pointRadius: 8,
                pointRotation: 180,
                type: 'bubble',
                yAxisID: 'y'
            });
        }

        // Create the chart
        chart = new Chart(canvas, {
            type: 'line',
            data: {
                labels: labels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                aspectRatio: 2,  // Control aspect ratio
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                scales: {
                    x: {
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        },
                        ticks: {
                            color: 'rgba(255, 255, 255, 0.7)',
                            maxRotation: 45,
                            minRotation: 45
                        }
                    },
                    y: {
                        position: 'left',
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        },
                        ticks: {
                            color: 'rgba(255, 255, 255, 0.7)'
                        },
                        title: {
                            display: true,
                            text: 'Price',
                            color: 'rgba(255, 255, 255, 0.7)'
                        }
                    },
                    y1: {
                        position: 'right',
                        grid: {
                            drawOnChartArea: false
                        },
                        ticks: {
                            color: 'rgba(255, 255, 255, 0.7)'
                        },
                        title: {
                            display: true,
                            text: 'Portfolio Value',
                            color: 'rgba(255, 255, 255, 0.7)'
                        }
                    }
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            color: 'rgba(255, 255, 255, 0.7)'
                        }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false
                    },
                    // Add zoom plugin configuration
                    zoom: {
                        limits: {
                            y: {min: 'original', max: 'original', minRange: 1}  // Add minRange to prevent excessive zooming
                        },
                        zoom: {
                            wheel: {
                                enabled: true,
                                speed: 0.1
                            },
                            pinch: {
                                enabled: true
                            },
                            mode: 'xy'
                        },
                        pan: {
                            enabled: true,
                            mode: 'xy',
                            // Removed modifierKey to allow direct panning
                            threshold: 10  // Minimum pan distance in pixels
                        }
                    }
                }
            }
        });

        // Add reset zoom button
        const resetButton = document.createElement('button');
        resetButton.textContent = 'Reset Zoom';
        resetButton.className = 'mt-2 px-2 py-1 bg-gray-600 hover:bg-gray-500 text-white rounded-md text-sm transition duration-300';
        resetButton.onclick = function() {
            chart.resetZoom();
        };
        chartContainer.appendChild(resetButton);
    }

    /**
     * Update trade log
     */
    function updateTradeLog(trades) {
        tradeLog.innerHTML = '';

        if (!trades || trades.length === 0) {
            tradeLog.innerHTML = '<p class="text-gray-400 text-sm">No trades executed</p>';
            return;
        }

        trades.forEach(trade => {
            try {
                const tradeDiv = document.createElement('div');
                const profit = trade.profit_pct || 0;
                const tradeColor = profit > 0 ? 'border-green-500 bg-green-900/20' : 'border-red-500 bg-red-900/20';
                const profitColor = profit > 0 ? 'text-green-400' : 'text-red-400';

                tradeDiv.className = `p-2 rounded border-l-4 ${tradeColor}`;

                // Use safe defaults and check for null or undefined
                const entryDate = trade.entry_date ? new Date(trade.entry_date).toLocaleDateString() : 'N/A';
                const exitDate = trade.exit_date ? new Date(trade.exit_date).toLocaleDateString() : 'N/A';
                const entryPrice = trade.entry_price ? trade.entry_price.toFixed(2) : 'N/A';
                const exitPrice = trade.exit_price ? trade.exit_price.toFixed(2) : 'N/A';

                tradeDiv.innerHTML = `
                    <div class="flex justify-between items-center">
                        <span class="font-medium">Trade</span>
                        <span class="font-medium ${profitColor}">${profit.toFixed(2)}%</span>
                    </div>
                    <div class="text-sm text-gray-400">
                        Entry: ${entryDate} at ₹${entryPrice}
                    </div>
                    <div class="text-sm text-gray-400">
                        Exit: ${exitDate} at ₹${exitPrice}
                    </div>
                `;

                tradeLog.appendChild(tradeDiv);
            } catch (err) {
                console.error('Error processing trade:', err, trade);
            }
        });
    }

    // Load strategies from API
    function loadStrategies() {
        fetch('/api/strategies')
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    // Clear existing options except the first one
                    strategySelect.innerHTML = '<option value="">Select a strategy...</option>';

                    // Add strategies to dropdown
                    Object.entries(data.strategies).forEach(([key, strategy]) => {
                        const option = document.createElement('option');
                        option.value = key;
                        option.textContent = strategy.name;
                        strategySelect.appendChild(option);
                    });
                }
            })
            .catch(error => {
                console.error('Error loading strategies:', error);
            });
    }

    // Load strategies on page load
    loadStrategies();

    // Initialize strategy parameters on page load
    updateStrategyParams();
});
