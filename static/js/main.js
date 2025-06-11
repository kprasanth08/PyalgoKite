let chart = null;

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

    fetch(`/market_data?symbol=${encodeURIComponent(symbol)}`)
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
        })
        .catch(error => {
            console.error('Error:', error);
            document.getElementById('priceChart').innerHTML =
                `<div style="display: flex; justify-content: center; align-items: center; height: 400px; color: red;">
                    Error loading chart data: ${error.message}
                </div>`;
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

        // Process data for chart - detect monthly data
        const isMonthlyData = validCandles.every(candle => {
            // Check if all dates are on the first day of the month
            const date = new Date(candle[0]);
            return date.getDate() === 1;
        });

        console.log("Data appears to be monthly:", isMonthlyData);

        // Format data for lightweight-charts
        const chartData = validCandles.map(candle => {
            // For monthly data, use YYYY-MM-DD format directly
            const dateStr = candle[0].split('T')[0];

            return {
                time: dateStr,  // Use YYYY-MM-DD string format for monthly data
                open: parseFloat(candle[1]),
                high: parseFloat(candle[2]),
                low: parseFloat(candle[3]),
                close: parseFloat(candle[4]),
                volume: candle[5] ? parseFloat(candle[5]) : 0
            };
        });

        console.log("First chart data point:", chartData[0]);
        console.log("Last chart data point:", chartData[chartData.length - 1]);

        // Create a new chart
        const chart = initializeChart();

        // If it's monthly data, configure time scale appropriately
        if (isMonthlyData) {
            chart.applyOptions({
                timeScale: {
                    timeVisible: true,
                    secondsVisible: false,
                    borderColor: 'rgba(197, 203, 206, 1)',
                    // Format time labels to show month and year
                    tickMarkFormatter: (time) => {
                        const date = new Date(time * 1000);
                        return date.toLocaleDateString('en-US', {
                            month: 'short',
                            year: '2-digit'
                        });
                    }
                },
            });
        }

        // Create and style the candlestick series
        const candleSeries = chart.addCandlestickSeries({
            upColor: '#26a69a',
            downColor: '#ef5350',
            borderVisible: false,
            wickUpColor: '#26a69a',
            wickDownColor: '#ef5350'
        });

        // Add the data to the series
        try {
            candleSeries.setData(chartData);
            console.log("Successfully set candlestick data");
        } catch (error) {
            console.error("Error setting candlestick data:", error);
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
                // Continue anyway since price data is more important
            }
        }

        // Fit all content
        chart.timeScale().fitContent();

        // Add percentage scale to the right
        const priceFormat = {
            type: 'price',
            precision: 2,
            minMove: 0.01,
        };

        candleSeries.applyOptions({
            priceFormat: priceFormat
        });

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
