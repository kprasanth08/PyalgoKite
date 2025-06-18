/**
 * Backtest Service
 * Handles running backtests and updating UI states
 */

/**
 * Run backtest with the provided configuration
 */
function runBacktest(event, config, uiElements) {
    event.preventDefault();
    const { selectedSymbol, strategySelect, startDate, endDate, strategyParams } = config;
    const { backtestLoading, backtestResults, backtestError, backtestStatus, runBacktestBtn } = uiElements;

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
        initial_capital: parseFloat(config.initialCapital.value),
        params: params
    };

    // Show loading state
    showLoading(uiElements);

    // Run backtest
    return fetch('/api/backtest', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(backtestData)
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            displayResults(data.data, data.metrics, uiElements, config);
            return data;
        } else {
            showError(data.message || 'Backtest failed', uiElements);
            return null;
        }
    })
    .catch(error => {
        console.error('Error running backtest:', error);
        showError('Network error occurred', uiElements);
        return null;
    });
}

/**
 * Show loading state
 */
function showLoading(uiElements) {
    const { backtestLoading, backtestResults, backtestError, backtestStatus, runBacktestBtn } = uiElements;

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
function displayResults(data, metrics, uiElements, config) {
    const {
        backtestLoading, backtestResults, backtestError, backtestStatus,
        runBacktestBtn, totalReturn, sharpeRatio, maxDrawdown, winRate,
        tradeLog, backtestChart, symbolInput, initialCapital
    } = uiElements;

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
    totalReturn.textContent = metrics && metrics.total_return !== undefined && metrics.total_return !== null ?
        `${(metrics.total_return * 100).toFixed(2)}%` : 'N/A';
    sharpeRatio.textContent = metrics && metrics.sharpe_ratio !== undefined && metrics.sharpe_ratio !== null ?
        metrics.sharpe_ratio.toFixed(2) : 'N/A';
    maxDrawdown.textContent = metrics && metrics.max_drawdown !== undefined && metrics.max_drawdown !== null ?
        `${(metrics.max_drawdown * 100).toFixed(2)}%` : 'N/A';
    winRate.textContent = metrics && metrics.win_rate !== undefined && metrics.win_rate !== null ?
        `${(metrics.win_rate * 100).toFixed(1)}%` : 'N/A';

    // Create chart and update trade log using imported functions
    if (typeof window.createChart === 'function') {
        window.createChart(data, metrics, backtestChart, symbolInput, initialCapital);
    }

    if (typeof window.updateTradeLog === 'function') {
        window.updateTradeLog(metrics.trades || [], tradeLog);
    }

    // Reset button
    runBacktestBtn.disabled = false;
    runBacktestBtn.innerHTML = '<i class="fas fa-play mr-2"></i>Run Backtest';
}

/**
 * Show error state
 */
function showError(message, uiElements) {
    const { backtestLoading, backtestResults, backtestError, backtestStatus, runBacktestBtn } = uiElements;

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

export { runBacktest, showLoading, displayResults, showError };
