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

// Track both chart instances
let priceChart = null;
let indicatorChart = null;
let chartContainer = null;

/**
 * Create price and equity chart using Lightweight Charts
 */
function createChart(data, metrics, container, symbolInput, initialCapital) {
    if (!container) return;

    // Clear any existing charts and store reference
    container.innerHTML = '';
    chartContainer = container;

    console.log('[Backtest Chart] Starting chart creation with separated views');

    try {
        // Define indicator styles at the function scope level so it's available everywhere
        const indicatorStyles = {
            'short_ma': { color: '#f59e0b', lineWidth: 1, title: 'Short MA' }, // Amber
            'long_ma': { color: '#ef4444', lineWidth: 1, title: 'Long MA' },    // Red
            'rsi': { color: '#8b5cf6', lineWidth: 2, title: 'RSI' },            // Purple
            'macd': { color: '#ec4899', lineWidth: 1, title: 'MACD' },          // Pink
            'signal': { color: '#3b82f6', lineWidth: 1, title: 'Signal' },      // Blue
            'ema': { color: '#06b6d4', lineWidth: 2, title: 'EMA' }             // Cyan
        };

        // Create container divs for each chart
        const priceChartContainer = document.createElement('div');
        priceChartContainer.style.width = '100%';
        priceChartContainer.style.height = '500px'; // Fixed height in pixels for main chart
        priceChartContainer.style.marginBottom = '10px';
        container.appendChild(priceChartContainer);

        const indicatorChartContainer = document.createElement('div');
        indicatorChartContainer.style.width = '100%';
        indicatorChartContainer.style.height = '150px'; // Fixed height in pixels for indicator chart
        container.appendChild(indicatorChartContainer);

        // Step 1: Create both charts with dark theme
        priceChart = LightweightCharts.createChart(priceChartContainer, {
            width: priceChartContainer.clientWidth,
            height: priceChartContainer.clientHeight,
            layout: {
                background: { type: 'solid', color: '#1f2937' },
                textColor: '#d1d5db',
            },
            grid: {
                vertLines: { color: '#374151' },
                horzLines: { color: '#374151' },
            },
            timeScale: {
                rightOffset: 5,
                barSpacing: 10,
            },
        });

        indicatorChart = LightweightCharts.createChart(indicatorChartContainer, {
            width: indicatorChartContainer.clientWidth,
            height: indicatorChartContainer.clientHeight,
            layout: {
                background: { type: 'solid', color: '#1f2937' },
                textColor: '#d1d5db',
            },
            grid: {
                vertLines: { color: '#374151' },
                horzLines: { color: '#374151' },
            },
            rightPriceScale: {
                scaleMargins: {
                    top: 0.1,
                    bottom: 0.1,
                },
            },
            timeScale: {
                rightOffset: 5,
                barSpacing: 10,
                visible: true,
            },
        });

        console.log('[Backtest Chart] Both charts created');

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
                const candleSeries = priceChart.addCandlestickSeries({
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
                    const equitySeries = priceChart.addLineSeries({
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
                    priceChart.priceScale('overlay-scale-right').applyOptions({
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

                // Step 6: Add technical indicators if available
                if (data.indicators) {
                    console.log('[Backtest Chart] Processing indicators:', data.indicators);

                    // Process each indicator
                    Object.keys(data.indicators).forEach(indicatorKey => {
                        const indicatorData = data.indicators[indicatorKey];
                        if (!Array.isArray(indicatorData) || indicatorData.length === 0) {
                            console.log(`[Backtest Chart] Indicator ${indicatorKey} has no data or is invalid`);
                            return;
                        }

                        console.log(`[Backtest Chart] Processing indicator: ${indicatorKey}, ${indicatorData.length} points`);
                        console.log(`[Backtest Chart] First indicator point sample:`, indicatorData[0]);

                        // Choose style for this indicator (use default if not found)
                        const style = indicatorStyles[indicatorKey] || {
                            color: '#9ca3af', // Default gray
                            lineWidth: 1,
                            title: indicatorKey
                        };

                        // Decide which chart to place the indicator on
                        // Only RSI goes to the indicator chart, everything else to the price chart
                        const targetChart = (indicatorKey === 'rsi') ? indicatorChart : priceChart;

                        // Create line series for this indicator
                        const indicatorSeries = targetChart.addLineSeries({
                            color: style.color,
                            lineWidth: style.lineWidth,
                            title: style.title,
                            // RSI is on its own chart, no need for overlay
                            // Other indicators on price chart need overlay: true
                            overlay: indicatorKey !== 'rsi',
                            // Common styling for all indicators
                            lastValueVisible: true,
                            crosshairMarkerVisible: true,
                            crosshairMarkerRadius: 3,
                        });

                        // Process indicator data
                        const formattedData = [];

                        // Store the candle timestamps for potential mapping
                        const candleTimestamps = data.candles.map(candle => {
                            try {
                                return Math.floor(new Date(candle.timestamp).getTime() / 1000);
                            } catch (e) {
                                return null;
                            }
                        }).filter(timestamp => timestamp !== null);

                        // Find the latest candle timestamp for the final interpolation
                        const latestCandleTime = candleTimestamps.length > 0 ?
                            Math.max(...candleTimestamps) : null;

                        console.log(`[Backtest Chart] Last candle timestamp: ${latestCandleTime ? new Date(latestCandleTime * 1000).toISOString() : 'N/A'}`);

                        indicatorData.forEach((point, index) => {
                            // Get the value - could be direct or in a value property
                            let value, timestamp;

                            // More detailed logging for debugging
                            if (index < 5) {
                                console.log(`[Backtest Chart] ${indicatorKey} raw data point ${index}:`, point);
                                if (data.candles && data.candles[index]) {
                                    console.log(`[Backtest Chart] Corresponding candle timestamp:`, data.candles[index].timestamp);
                                }
                            }

                            if (point === null || point === undefined) {
                                if (index < 5) console.log(`[Backtest Chart] ${indicatorKey} point ${index} is null or undefined`);
                                return;
                            }

                            if (typeof point === 'object') {
                                // For object format, extract value and timestamp directly from the object's properties
                                // Check for common naming patterns in the data
                                const indicatorValue = point[indicatorKey] !== undefined ? point[indicatorKey] :
                                                      point.value !== undefined ? point.value : null;

                                if (indicatorValue !== null && !isNaN(Number(indicatorValue))) {
                                    value = Number(indicatorValue);

                                    // Get timestamp directly from the point
                                    if (point.timestamp) {
                                        timestamp = point.timestamp;
                                    } else if (data.candles && index < data.candles.length) {
                                        timestamp = data.candles[index].timestamp;
                                    }
                                }
                            } else if (typeof point === 'number' || !isNaN(Number(point))) {
                                // Format: Simple array of values (allowing for string numbers too)
                                value = Number(point);
                                // We need to use candle timestamps
                                if (data.candles && index < data.candles.length) {
                                    timestamp = data.candles[index].timestamp;
                                }
                            } else if (Array.isArray(point) && point.length >= 2) {
                                // Format: [timestamp, value] array
                                timestamp = point[0];
                                value = Number(point[1]);
                            }

                            // Validate with detailed logging
                            if (!timestamp) {
                                if (index < 5) console.log(`[Backtest Chart] Skipping ${indicatorKey} point at index ${index}, missing timestamp`);
                                return;
                            }

                            if (typeof value !== 'number' || isNaN(value)) {
                                if (index < 5) console.log(`[Backtest Chart] Skipping ${indicatorKey} point at index ${index}, invalid value:`, value);
                                return;
                            }

                            // Convert timestamp to seconds
                            try {
                                // Handle timestamps that are already in seconds (numeric)
                                let time;
                                if (typeof timestamp === 'number') {
                                    time = timestamp;
                                } else {
                                    // Parse the timestamp string directly
                                    time = Math.floor(new Date(timestamp).getTime() / 1000);

                                    if (index < 5 || index > indicatorData.length - 5) {
                                        console.log(`[Backtest Chart] Converted timestamp for ${indicatorKey} at index ${index}: ${timestamp} → ${new Date(time * 1000).toISOString()}`);
                                    }
                                }

                                if (!isNaN(time)) {
                                    formattedData.push({
                                        time: time,
                                        value: value
                                    });
                                } else {
                                    if (index < 5) console.log(`[Backtest Chart] Invalid time conversion for ${indicatorKey} at index ${index}:`, timestamp, "→", time);
                                }
                            } catch (e) {
                                if (index < 5) console.log(`[Backtest Chart] Error converting timestamp for ${indicatorKey} at index ${index}:`, e, "Original timestamp:", timestamp);
                            }
                        });

                        // Only set data if we have valid formatted data
                        if (formattedData.length > 0) {
                            // Sort by time
                            formattedData.sort((a, b) => a.time - b.time);

                            // Check if the last indicator point matches the last candle
                            const lastIndicatorTime = formattedData[formattedData.length - 1].time;

                            // If indicator data doesn't extend to the last candle, extend it
                            if (latestCandleTime && lastIndicatorTime < latestCandleTime) {
                                console.log(`[Backtest Chart] Extending ${indicatorKey} to last candle: ${new Date(latestCandleTime * 1000).toISOString()}`);
                                // Get the last indicator value and extend it to the last candle
                                const lastValue = formattedData[formattedData.length - 1].value;
                                formattedData.push({
                                    time: latestCandleTime,
                                    value: lastValue
                                });
                            }

                            // Set the indicator data
                            indicatorSeries.setData(formattedData);
                            console.log(`[Backtest Chart] Set data for indicator: ${indicatorKey} with ${formattedData.length} points`);
                        } else {
                            console.log(`[Backtest Chart] No valid data points after processing for indicator: ${indicatorKey}`);
                        }
                    });
                }

                console.log('[Backtest Chart] Chart setup complete');
            } else {
                console.log('[Backtest Chart] No valid OHLC data available to create chart');
            }
        } else {
            console.log('[Backtest Chart] No candle data found or data is not an array');
        }
    } catch (e) {
        console.error('[Backtest Chart] Error in chart creation:', e);
    }
}

/**
 * Update the trade log table with backtest metrics
 */
function updateTradeLog(tradeLog, container) {
    if (!container || !Array.isArray(tradeLog)) return;

    // Clear existing content
    container.innerHTML = '';

    // Create table header
    const header = document.createElement('tr');
    header.innerHTML = `
        <th style="text-align: left; padding: 8px;">Symbol</th>
        <th style="text-align: right; padding: 8px;">Profit/Loss</th>
        <th style="text-align: right; padding: 8px;">% Change</th>
        <th style="text-align: right; padding: 8px;">Sharpe Ratio</th>
        <th style="text-align: right; padding: 8px;">Max Drawdown</th>
        <th style="text-align: right; padding: 8px;">Trade Count</th>
    `;
    container.appendChild(header);

    // Sort trade log by profit/loss descending
    const sortedLog = tradeLog.sort((a, b) => b.pnl - a.pnl);

    // Add each trade to the table
    sortedLog.forEach(trade => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td style="padding: 8px;">${trade.symbol}</td>
            <td style="text-align: right; padding: 8px;">${trade.pnl.toFixed(2)}</td>
            <td style="text-align: right; padding: 8px;">${(trade.percent_change * 100).toFixed(2)}%</td>
            <td style="text-align: right; padding: 8px;">${trade.sharpe_ratio.toFixed(2)}</td>
            <td style="text-align: right; padding: 8px;">${trade.max_drawdown.toFixed(2)}</td>
            <td style="text-align: right; padding: 8px;">${trade.trade_count}</td>
        `;
        container.appendChild(row);
    });
}

// Export the functions
export { createChart, updateTradeLog };
