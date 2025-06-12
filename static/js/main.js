let chart = null;

// Global variable to track current symbol and timeframe
let currentSymbol = null;
let currentTimeframe = '1day'; // Default timeframe

function initializeChart() {
    if (chart) {
        chart.remove();
    }
    chart = LightweightCharts.createChart(document.getElementById('priceChart'), {
        width: document.getElementById('priceChart').clientWidth,
        height: 400,
        layout: {
            backgroundColor: '#ffffff',
            textColor: '#333',
        },
        grid: {
            vertLines: {
                color: 'rgba(197, 203, 206, 0.5)',
            },
            horzLines: {
                color: 'rgba(197, 203, 206, 0.5)',
            },
        },
        crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal,
        },
        rightPriceScale: {
            borderColor: 'rgba(197, 203, 206, 1)',
            autoScale: true,
        },
        timeScale: {
            borderColor: 'rgba(197, 203, 206, 1)',
            timeVisible: true,
            secondsVisible: false,
        },
    });

    window.addEventListener('resize', () => {
        chart.applyOptions({
            width: document.getElementById('priceChart').clientWidth
        });
    });

    return chart;
}

function fetchMarketData() {
    const symbol = document.getElementById('symbolInput').value;

    if (!symbol) {
        alert('Please enter a valid symbol');
        return;
    }

    // Show loading indicator
    document.getElementById('priceChart').innerHTML = '<div style="display: flex; justify-content: center; align-items: center; height: 400px;">Loading chart data...</div>';

    // Use the new merged chart data endpoint
    fetch(`/api/merged-chart-data?symbol=${encodeURIComponent(symbol)}`)
        .then(response => response.json())
        .then(data => {
            console.log("Raw API response:", data);

            let candles = [];

            // Handle different response formats
            if (data.success === true && Array.isArray(data.data)) {
                candles = data.data;
            } else if (data.status === "success" && data.data && Array.isArray(data.data.candles)) {
                candles = data.data.candles;
            } else if (data.code === 200 && data.data && Array.isArray(data.data.candles)) {
                candles = data.data.candles;
            } else {
                throw new Error("Unexpected data format");
            }

            // Clear any previous content
            document.getElementById('priceChart').innerHTML = '';

            renderChart(candles);

            // Set up a timer to refresh data every 60 seconds to keep the chart updated
            // Only set up timer if we haven't already
            if (!window.chartRefreshTimer) {
                window.chartRefreshTimer = setInterval(() => {
                    refreshChartData(symbol);
                }, 60000); // 60 seconds
            }
        })
        .catch(error => {
            console.error('Error:', error);
            document.getElementById('priceChart').innerHTML =
                `<div style="display: flex; justify-content: center; align-items: center; height: 400px; color: red;">
                    Error loading chart data: ${error.message}
                </div>`;
        });
}

// When the DOM is fully loaded, set up event listeners
document.addEventListener('DOMContentLoaded', function() {
    // Set up timeframe selection event handler
    const timeframeSelect = document.getElementById('timeframeSelect');
    if (timeframeSelect) {
        // Set the initial value from storage or default to 1day
        currentTimeframe = localStorage.getItem('selectedTimeframe') || '1day';
        timeframeSelect.value = currentTimeframe;

        // Add change event listener
        timeframeSelect.addEventListener('change', function() {
            currentTimeframe = this.value;
            localStorage.setItem('selectedTimeframe', currentTimeframe);

            // If we have a current symbol, reload the chart with the new timeframe
            if (currentSymbol) {
                loadChartData(currentSymbol, currentTimeframe);

                // Update chart status to show loading
                const chartStatus = document.getElementById('chartStatus');
                if (chartStatus) {
                    chartStatus.textContent = `Loading ${currentTimeframe} data...`;
                }
            }
        });
    }
});

