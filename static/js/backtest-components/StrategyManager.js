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
    'ema_crossover': {
        name: 'EMA Crossover',
        params: [
            { name: 'period', label: 'EMA Period', type: 'number', default: 9, min: 3, max: 100 },
            {
                name: 'smoothingType',
                label: 'Smoothing Type',
                type: 'select',
                default: 'None',
                options: [
                    { value: 'None', label: 'None' },
                    { value: 'SMA', label: 'SMA' },
                    { value: 'SMA + Bollinger Bands', label: 'SMA + Bollinger Bands' },
                    { value: 'EMA', label: 'EMA' },
                    { value: 'SMMA (RMA)', label: 'SMMA (RMA)' },
                    { value: 'WMA', label: 'WMA' }
                ]
            },
            {
                name: 'smoothingLength',
                label: 'Smoothing Length',
                type: 'number',
                default: 14,
                min: 3,
                max: 50,
                condition: 'smoothingType !== "None"'
            },
            {
                name: 'bbMultiplier',
                label: 'BB StdDev',
                type: 'number',
                default: 2,
                min: 0.1,
                max: 5,
                step: 0.1,
                condition: 'smoothingType === "SMA + Bollinger Bands"'
            }
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
        const paramValues = {}; // Store parameter values for conditions

        config.params.forEach(param => {
            const paramDiv = document.createElement('div');
            paramDiv.className = 'space-y-2 mb-4';
            paramDiv.id = `param-container-${param.name}`;

            // Store parameter default value
            paramValues[param.name] = param.default;

            const label = document.createElement('label');
            label.textContent = param.label;
            label.className = 'block text-sm font-medium text-gray-300';
            label.setAttribute('for', param.name);

            let input;

            if (param.type === 'select') {
                // Create select dropdown
                input = document.createElement('select');
                input.id = param.name;
                input.name = param.name;
                input.className = 'w-full p-2 border border-gray-600 bg-gray-700 text-gray-200 rounded-md focus:ring-blue-500 focus:border-blue-500';

                // Add options to the select
                if (param.options && Array.isArray(param.options)) {
                    param.options.forEach(option => {
                        const optionElement = document.createElement('option');
                        optionElement.value = option.value;
                        optionElement.textContent = option.label;
                        if (option.value === param.default) {
                            optionElement.selected = true;
                        }
                        input.appendChild(optionElement);
                    });
                }

                // Add change event to update dependent fields
                input.addEventListener('change', function() {
                    paramValues[param.name] = this.value;
                    updateConditionalFields(config.params, paramValues, strategyParams);
                });
            } else {
                // Create standard input
                input = document.createElement('input');
                input.type = param.type;
                input.id = param.name;
                input.name = param.name;
                input.value = param.default;
                input.className = 'w-full p-2 border border-gray-600 bg-gray-700 text-gray-200 rounded-md focus:ring-blue-500 focus:border-blue-500';

                if (param.min !== undefined) input.min = param.min;
                if (param.max !== undefined) input.max = param.max;
                if (param.step !== undefined) input.step = param.step;

                // For numeric inputs, add change event
                if (param.type === 'number') {
                    input.addEventListener('change', function() {
                        paramValues[param.name] = parseFloat(this.value);
                        updateConditionalFields(config.params, paramValues, strategyParams);
                    });
                }
            }

            paramDiv.appendChild(label);
            paramDiv.appendChild(input);
            strategyParams.appendChild(paramDiv);

            // If this parameter has a condition, evaluate it initially
            if (param.condition) {
                const isVisible = evaluateCondition(param.condition, paramValues);
                paramDiv.style.display = isVisible ? 'block' : 'none';
            }
        });
    }
}

/**
 * Evaluate a condition string against parameter values
 * @param {String} condition - Condition string to evaluate
 * @param {Object} paramValues - Current parameter values
 * @returns {Boolean} Whether the condition is true
 */
function evaluateCondition(condition, paramValues) {
    try {
        // Create a function with paramValues as parameters
        const paramNames = Object.keys(paramValues);
        const paramValuesArray = Object.values(paramValues);

        // Create a safe evaluation function (limited to simple comparisons)
        const conditionFunc = new Function(...paramNames, `return ${condition};`);
        return conditionFunc(...paramValuesArray);
    } catch (error) {
        console.error('Error evaluating condition:', error);
        return true; // Default to showing the field if there's an error
    }
}

/**
 * Update the visibility of conditional fields based on current parameter values
 * @param {Array} params - Parameter definitions
 * @param {Object} paramValues - Current parameter values
 * @param {Element} container - Container element for the parameters
 */
function updateConditionalFields(params, paramValues, container) {
    params.forEach(param => {
        if (param.condition) {
            const paramContainer = container.querySelector(`#param-container-${param.name}`);
            if (paramContainer) {
                const isVisible = evaluateCondition(param.condition, paramValues);
                paramContainer.style.display = isVisible ? 'block' : 'none';
            }
        }
    });
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
