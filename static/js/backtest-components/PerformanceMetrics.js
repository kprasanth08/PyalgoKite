/**
 * Performance Metrics and Chart Visualization
 * Handles chart creation and trade log updates
 */

let chart = null;

/**
 * Create price and equity chart
 */
function createChart(data, metrics, chartContainer, symbolInput, initialCapital) {
    if (!chartContainer) return;

    // Clear any existing chart
    if (chart) {
        chart.destroy();
    }

    // Add detailed logging for debugging
    console.log('Creating chart with data:', data);
    console.log('Portfolio/Equity data:', data.equity);
    console.log('Initial capital parameter:', initialCapital);

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

    // Generate portfolio values from candle data if position information is available
    // Handle the case when initialCapital is undefined
    let initialCapValue = 100000; // Default value
    if (initialCapital && typeof initialCapital.value !== 'undefined') {
        initialCapValue = parseFloat(initialCapital.value) || 100000;
    } else if (initialCapital && typeof initialCapital === 'number') {
        initialCapValue = initialCapital;
    } else if (metrics && metrics.initial_capital) {
        initialCapValue = metrics.initial_capital;
    }

    let portfolioValue = initialCapValue;
    let shares = 0;
    let inPosition = false;

    // First look for equity data in the response
    if (data.equity) {
        console.log('Processing equity data from response');
        if (Array.isArray(data.equity)) {
            if (data.equity.length > 0) {
                if (typeof data.equity[0] === 'object' && data.equity[0].portfolio_value !== undefined) {
                    data.equity.forEach(point => {
                        equityData.push(point.portfolio_value);
                    });
                } else if (typeof data.equity[0] === 'object' && data.equity[0].value !== undefined) {
                    data.equity.forEach(point => {
                        equityData.push(point.value);
                    });
                } else if (typeof data.equity[0] === 'number') {
                    equityData = [...data.equity];
                }
            }
        } else if (typeof data.equity === 'object') {
            if (data.equity.values && Array.isArray(data.equity.values)) {
                equityData = [...data.equity.values];
            } else if (data.equity.portfolio && Array.isArray(data.equity.portfolio)) {
                equityData = [...data.equity.portfolio];
            }
        }
    }

    // If no equity data found, calculate it from position data in candles
    if (equityData.length === 0) {
        console.log('No equity data found, generating from position/signal data');

        // First pass to detect buy/sell signals from position changes
        const buyDates = [];
        const sellDates = [];

        for (let i = 1; i < data.candles.length; i++) {
            const prevCandle = data.candles[i-1];
            const currCandle = data.candles[i];

            // Check for position changes (0 to 1 = buy, 1 to 0 = sell)
            if (currCandle.position === 1 && (prevCandle.position === 0 || prevCandle.position === null)) {
                buyDates.push({
                    timestamp: currCandle.timestamp,
                    price: currCandle.close
                });

                // Add to buySignals for chart
                buySignals.push({
                    x: i,
                    y: currCandle.close,
                    r: 5
                });
            }
            else if (currCandle.position === 0 && prevCandle.position === 1) {
                sellDates.push({
                    timestamp: currCandle.timestamp,
                    price: currCandle.close
                });

                // Add to sellSignals for chart
                sellSignals.push({
                    x: i,
                    y: currCandle.close,
                    r: 5
                });
            }
        }

        console.log('Detected buy signals:', buyDates);
        console.log('Detected sell signals:', sellDates);

        // Now calculate portfolio equity curve
        let currentShares = 0;
        let cashBalance = initialCapValue;
        equityData = [];

        data.candles.forEach((candle, index) => {
            // Check if this is a buy date
            const buyMatch = buyDates.find(signal => signal.timestamp === candle.timestamp);
            if (buyMatch) {
                // Invest 95% of available cash in shares
                const investAmount = cashBalance * 0.95;
                currentShares = investAmount / candle.close;
                cashBalance -= investAmount;
                console.log(`Buy at ${candle.close}: ${currentShares} shares, remaining cash: ${cashBalance}`);
            }

            // Check if this is a sell date
            const sellMatch = sellDates.find(signal => signal.timestamp === candle.timestamp);
            if (sellMatch) {
                // Sell all shares
                cashBalance += currentShares * candle.close;
                currentShares = 0;
                console.log(`Sell at ${candle.close}: new cash balance: ${cashBalance}`);
            }

            // Calculate current portfolio value
            const portfolioValue = cashBalance + (currentShares * candle.close);
            equityData.push(portfolioValue);
        });
    }

    // If still empty, create a synthetic curve based on total return
    if (equityData.length === 0 && metrics && metrics.total_return !== undefined) {
        console.log('Creating synthetic equity curve from total return');
        const finalValue = initialCapValue * (1 + metrics.total_return);

        // Create a simple linear growth from initial to final value
        const dataPoints = data.candles.length;
        for (let i = 0; i < dataPoints; i++) {
            const progress = i / (dataPoints - 1);
            equityData.push(initialCapValue + progress * (finalValue - initialCapValue));
        }
    }

    console.log('Final equity data:', equityData);

    // If no signals detected yet, try to get them from the API data
    if (buySignals.length === 0 && sellSignals.length === 0) {
        if (data.signals) {
            console.log('Processing signals from API data', data.signals);

            // Process buy signals
            if (data.signals.buy && Array.isArray(data.signals.buy)) {
                data.signals.buy.forEach(signal => {
                    const index = labels.findIndex(date => {
                        const signalDate = new Date(signal.timestamp);
                        return date === signalDate.toLocaleDateString();
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

            // Process sell signals
            if (data.signals.sell && Array.isArray(data.signals.sell)) {
                data.signals.sell.forEach(signal => {
                    const index = labels.findIndex(date => {
                        const signalDate = new Date(signal.timestamp);
                        return date === signalDate.toLocaleDateString();
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
    }

    // Create trades array for trade log if necessary
    if (!metrics.trades || metrics.trades.length === 0) {
        const trades = [];
        // Pair up buy and sell signals to create trades
        const buyDates = [];
        const sellDates = [];

        // Extract buy and sell dates from signals
        data.candles.forEach((candle, index) => {
            const buySignal = buySignals.find(s => s.x === index);
            const sellSignal = sellSignals.find(s => s.x === index);

            if (buySignal) {
                buyDates.push({
                    timestamp: candle.timestamp,
                    price: candle.close
                });
            }

            if (sellSignal) {
                sellDates.push({
                    timestamp: candle.timestamp,
                    price: candle.close
                });
            }
        });

        for (let i = 0; i < Math.min(buyDates.length, sellDates.length); i++) {
            const buyDate = buyDates[i];
            const sellDate = sellDates[i];

            if (buyDate && sellDate) {
                const profitPct = ((sellDate.price / buyDate.price) - 1) * 100;

                trades.push({
                    entry_date: buyDate.timestamp,
                    exit_date: sellDate.timestamp,
                    entry_price: buyDate.price,
                    exit_price: sellDate.price,
                    profit_pct: profitPct
                });
            }
        }

        if (trades.length > 0) {
            console.log('Generated trades from signals:', trades);
            if (!metrics.trades) metrics.trades = trades;
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
            label: (symbolInput && symbolInput.value ? symbolInput.value : 'Price') + ' Price',
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
                zoom: {
                    limits: {
                        y: {min: 'original', max: 'original', minRange: 1}
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
                        threshold: 10
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
function updateTradeLog(trades, tradeLogContainer) {
    tradeLogContainer.innerHTML = '';

    if (!trades || trades.length === 0) {
        tradeLogContainer.innerHTML = '<p class="text-gray-400 text-sm">No trades executed</p>';
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

            tradeLogContainer.appendChild(tradeDiv);
        } catch (err) {
            console.error('Error processing trade:', err, trade);
        }
    });
}

export { createChart, updateTradeLog };