// Function to load chart data with proper timeframe
function loadChartData(symbol, timeframe) {
    currentSymbol = symbol;

    // Update chart title
    const chartSymbol = document.getElementById('chartSymbol');
    if (chartSymbol) {
        chartSymbol.textContent = `${symbol} - ${formatTimeframeDisplay(timeframe)}`;
    }

    // Show loading in chart container
    const chartContainer = document.getElementById('chartContainer');
    if (chartContainer) {
        chartContainer.innerHTML = '<div class="flex items-center justify-center h-full text-gray-500">Loading chart data...</div>';
    }

    // Hide placeholder if it exists
    const chartPlaceholder = document.getElementById('chartPlaceholder');
    if (chartPlaceholder) {
        chartPlaceholder.style.display = 'none';
    }

    // Create chart container if it doesn't exist
    if (!document.getElementById('priceChart')) {
        chartContainer.innerHTML = '<div id="priceChart" style="width: 100%; height: 100%;"></div>';
    }

    // Fetch data with the specified timeframe
    fetch(`/api/merged-chart-data?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(timeframe)}`)
        .then(response => response.json())
        .then(data => {
            console.log("Raw API response:", data);

            let candles = [];

            // Handle different response formats
            if (data.success === true && Array.isArray(data.data)) {
                candles = data.data;
            } else if (data.status === "success" && data.data && Array.isArray(data.data.candles)) {
                candles = data.data.candles;
            } else if (data.code === 200 && data.data && Array.isArray(data.data.candles)) {
                candles = data.data.candles;
            } else {
                throw new Error("Unexpected data format");
            }

            // Update chart status to show success
            const chartStatus = document.getElementById('chartStatus');
            if (chartStatus) {
                chartStatus.textContent = `${candles.length} candles loaded`;
            }

            // Render the chart with the retrieved data
            renderChart(candles);

            // Set up refresh timer
            setupChartRefreshTimer(symbol, timeframe);
        })
        .catch(error => {
            console.error('Error:', error);
            const chartContainer = document.getElementById('chartContainer');
            if (chartContainer) {
                chartContainer.innerHTML = `
                    <div class="flex items-center justify-center h-full text-red-400">
                        Error loading chart data: ${error.message}
                    </div>
                `;
            }
        });
}

// Helper function to format timeframe for display
function formatTimeframeDisplay(timeframe) {
    switch (timeframe) {
        case '1minute': return '1 Min';
        case '5minute': return '5 Min';
        case '15minute': return '15 Min';
        case '30minute': return '30 Min';
        case '1hour': return '1 Hour';
        case '1day': return 'Daily';
        case '1week': return 'Weekly';
        case '1month': return 'Monthly';
        default: return timeframe;
    }
}

// Set up a timer to refresh data periodically
function setupChartRefreshTimer(symbol, timeframe) {
    // Clear any existing timer
    if (window.chartRefreshTimer) {
        clearInterval(window.chartRefreshTimer);
    }

    // Set refresh interval based on timeframe
    let refreshInterval;
    switch (timeframe) {
        case '1minute': refreshInterval = 30000; break; // 30 seconds
        case '5minute': refreshInterval = 60000; break; // 1 minute
        case '15minute': refreshInterval = 60000; break; // 1 minute
        case '30minute': refreshInterval = 60000; break; // 1 minute
        case '1hour': refreshInterval = 300000; break;   // 5 minutes
        default: refreshInterval = 300000; break;        // 5 minutes
    }

    window.chartRefreshTimer = setInterval(() => {
        refreshChartData(symbol, timeframe);
    }, refreshInterval);
}

function refreshChartData(symbol, timeframe) {
    if (!symbol || !chart) {
        return; // No symbol selected or chart not initialized
    }

    console.log(`Refreshing chart data for ${symbol} with ${timeframe} timeframe...`);

    // Use the timeframe parameter when refreshing data
    fetch(`/api/merged-chart-data?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(timeframe || currentTimeframe)}`)
        .then(response => response.json())
        .then(data => {
            if (data.success === true && Array.isArray(data.data)) {
                // Update existing chart with new data
                const candleSeries = chart.getSeries()[0];
                if (candleSeries) {
                    candleSeries.setData(formatChartData(data.data));
                    console.log("Chart data refreshed successfully");

                    // Update chart status
                    const chartStatus = document.getElementById('chartStatus');
                    if (chartStatus) {
                        chartStatus.textContent = `Updated: ${new Date().toLocaleTimeString()}`;
                    }
                }
            }
        })
        .catch(error => {
            console.error('Error refreshing chart data:', error);

            // Update chart status to show error
            const chartStatus = document.getElementById('chartStatus');
            if (chartStatus) {
                chartStatus.textContent = `Error: ${error.message}`;
                chartStatus.style.color = 'red';
            }
        });
}

