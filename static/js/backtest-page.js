// backtest-page.js
import React, { useState, useEffect } from 'react';
import BacktestChart from './components/BacktestChart';
import StrategySelector from './components/StrategySelector';
import SymbolSearch from './components/SymbolSearch';
import PerformanceMetrics from './components/PerformanceMetrics';
import DateRangePicker from './components/DateRangePicker';

function BacktestPage() {
    const [selectedSymbol, setSelectedSymbol] = useState(null);
    const [selectedStrategy, setSelectedStrategy] = useState(null);
    const [strategies, setStrategies] = useState([]);
    const [strategyParams, setStrategyParams] = useState({});
    const [dateRange, setDateRange] = useState({
        startDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000), // 1 year ago
        endDate: new Date()
    });
    const [backtestResults, setBacktestResults] = useState(null);
    const [isLoading, setIsLoading] = useState(false);

    // Fetch available strategies on component mount
    useEffect(() => {
        fetch('/api/strategies')
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    setStrategies(data.strategies);
                }
            })
            .catch(error => console.error('Error fetching strategies:', error));
    }, []);

    // Update strategy parameters when strategy changes
    useEffect(() => {
        if (selectedStrategy && strategies[selectedStrategy]) {
            const defaultParams = {};
            const strategyConfig = strategies[selectedStrategy];

            // Set default values for all parameters
            Object.entries(strategyConfig.parameters).forEach(([paramName, paramConfig]) => {
                defaultParams[paramName] = paramConfig.default;
            });

            setStrategyParams(defaultParams);
        }
    }, [selectedStrategy, strategies]);

    const runBacktest = () => {
        if (!selectedSymbol || !selectedStrategy) {
            alert('Please select both a symbol and a strategy');
            return;
        }

        setIsLoading(true);

        const backtestParams = {
            instrument_key: selectedSymbol.instrument_key,
            strategy: selectedStrategy,
            params: strategyParams,
            start_date: dateRange.startDate.toISOString().split('T')[0],
            end_date: dateRange.endDate.toISOString().split('T')[0]
        };

        fetch('/api/backtest', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(backtestParams)
        })
        .then(response => response.json())
        .then(data => {
            setIsLoading(false);
            if (data.success) {
                setBacktestResults(data);
            } else {
                alert(`Backtest failed: ${data.message}`);
            }
        })
        .catch(error => {
            setIsLoading(false);
            console.error('Error running backtest:', error);
        });
    };

    const handleParamChange = (paramName, value) => {
        setStrategyParams(prev => ({
            ...prev,
            [paramName]: value
        }));
    };

    return (
        <div className="backtest-page">
            <h1>Strategy Backtesting</h1>

            <div className="backtest-controls">
                <div className="control-row">
                    <SymbolSearch
                        onSelect={setSelectedSymbol}
                        selected={selectedSymbol}
                    />

                    <StrategySelector
                        strategies={strategies}
                        selected={selectedStrategy}
                        onSelect={setSelectedStrategy}
                        params={strategyParams}
                        onParamChange={handleParamChange}
                    />
                </div>

                <div className="control-row">
                    <DateRangePicker
                        startDate={dateRange.startDate}
                        endDate={dateRange.endDate}
                        onChange={setDateRange}
                    />

                    <button
                        onClick={runBacktest}
                        disabled={!selectedSymbol || !selectedStrategy || isLoading}
                        className="run-backtest-btn"
                    >
                        {isLoading ? 'Running...' : 'Run Backtest'}
                    </button>
                </div>
            </div>

            {backtestResults && (
                <>
                    <BacktestChart
                        data={backtestResults.data.candles}
                        indicators={backtestResults.data.indicators}
                        signals={backtestResults.data.signals}
                        strategyName={strategies[selectedStrategy]?.name || selectedStrategy}
                        symbolName={selectedSymbol?.tradingsymbol || ''}
                    />

                    <PerformanceMetrics metrics={backtestResults.metrics} />
                </>
            )}
        </div>
    );
}

export default BacktestPage;