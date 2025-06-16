// BacktestChart.js
import React, { useEffect, useRef } from 'react';

function BacktestChart({ data, indicators, signals, strategyName, symbolName }) {
    const chartContainerRef = useRef(null);
    const chartRef = useRef(null);

    useEffect(() => {
        if (!data || data.length === 0) return;

        // Initialize chart
        const chartContainer = chartContainerRef.current;
        if (!chartContainer) return;

        // Clear any existing chart
        chartContainer.innerHTML = '';

        // Create a new chart
        const chart = new FinancialChart(chartContainer, {
            height: 500,
            theme: 'dark'
        });

        // Set the chart data
        chart.setData(data.map(candle => ({
            x: new Date(candle.timestamp).getTime(),
            o: candle.open,
            h: candle.high,
            l: candle.low,
            c: candle.close
        })));

        // Add indicators
        if (indicators) {
            Object.entries(indicators).forEach(([name, data]) => {
                if (name === 'rsi') {
                    chart.addIndicator('rsi', {
                        period: 14,
                        data: data.map(d => ({
                            time: new Date(d.timestamp).getTime(),
                            value: d.rsi
                        }))
                    });
                } else if (name.includes('ma')) {
                    chart.addIndicator('line', {
                        name: name,
                        data: data.map(d => ({
                            time: new Date(d.timestamp).getTime(),
                            value: d[name]
                        })),
                        color: name === 'short_ma' ? '#4ade80' : '#f87171'
                    });
                }
            });
        }

        // Add buy/sell signals
        if (signals) {
            const strategy = {
                buySignals: signals.buy.map(signal => ({
                    time: new Date(signal.timestamp).getTime(),
                    price: signal.price,
                    marker: '▲',
                    color: '#22c55e',
                    position: 'belowBar'
                })),
                sellSignals: signals.sell.map(signal => ({
                    time: new Date(signal.timestamp).getTime(),
                    price: signal.price,
                    marker: '▼',
                    color: '#ef4444',
                    position: 'aboveBar'
                }))
            };

            chart.addStrategy(strategy);
        }

        chartRef.current = chart;
    }, [data, indicators, signals]);

    return (
        <div className="backtest-chart-container">
            <h2>{symbolName} - {strategyName} Backtest</h2>
            <div ref={chartContainerRef} className="backtest-chart"></div>
        </div>
    );
}

export default BacktestChart;