function formatChartData(candles) {
    // Filter out any invalid candles
    const validCandles = candles.filter(candle =>
        candle.length >= 5 &&
        candle[0] !== null &&
        candle[1] !== null &&
        candle[2] !== null &&
        candle[3] !== null &&
        candle[4] !== null
    );

    // Sort by date (ascending)
    validCandles.sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime());

    // Check if this is intraday data by looking for multiple candles in the same day
    const dateMap = {};
    validCandles.forEach(candle => {
        const dateOnly = candle[0].split('T')[0];
        if (!dateMap[dateOnly]) dateMap[dateOnly] = 0;
        dateMap[dateOnly]++;
    });

    // If any day has more than one candle, it's intraday data
    const isIntraday = Object.values(dateMap).some(count => count > 1);

    // Format for lightweight-charts
    return validCandles.map(candle => {
        let timeValue;

        if (isIntraday) {
            // For intraday data, use Unix timestamp in seconds (as number)
            timeValue = Math.floor(new Date(candle[0]).getTime() / 1000);
        } else {
            // For daily/weekly/monthly data, use YYYY-MM-DD format (as string)
            timeValue = candle[0].split('T')[0];
        }

        return {
            time: timeValue,
            open: parseFloat(candle[1]),
            high: parseFloat(candle[2]),
            low: parseFloat(candle[3]),
            close: parseFloat(candle[4]),
            volume: candle[5] ? parseFloat(candle[5]) : 0
        };
    });
}

