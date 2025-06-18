/**
 * Strategy Manager
 * Handles strategy configurations, loading and parameter updates
 */

// Strategy parameter configurations
const strategyConfigs = {
    'moving_average_crossover': {
        name: 'Moving Average Crossover',
        params: [
            { name: 'short_window', label: 'Short MA Period', type: 'number', default: 20, min: 5, max: 50 },
            { name: 'long_window', label: 'Long MA Period', type: 'number', default: 50, min: 20, max: 200 }
        ]
    },
    'rsi_strategy': {
        name: 'RSI Strategy',
        params: [
            { name: 'rsi_period', label: 'RSI Period', type: 'number', default: 14, min: 5, max: 30 },
            { name: 'oversold_threshold', label: 'Oversold Threshold', type: 'number', default: 30, min: 20, max: 40 },
            { name: 'overbought_threshold', label: 'Overbought Threshold', type: 'number', default: 70, min: 60, max: 80 }
        ]
    },
    'bollinger_bands': {
        name: 'Bollinger Bands',
        params: [
            { name: 'period', label: 'Period', type: 'number', default: 20, min: 10, max: 50 },
            { name: 'std_dev', label: 'Standard Deviation', type: 'number', default: 2, min: 1, max: 3, step: 0.1 }
        ]
    }
};

/**
 * Update strategy parameters in the DOM based on selected strategy
 */
function updateStrategyParams(strategySelect, strategyParams) {
    const selectedStrategy = strategySelect.value;
    strategyParams.innerHTML = '';

    if (selectedStrategy && strategyConfigs[selectedStrategy]) {
        const config = strategyConfigs[selectedStrategy];

        config.params.forEach(param => {
            const paramDiv = document.createElement('div');
            paramDiv.className = 'space-y-2';

            const label = document.createElement('label');
            label.textContent = param.label;
            label.className = 'block text-sm font-medium text-gray-300';
            label.setAttribute('for', param.name);

            const input = document.createElement('input');
            input.type = param.type;
            input.id = param.name;
            input.name = param.name;
            input.value = param.default;
            input.className = 'w-full p-2 border border-gray-600 bg-gray-700 text-gray-200 rounded-md focus:ring-blue-500 focus:border-blue-500';

            if (param.min !== undefined) input.min = param.min;
            if (param.max !== undefined) input.max = param.max;
            if (param.step !== undefined) input.step = param.step;

            paramDiv.appendChild(label);
            paramDiv.appendChild(input);
            strategyParams.appendChild(paramDiv);
        });
    }
}

/**
 * Load strategies from API
 */
function loadStrategies(strategySelect) {
    return fetch('/api/strategies')
        .then(response => response.json())
        .then((data) => {
            if (data.success) {
                // Clear existing options except the first one
                strategySelect.innerHTML = '<option value="">Select a strategy...</option>';

                // Add strategies to dropdown
                Object.entries(data.strategies).forEach(([key, strategy]) => {
                    const option = document.createElement('option');
                    option.value = key;
                    option.textContent = strategy.name;
                    strategySelect.appendChild(option);
                });

                return data.strategies;
            }
            return {};
        })
        .catch(error => {
            console.error('Error loading strategies:', error);
            return {};
        });
}

// Export the functions and data
export { strategyConfigs, updateStrategyParams, loadStrategies };
