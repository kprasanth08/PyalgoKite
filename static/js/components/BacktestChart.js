import React, { useEffect, useRef } from 'react';

/**
 * BacktestChart component that displays trading chart with indicators and signals
 */
function BacktestChart({ data, indicators, signals, strategyName, symbolName }) {
  const chartContainerRef = useRef(null);
  const chartInstance = useRef(null);

  useEffect(() => {
    if (!data || data.length === 0 || !chartContainerRef.current) return;

    const createChart = async () => {
      try {
        // Check if LightweightCharts is available (should be loaded globally from a CDN)
        if (typeof LightweightCharts !== 'object') {
          console.error('LightweightCharts library not found. Make sure it is loaded.');
          return;
        }

        // Clean up previous chart if it exists
        if (chartInstance.current) {
          chartInstance.current.remove();
          chartInstance.current = null;
        }

        // Create the chart
        chartInstance.current = LightweightCharts.createChart(chartContainerRef.current, {
          width: chartContainerRef.current.clientWidth,
          height: 500,
          layout: {
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

        // Add the main candlestick series
        const mainSeries = chartInstance.current.addCandlestickSeries({
          upColor: '#22c55e',
          downColor: '#ef4444',
          borderUpColor: '#22c55e',
          borderDownColor: '#ef4444',
          wickUpColor: '#22c55e',
          wickDownColor: '#ef4444',
        });

        // Format data for the chart
        const candleData = data.map(candle => ({
          time: timeToLocal(new Date(candle[0]).getTime() / 1000),
          open: candle[1],
          high: candle[2],
          low: candle[3],
          close: candle[4],
        }));
        
        mainSeries.setData(candleData);

        // Add indicators if available
        if (indicators) {
          Object.entries(indicators).forEach(([name, values]) => {
            // Skip if values are not valid
            if (!Array.isArray(values) || values.length === 0) return;

            console.log("Indicator data for", name, ":", values[0]);

            // Determine the color to use
            let indicatorColor = '#FF0000'; // Default  red

            // Check if the indicator data has a color property
            if (values[0] && typeof values[0] === 'object') {
              if (values[0].color) {
                indicatorColor = values[0].color;
                console.log("Found color in indicator data:", indicatorColor);
              }
            } else {
              // Use default color scheme
              indicatorColor = getIndicatorColor(name);
              console.log("Using default color for", name, ":", indicatorColor);
            }

            // Create a new line series for each indicator
            const lineSeries = chartInstance.current.addLineSeries({
              color: indicatorColor,
              lineWidth: 2, // Increased line width for better visibility
              title: name,
            });

            // Format indicator data
            const lineData = [];

            for (let i = 0; i < values.length; i++) {
              if (i >= data.length) continue;

              const time = timeToLocal(new Date(data[i][0]).getTime() / 1000);
              let dataValue;

              if (typeof values[i] === 'object' && values[i] !== null) {
                // For objects (like our new EMA format)
                if ('value' in values[i]) {
                  dataValue = values[i].value;
                } else if ('timestamp' in values[i] && 'value' in values[i]) {
                  dataValue = values[i].value;
                }
              } else {
                // For direct values
                dataValue = values[i];
              }

              if (dataValue !== null && dataValue !== undefined) {
                lineData.push({ time, value: dataValue });
              }
            }

            // Debug output
            console.log(`Processed ${lineData.length} data points for ${name} with color ${indicatorColor}`);

            lineSeries.setData(lineData);
          });
        }

        // Add signals if available
        if (signals && signals.length > 0) {
          const markers = signals.map(signal => {
            const dataIndex = Math.max(0, Math.min(signal.index, data.length - 1));
            return {
              time: timeToLocal(new Date(data[dataIndex][0]).getTime() / 1000),
              position: signal.type === 'BUY' ? 'belowBar' : 'aboveBar',
              color: signal.type === 'BUY' ? '#22c55e' : '#ef4444',
              shape: signal.type === 'BUY' ? 'arrowUp' : 'arrowDown',
              text: signal.type,
            };
          });
          
          mainSeries.setMarkers(markers);
        }

        // Fit content to view all data
        chartInstance.current.timeScale().fitContent();
      } catch (error) {
        console.error('Error creating backtest chart:', error);
      }
    };

    createChart();

    // Clean up on component unmount
    return () => {
      if (chartInstance.current) {
        chartInstance.current.remove();
        chartInstance.current = null;
      }
    };
  }, [data, indicators, signals]);

  // Add window resize handler
  useEffect(() => {
    const handleResize = () => {
      if (chartInstance.current && chartContainerRef.current) {
        chartInstance.current.resize(
          chartContainerRef.current.clientWidth, 
          chartContainerRef.current.clientHeight
        );
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Helper function for time conversion
  function timeToLocal(originalTime) {
    const d = new Date(originalTime * 1000);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()) / 1000;
  }

  // Helper function for indicator colors
  function getIndicatorColor(name) {
    const colors = {
      'SMA': '#8884d8',
      'EMA': '#82ca9d',
      'MACD': '#FF7F0E',
      'RSI': '#2196F3',
      'STOCH': '#9C27B0',
      'BB_upper': '#64B5F6',
      'BB_middle': '#2196F3',
      'BB_lower': '#1976D2',
      'ATR': '#FF5722',
      'ADX': '#795548',
    };
    
    for (const [key, color] of Object.entries(colors)) {
      if (name.includes(key)) return color;
    }
    
    // Return a default color if no match is found
    return '#A9A9A9';
  }

  return (
    <div className="backtest-chart-container">
      <div className="chart-header">
        <h2>{symbolName} - {strategyName}</h2>
      </div>
      <div 
        ref={chartContainerRef} 
        className="chart-canvas"
        style={{ width: '100%', height: '500px' }}
      />
    </div>
  );
}

export default BacktestChart;
