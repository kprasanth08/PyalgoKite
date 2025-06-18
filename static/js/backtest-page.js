/**
 * Main Backtest Page
 * Entry point that imports and initializes all backtest components
 */

// Import modules
import { strategyConfigs, updateStrategyParams, loadStrategies } from './backtest-components/StrategyManager.js';
import { handleSymbolSearch, hideSymbolDropdown } from './backtest-components/SymbolSearch.js';
import { runBacktest } from './backtest-components/BacktestService.js';
import { createChart, updateTradeLog } from './backtest-components/PerformanceMetrics.js';

document.addEventListener('DOMContentLoaded', function() {
    // DOM elements
    const backtestForm = document.getElementById('backtestForm');
    const strategySelect = document.getElementById('strategySelect');
    const symbolInput = document.getElementById('symbolInput');
    const symbolDropdown = document.getElementById('symbolDropdown');
    const selectedSymbol = document.getElementById('selectedSymbol');
    const startDate = document.getElementById('startDate');
    const endDate = document.getElementById('endDate');
    const initialCapital = document.getElementById('initialCapital');
    const strategyParams = document.getElementById('strategyParams');
    const runBacktestBtn = document.getElementById('runBacktestBtn');

    // Results elements
    const backtestLoading = document.getElementById('backtestLoading');
    const backtestResults = document.getElementById('backtestResults');
    const backtestError = document.getElementById('backtestError');
    const backtestStatus = document.getElementById('backtestStatus');

    // Metrics elements
    const totalReturn = document.getElementById('totalReturn');
    const sharpeRatio = document.getElementById('sharpeRatio');
    const maxDrawdown = document.getElementById('maxDrawdown');
    const winRate = document.getElementById('winRate');
    const tradeLog = document.getElementById('tradeLog');
    const backtestChart = document.getElementById('backtestChart');

    // Set default dates
    const today = new Date();
    const oneYearAgo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());

    endDate.value = today.toISOString().split('T')[0];
    startDate.value = oneYearAgo.toISOString().split('T')[0];

    // Create an object with all UI elements for easier passing to functions
    const uiElements = {
        backtestLoading,
        backtestResults,
        backtestError,
        backtestStatus,
        runBacktestBtn,
        totalReturn,
        sharpeRatio,
        maxDrawdown,
        winRate,
        tradeLog,
        backtestChart
    };

    // Create an object with all form elements
    const formElements = {
        selectedSymbol,
        strategySelect,
        startDate,
        endDate,
        initialCapital,
        strategyParams,
        symbolInput
    };

    // Make chart and trade log functions available globally for the BacktestService
    window.createChart = createChart;
    window.updateTradeLog = updateTradeLog;

    // Event listeners
    strategySelect.addEventListener('change', () => updateStrategyParams(strategySelect, strategyParams));
    symbolInput.addEventListener('input', () => handleSymbolSearch(symbolInput, symbolDropdown));
    symbolInput.addEventListener('blur', () => hideSymbolDropdown(symbolDropdown));
    symbolInput.addEventListener('focus', () => {
        selectedSymbol.value = '';  // Clear the hidden field when user focuses to select a new symbol
    });
    backtestForm.addEventListener('submit', (event) => runBacktest(event, formElements, uiElements));

    // Load strategies on page load
    loadStrategies(strategySelect);

    // Initialize strategy parameters on page load
    updateStrategyParams(strategySelect, strategyParams);
});
