/**
 * Convert time to local timezone for consistent display
 * @param {number} originalTime - The original time in seconds since the Unix epoch
 * @returns {number} - The converted time in seconds since the Unix epoch, adjusted to local timezone
 */
function timeToLocal(originalTime) {
    const d = new Date(originalTime * 1000);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()) / 1000;
}

/**
 * Performance Metrics and Chart Visualization
 * Handles chart creation and trade log updates
 */

let chart = null;
let chartContainer = null;

/**
 * Create price and equity chart using Lightweight Charts
 */
function createChart(data, metrics, container, symbolInput, initialCapital) {
    if (!container) return;

    // Clear any existing chart and store reference
    container.innerHTML = '';
    chartContainer = container;

    console.log('[Backtest Chart] Starting with simplified candle-only chart');

    try {
        // Step 1: Create the chart with dark theme
        chart = LightweightCharts.createChart(container, {
            width: container.clientWidth,
            height: container.clientHeight,
            layout: {
                background: { type: 'solid', color: '#1f2937' },
                textColor: '#d1d5db',
            },
            grid: {
                vertLines: { color: '#374151' },
                horzLines: { color: '#374151' },
            },
        });

        console.log('[Backtest Chart] Chart created');

        // Step 2: Process only candle data with strict validation
        let ohlcData = [];

        console.log('[Backtest Chart] Candles array length:', data.candles?.length || 0);
        console.log('[Backtest Chart] First candle sample:', data.candles?.[0]);

        if (Array.isArray(data.candles) && data.candles.length > 0) {
            // Process candles with more logging
            data.candles.forEach((candle, index) => {
                if (!candle || !candle.timestamp) {
                    if (index < 5) console.log(`[Backtest Chart] Skipping candle at index ${index}, invalid candle or timestamp`);
                    return;
                }

                // Log first few candles for debugging
                if (index < 5) {
                    console.log(`[Backtest Chart] Processing candle ${index}:`, {
                        timestamp: candle.timestamp,
                        open: candle.open,
                        high: candle.high,
                        low: candle.low,
                        close: candle.close
                    });
                }

                // Validate OHLC values
                if (typeof candle.open !== 'number' || typeof candle.high !== 'number' ||
                    typeof candle.low !== 'number' || typeof candle.close !== 'number') {
                    if (index < 5) console.log(`[Backtest Chart] Skipping candle at index ${index}, invalid OHLC values`);
                    return;
                }

                // Convert timestamp to seconds
                let time;
                try {
                    time = Math.floor(new Date(candle.timestamp).getTime() / 1000);
                    if (isNaN(time)) {
                        if (index < 5) console.log(`[Backtest Chart] Skipping candle at index ${index}, invalid timestamp conversion`);
                        return;
                    }
                } catch (e) {
                    if (index < 5) console.log(`[Backtest Chart] Error converting timestamp at index ${index}:`, e);
                    return;
                }

                // Add valid candle to data
                ohlcData.push({
                    time: time,
                    open: candle.open,
                    high: candle.high,
                    low: candle.low,
                    close: candle.close
                });
            });

            console.log(`[Backtest Chart] Processed ${ohlcData.length} valid candles`);

            // Step 3: Sort data chronologically
            ohlcData.sort((a, b) => a.time - b.time);

            // Remove duplicate timestamps (keeping only the first occurrence)
            const uniqueTimes = new Set();
            ohlcData = ohlcData.filter(candle => {
                if (uniqueTimes.has(candle.time)) {
                    return false;
                }
                uniqueTimes.add(candle.time);
                return true;
            });

            console.log(`[Backtest Chart] After deduplication: ${ohlcData.length} candles`);

            // Step 4: Create candlestick series if we have data
            if (ohlcData.length > 0) {
                const candleSeries = chart.addCandlestickSeries({
                    upColor: '#26a69a',
                    downColor: '#ef5350',
                    borderVisible: false,
                    wickUpColor: '#26a69a',
                    wickDownColor: '#ef5350'
                });

                // Set the candlestick data
                candleSeries.setData(ohlcData);
                console.log('[Backtest Chart] Set candlestick data');

                // Step 5: Add portfolio equity line if available
                if (data.equity && data.equity.length > 0) {
                    console.log('[Backtest Chart] Processing portfolio data:', data.equity.length, 'points');
                    console.log('[Backtest Chart] First portfolio point sample:', data.equity[0]);

                    // Create a separate scale for the equity line
                    const equitySeries = chart.addLineSeries({
                        color: '#4CAF50',
                        lineWidth: 2,
                        // Use separate price scale but overlay on the same chart
                        priceScaleId: 'overlay-scale-right',
                        // Make the price scale visible on the right side
                        lastValueVisible: true,
                        priceLineVisible: true,
                        // Set up separate formatting
                        priceFormat: {
                            type: 'price',
                            precision: 2,
                            minMove: 0.01,
                        },
                        // Add a title to distinguish it in the legend
                        title: 'Portfolio',
                        // Overlay on the same chart
                        overlay: true,
                        // Additional styling
                        lineType: 1, // LineType.Simple in v4.2.0
                        crosshairMarkerVisible: true,
                        crosshairMarkerRadius: 4,
                    });

                    // Configure the price axis for the equity series
                    chart.priceScale('overlay-scale-right').applyOptions({
                        visible: true,
                        borderColor: '#4b5563',
                        borderVisible: true,
                        scaleMargins: {
                            top: 0.1,
                            bottom: 0.2,
                        },
                        // Use a different text color to differentiate
                        textColor: '#4CAF50',
                    });

                    // Process equity data with validation
                    const equityData = [];
                    data.equity.forEach((point, index) => {
                        // Different equity data formats are possible - handle them all
                        let timestamp, value;

                        if (typeof point === 'object') {
                            // Format: {timestamp: "...", portfolio_value: 10000}
                            if (point.timestamp && (point.portfolio_value !== undefined || point.value !== undefined)) {
                                timestamp = point.timestamp;
                                value = point.portfolio_value !== undefined ? point.portfolio_value : point.value;
                            }
                        } else if (typeof point === 'number') {
                            // Format: Simple array of values
                            value = point;
                            // We need to use candle timestamps in this case
                            if (data.candles[index]) {
                                timestamp = data.candles[index].timestamp;
                            }
                        }

                        // Validate
                        if (!timestamp || typeof value !== 'number' || isNaN(value)) {
                            if (index < 5) console.log(`[Backtest Chart] Skipping portfolio point at index ${index}, invalid data`);
                            return;
                        }

                        // Convert timestamp to seconds
                        try {
                            const time = Math.floor(new Date(timestamp).getTime() / 1000);
                            if (!isNaN(time)) {
                                equityData.push({
                                    time: time,
                                    value: value
                                });
                            }
                        } catch (e) {
                            if (index < 5) console.log(`[Backtest Chart] Error converting equity timestamp at index ${index}:`, e);
                        }
                    });

                    console.log(`[Backtest Chart] Processed ${equityData.length} valid equity points`);

                    // Only add the series if we have data
                    if (equityData.length > 0) {
                        // Sort by time
                        equityData.sort((a, b) => a.time - b.time);

                        // Set the equity data
                        equitySeries.setData(equityData);
                        console.log('[Backtest Chart] Set portfolio equity data');
                    }
                }

                // Fit content to view
                chart.timeScale().fitContent();
                console.log('[Backtest Chart] Fitted timescale to content');

                // Add simple chart legend
                const legend = document.createElement('div');
                legend.className = 'chart-legend';
                legend.innerHTML = `<div style="color: white; text-align: center; margin-top: 10px;">
                    ${symbolInput?.value || 'Price Chart'} - ${ohlcData.length} candles
                    ${data.equity ? ' | Portfolio Equity Line' : ''}
                </div>`;
                container.appendChild(legend);
            } else {
                console.error('[Backtest Chart] No valid candle data after processing');
                container.innerHTML = '<div style="color: red; text-align: center; margin-top: 20px;">No valid candle data available</div>';
            }
        } else {
            console.error('[Backtest Chart] No candles array in data');
            container.innerHTML = '<div style="color: red; text-align: center; margin-top: 20px;">No candle data available</div>';
        }

    } catch (error) {
        console.error('[Backtest Chart] Error creating chart:', error);
        container.innerHTML = `<div style="color: red; text-align: center; margin-top: 20px;">
            Error creating chart: ${error.message}
        </div>`;
    }
}

/**
 * Handle window resize
 */
function handleResize() {
    if (chart && chartContainer) {
        chart.applyOptions({
            width: chartContainer.clientWidth,
            height: chartContainer.clientHeight - 30 // Account for legend
        });
    }
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
