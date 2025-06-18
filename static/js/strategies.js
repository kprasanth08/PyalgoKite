/**
 * Strategies management for PyalgoKite platform
 * This file handles CRUD operations for trading strategies
 */

document.addEventListener('DOMContentLoaded', function() {
    // DOM elements
    const strategiesContainer = document.getElementById('strategiesContainer');
    const strategyModal = document.getElementById('strategyModal');
    const strategyForm = document.getElementById('strategyForm');
    const modalTitle = document.getElementById('modalTitle');
    const strategyId = document.getElementById('strategyId');
    const strategyName = document.getElementById('strategyName');
    const strategyType = document.getElementById('strategyType');
    const strategyDescription = document.getElementById('strategyDescription');
    const riskLevel = document.getElementById('riskLevel');
    const strategyCode = document.getElementById('strategyCode');
    const indicatorsContainer = document.getElementById('indicatorsContainer');
    const timeframeOptions = document.querySelectorAll('.timeframe-option');

    // Buttons
    const createStrategyBtn = document.getElementById('createStrategyBtn');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const cancelBtn = document.getElementById('cancelBtn');
    const addIndicatorBtn = document.getElementById('addIndicatorBtn');
    const modalOverlay = document.getElementById('modalOverlay');
    const confirmationModal = document.getElementById('confirmationModal');
    const cancelConfirmBtn = document.getElementById('cancelConfirmBtn');
    const confirmActionBtn = document.getElementById('confirmActionBtn');

    // Strategy being edited or deleted (for confirmation modal)
    let currentStrategy = null;
    let deleteStrategyId = null;

    // Fetch strategies on page load
    fetchStrategies();

    // Event Listeners
    createStrategyBtn.addEventListener('click', openCreateStrategyModal);
    closeModalBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', closeModal);
    strategyForm.addEventListener('submit', saveStrategy);
    addIndicatorBtn.addEventListener('click', addIndicatorField);
    cancelConfirmBtn.addEventListener('click', closeConfirmationModal);
    confirmActionBtn.addEventListener('click', confirmDelete);

    /**
     * Fetch all strategies from the server
     */    function fetchStrategies() {
        fetch('/api/strategies')
            .then(response => response.json())
            .then(data => {
                document.getElementById('strategyLoading').style.display = 'none';

                if (!data.success) {
                    strategiesContainer.innerHTML = `<div class="col-span-full text-center p-8 text-red-400">
                        ${data.error || 'Failed to load strategies'}
                    </div>`;
                    return;
                }

                // Convert strategies object to array
                const strategiesArray = Object.values(data.strategies || {});
                // Filter out built-in strategies for the strategies management page
                const userStrategies = strategiesArray.filter(strategy => !strategy.builtin);

                if (userStrategies.length > 0) {
                    strategiesContainer.innerHTML = '';
                    userStrategies.forEach(strategy => {
                        strategiesContainer.appendChild(createStrategyCard(strategy));
                    });
                } else {
                    strategiesContainer.innerHTML = `<div class="col-span-full text-center p-8 text-gray-400">
                        <p class="mb-4">You don't have any strategies yet.</p>
                        <button id="noStrategiesCreateBtn" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition duration-300">
                            Create Your First Strategy
                        </button>
                    </div>`;
                    document.getElementById('noStrategiesCreateBtn').addEventListener('click', openCreateStrategyModal);
                }
            })
            .catch(error => {
                console.error('Error fetching strategies:', error);
                document.getElementById('strategyLoading').style.display = 'none';
                strategiesContainer.innerHTML = `<div class="col-span-full text-center p-8 text-red-400">
                    Failed to connect to server. Please try again later.
                </div>`;
            });
    }

    /**
     * Create a strategy card element
     */
    function createStrategyCard(strategy) {
        const riskColors = {
            low: 'bg-green-600',
            medium: 'bg-yellow-600',
            high: 'bg-red-600'
        };

        const card = document.createElement('div');
        card.className = 'bg-gray-800 rounded-lg overflow-hidden shadow-lg border border-gray-700 hover:border-gray-600 transition-all duration-300';

        let timeframesHtml = '';
        if (strategy.timeframes && strategy.timeframes.length) {
            timeframesHtml = strategy.timeframes.map(tf =>
                `<span class="bg-gray-700 text-xs px-2 py-1 rounded-md">${tf}</span>`
            ).join('');
        }

        card.innerHTML = `
            <div class="relative">
                <div class="p-5">
                    <div class="flex justify-between items-start mb-4">
                        <h3 class="text-lg font-semibold text-gray-100">${strategy.name}</h3>
                        <span class="text-xs ${riskColors[strategy.risk_level] || 'bg-blue-600'} text-white px-2 py-1 rounded">
                            ${strategy.risk_level || 'Unknown'} Risk
                        </span>
                    </div>
                    <p class="text-gray-400 text-sm mb-4 line-clamp-2">${strategy.description || 'No description provided'}</p>
                    <div class="flex flex-wrap gap-2 mb-4">
                        ${timeframesHtml}
                    </div>
                    <div class="flex items-center text-gray-500 text-xs">
                        <span class="mr-2"><i class="far fa-calendar-alt"></i></span>
                        <span>Created: ${new Date(strategy.created_at).toLocaleDateString()}</span>
                    </div>
                </div>
                <div class="bg-gray-700 p-3 flex justify-between">
                    <button class="test-strategy text-sm text-blue-400 hover:text-blue-300" data-id="${strategy.id}">
                        <i class="fas fa-vial mr-1"></i> Backtest
                    </button>
                    <div class="flex space-x-3">
                        <button class="edit-strategy text-sm text-gray-400 hover:text-white" data-id="${strategy.id}">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="delete-strategy text-sm text-gray-400 hover:text-red-400" data-id="${strategy.id}">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Add event listeners to buttons
        card.querySelector('.edit-strategy').addEventListener('click', () => editStrategy(strategy.id));
        card.querySelector('.delete-strategy').addEventListener('click', () => openDeleteConfirmation(strategy.id));
        card.querySelector('.test-strategy').addEventListener('click', () => backtestStrategy(strategy.id));

        return card;
    }

    /**
     * Open modal to create a new strategy
     */
    function openCreateStrategyModal() {
        modalTitle.textContent = 'Create New Strategy';
        strategyId.value = '';
        strategyForm.reset();
        indicatorsContainer.innerHTML = '';
        addIndicatorField(); // Add at least one indicator field

        // Add sample strategy code
        strategyCode.value = `def generate_signals(data):
    """
    Generate trading signals based on a simple moving average strategy.
    
    Parameters:
    - data: DataFrame with OHLCV data
    
    Returns:
    - List of signal dictionaries with index, type (BUY/SELL), and price
    """
    # Example strategy: Buy when price crosses above 50 SMA, sell when it crosses below
    signals = []
    
    # Skip if not enough data
    if len(data) < 50:
        return signals
    
    # Calculate 50-period Simple Moving Average
    data['sma50'] = data['close'].rolling(window=50).mean()
    
    # Skip the first 50 candles where SMA is being calculated
    for i in range(51, len(data)):
        # Buy signal: price crosses above SMA
        if data['close'][i-1] <= data['sma50'][i-1] and data['close'][i] > data['sma50'][i]:
            signals.append({
                'index': i,
                'type': 'BUY',
                'price': data['close'][i]
            })
        
        # Sell signal: price crosses below SMA
        elif data['close'][i-1] >= data['sma50'][i-1] and data['close'][i] < data['sma50'][i]:
            signals.append({
                'index': i,
                'type': 'SELL',
                'price': data['close'][i]
            })
    
    return signals`;

        strategyModal.classList.remove('hidden');
    }

    /**
     * Open modal to edit an existing strategy
     */
    function editStrategy(id) {
        fetch(`/api/strategies/${id}`)
            .then(response => response.json())
            .then(data => {
                if (!data.success || !data.strategy) {
                    alert('Failed to load strategy details.');
                    return;
                }

                currentStrategy = data.strategy;
                modalTitle.textContent = 'Edit Strategy';
                strategyId.value = currentStrategy.id;
                strategyName.value = currentStrategy.name || '';
                strategyType.value = currentStrategy.type || 'custom';
                strategyDescription.value = currentStrategy.description || '';
                riskLevel.value = currentStrategy.risk_level || 'medium';
                strategyCode.value = currentStrategy.code || '';

                // Set timeframes
                timeframeOptions.forEach(option => {
                    option.checked = currentStrategy.timeframes &&
                        currentStrategy.timeframes.includes(option.value);
                });

                // Set indicators
                indicatorsContainer.innerHTML = '';
                if (currentStrategy.indicators && currentStrategy.indicators.length) {
                    currentStrategy.indicators.forEach(indicator => {
                        addIndicatorField(indicator);
                    });
                } else {
                    addIndicatorField();
                }

                strategyModal.classList.remove('hidden');
            })
            .catch(error => {
                console.error('Error fetching strategy details:', error);
                alert('Failed to load strategy details. Please try again.');
            });
    }

    /**
     * Save strategy (create or update)
     */
    function saveStrategy(event) {
        event.preventDefault();

        // Collect selected timeframes
        const selectedTimeframes = Array.from(timeframeOptions)
            .filter(option => option.checked)
            .map(option => option.value);

        // Collect indicators
        const indicators = [];
        document.querySelectorAll('.indicator-row').forEach(row => {
            const type = row.querySelector('.indicator-type').value;
            const period = parseInt(row.querySelector('.indicator-period').value);

            if (type && !isNaN(period)) {
                indicators.push({
                    type: type,
                    period: period
                });
            }
        });

        const strategyData = {
            name: strategyName.value,
            type: strategyType.value,
            description: strategyDescription.value,
            risk_level: riskLevel.value,
            timeframes: selectedTimeframes,
            indicators: indicators,
            code: strategyCode.value
        };

        const isUpdate = strategyId.value !== '';
        const url = isUpdate ? `/api/strategies/${strategyId.value}` : '/api/strategies';
        const method = isUpdate ? 'PUT' : 'POST';        fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(strategyData)
        })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                if (!data.success) {
                    alert(data.message || data.error || 'Failed to save strategy.');
                    return;
                }

                alert('Strategy saved successfully!');
                closeModal();
                fetchStrategies();
            })
            .catch(error => {
                console.error('Error saving strategy:', error);
                alert('Failed to save strategy. Please try again.');
                alert('Failed to save strategy. Please try again.');
            });
    }

    /**
     * Open delete confirmation modal
     */
    function openDeleteConfirmation(id) {
        deleteStrategyId = id;
        confirmationModal.classList.remove('hidden');
    }

    /**
     * Confirm strategy deletion
     */
    function confirmDelete() {
        if (!deleteStrategyId) {
            closeConfirmationModal();
            return;
        }

        fetch(`/api/strategies/${deleteStrategyId}`, {
            method: 'DELETE'
        })
            .then(response => response.json())
            .then(data => {
                closeConfirmationModal();
                if (!data.success) {
                    alert(data.error || 'Failed to delete strategy.');
                    return;
                }

                fetchStrategies();
            })
            .catch(error => {
                console.error('Error deleting strategy:', error);
                closeConfirmationModal();
                alert('Failed to delete strategy. Please try again.');
            });
    }

    /**
     * Navigate to backtest page for a strategy
     */
    function backtestStrategy(id) {
        window.location.href = `/backtest?strategy_id=${id}`;
    }

    /**
     * Add a new indicator field to the form
     */
    function addIndicatorField(indicator = null) {
        const row = document.createElement('div');
        row.className = 'indicator-row flex items-center space-x-2';

        row.innerHTML = `
            <select class="indicator-type p-2 border border-gray-600 bg-gray-700 text-gray-200 rounded-md flex-grow">
                <option value="sma" ${indicator && indicator.type === 'sma' ? 'selected' : ''}>Simple Moving Average (SMA)</option>
                <option value="ema" ${indicator && indicator.type === 'ema' ? 'selected' : ''}>Exponential Moving Average (EMA)</option>
                <option value="rsi" ${indicator && indicator.type === 'rsi' ? 'selected' : ''}>Relative Strength Index (RSI)</option>
                <option value="macd" ${indicator && indicator.type === 'macd' ? 'selected' : ''}>MACD</option>
                <option value="bollinger" ${indicator && indicator.type === 'bollinger' ? 'selected' : ''}>Bollinger Bands</option>
                <option value="stochastic" ${indicator && indicator.type === 'stochastic' ? 'selected' : ''}>Stochastic Oscillator</option>
            </select>
            <div class="flex items-center space-x-1">
                <span class="text-xs text-gray-400">Period:</span>
                <input type="number" class="indicator-period p-2 border border-gray-600 bg-gray-700 text-gray-200 rounded-md w-16" 
                       value="${indicator && indicator.period ? indicator.period : '14'}" min="1" max="200">
            </div>
            <button type="button" class="remove-indicator text-red-400 hover:text-red-300 p-1">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                </svg>
            </button>
        `;

        row.querySelector('.remove-indicator').addEventListener('click', function() {
            row.remove();
        });

        indicatorsContainer.appendChild(row);
    }

    /**
     * Close the strategy modal
     */
    function closeModal() {
        strategyModal.classList.add('hidden');
        currentStrategy = null;
    }

    /**
     * Close the confirmation modal
     */
    function closeConfirmationModal() {
        confirmationModal.classList.add('hidden');
        deleteStrategyId = null;
    }
});
