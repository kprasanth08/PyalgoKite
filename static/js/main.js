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

function formatTimestamp(timestamp) {
    // Convert timestamp to date format expected by the chart
    return Math.floor(timestamp);
}

function fetchMarketData() {
    const symbol = document.getElementById('symbolInput').value;

    fetch(`/market_data?symbol=${encodeURIComponent(symbol)}`)
        .then(response => response.json())
        .then(data => {
            if (data.code === 200 && data.data && data.data.candles) {
                const chartData = data.data.candles.map(candle => ({
                    time: formatTimestamp(candle[0]),
                    open: parseFloat(candle[1]),
                    high: parseFloat(candle[2]),
                    low: parseFloat(candle[3]),
                    close: parseFloat(candle[4])
                }));

                const chart = initializeChart();
                const candleSeries = chart.addCandlestickSeries({
                    upColor: '#26a69a',
                    downColor: '#ef5350',
                    borderVisible: false,
                    wickUpColor: '#26a69a',
                    wickDownColor: '#ef5350'
                });

                candleSeries.setData(chartData);

                // Add a volume series below the price chart
                const volumeSeries = chart.addHistogramSeries({
                    color: '#26a69a',
                    priceFormat: {
                        type: 'volume',
                    },
                    priceScaleId: '', // Set to empty string to create a separate price scale
                    scaleMargins: {
                        top: 0.8,
                        bottom: 0,
                    },
                });

                const volumeData = chartData.map(item => ({
                    time: item.time,
                    value: parseFloat(item.volume || 0),
                    color: item.close > item.open ? '#26a69a' : '#ef5350'
                }));

                volumeSeries.setData(volumeData);
            } else {
                console.error('Error in market data:', data);
                alert(data.message || 'Error fetching market data. Please check the symbol and try again.');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert('Error fetching market data. Please try again later.');
        });
}