function renderChart(candles) {
    try {
        console.log("Starting chart rendering with", candles.length, "candles");

        // Filter out any invalid candles
        const validCandles = candles.filter(candle =>
            candle.length >= 5 &&
            candle[0] !== null &&
            candle[1] !== null &&
            candle[2] !== null &&
            candle[3] !== null &&
            candle[4] !== null
        );

        console.log(`Have ${validCandles.length} valid candles after filtering`);

        if (validCandles.length === 0) {
            document.getElementById('priceChart').innerHTML =
                '<div style="display: flex; justify-content: center; align-items: center; height: 400px;">No valid data available</div>';
            return;
        }

        // Sort by date (ascending) - important for proper chart rendering
        validCandles.sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime());

        // Determine if this is intraday data
        let isIntraday = false;
        if (validCandles.length > 1) {
            const firstDay = validCandles[0][0].split('T')[0];
            isIntraday = validCandles.some(candle =>
                candle[0].split('T')[0] === firstDay &&
                candle[0] !== validCandles[0][0]
            );
        }
        console.log("Data appears to be intraday:", isIntraday);

        // For debugging - log a few candles
        console.log("Sample candles:", validCandles.slice(0, 5));

        // Process candles into chart data format
        const chartData = [];
        const timestampMap = {}; // To store original timestamps by timeKey

        validCandles.forEach(candle => {
            // For intraday data, use timestamps in seconds
            // For daily data, use YYYY-MM-DD strings
            let timeKey;
            if (isIntraday) {
                // Parse timestamp from candle data
                const timestampStr = candle[0]; // Format is like "2025-06-12T09:15:00+05:30"

                // Store the original timestamp
                const dateParts = timestampStr.split('T');
                const timePart = dateParts[1].split('+')[0].split('-')[0]; // Get time without timezone (e.g., "09:15:00")
                const timeHoursMinutes = timePart.split(':').slice(0, 2).join(':'); // Extract "09:15"

                // Parse as UTC timestamp (seconds since epoch)
                const date = new Date(timestampStr);
                timeKey = Math.floor(date.getTime() / 1000);

                // Store original time string for this timeKey
                timestampMap[timeKey] = timeHoursMinutes;
            } else {
                // For daily/weekly/monthly, use date only as string
                timeKey = candle[0].split('T')[0]; // YYYY-MM-DD format
            }

            // Convert to Lightweight Charts data format
            chartData.push({
                time: timeKey,
                open: parseFloat(candle[1]),
                high: parseFloat(candle[2]),
                low: parseFloat(candle[3]),
                close: parseFloat(candle[4]),
                volume: candle[5] ? parseFloat(candle[5]) : 0
            });
        });

        // Create a new chart
        const chart = initializeChart();

        // Configure time scale for intraday data
        if (isIntraday) {
            chart.applyOptions({
                timeScale: {
                    timeVisible: true,
                    secondsVisible: false,
                    // Use custom formatter for intraday time display
                    tickMarkFormatter: (timePoint) => {
                        // Use the original timestamp string we stored
                        if (timestampMap[timePoint]) {
                            return timestampMap[timePoint];
                        }

                        // Fallback - should only happen if timestamp mapping fails
                        const date = new Date(timePoint * 1000);
                        return date.toTimeString().slice(0, 5);
                    }
                }
            });
        }

        // Create and style the candlestick series
        const candleSeries = chart.addCandlestickSeries({
            upColor: '#26a69a',
            downColor: '#ef5350',
            borderVisible: false,
            wickUpColor: '#26a69a',
            wickDownColor: '#ef5350',
            priceFormat: {
                type: 'price',
                precision: 2,
                minMove: 0.01,
            }
        });

        // Add the data to the series
        try {
            candleSeries.setData(chartData);
            console.log("Successfully set candlestick data");

            // Add markers for important points if it's intraday data
            if (isIntraday && chartData.length > 0) {
                // Find the first candle (market open) and last candle (market close)
                const markersData = [];

                // Add market open marker
                const firstCandle = chartData[0];
                markersData.push({
                    time: firstCandle.time,
                    position: 'aboveBar',
                    color: '#2196F3',
                    shape: 'arrowDown',
                    text: `Open ${timestampMap[firstCandle.time] || 'Market'}`
                });

                // Add market close marker
                const lastCandle = chartData[chartData.length - 1];
                markersData.push({
                    time: lastCandle.time,
                    position: 'belowBar',
                    color: '#4CAF50',
                    shape: 'arrowUp',
                    text: `Close ${timestampMap[lastCandle.time] || 'Market'}`
                });

                // Add the markers to the chart
                candleSeries.setMarkers(markersData);
            }
        } catch (error) {
            console.error("Error setting candlestick data:", error);
            console.error("Problematic data:", JSON.stringify(chartData.slice(0, 5)));
            throw error;
        }

        // Add volume histogram if we have volume data
        if (chartData.some(item => item.volume > 0)) {
            const volumeSeries = chart.addHistogramSeries({
                color: '#26a69a',
                priceFormat: {
                    type: 'volume',
                },
                priceScaleId: '',
                scaleMargins: {
                    top: 0.8,
                    bottom: 0,
                },
            });

            const volumeData = chartData.map(item => ({
                time: item.time,
                value: item.volume,
                color: item.close > item.open ? '#26a69a' : '#ef5350'
            }));

            try {
                volumeSeries.setData(volumeData);
                console.log("Successfully set volume data");
            } catch (error) {
                console.error("Error setting volume data:", error);
            }
        }

        // Fit all content
        chart.timeScale().fitContent();

        console.log("Chart successfully rendered");

    } catch (error) {
        console.error("Error rendering chart:", error);
        console.error("Stack trace:", error.stack);
        document.getElementById('priceChart').innerHTML =
            `<div style="display: flex; justify-content: center; align-items: center; height: 400px; color: red;">
                Error rendering chart: ${error.message}<br>
                Check console for details.
            </div>`;
    }
}
