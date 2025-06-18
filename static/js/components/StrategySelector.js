import React from 'react';

/**
 * StrategySelector component that allows selecting a trading strategy
 * and configuring its parameters
 */
function StrategySelector({ strategies, selected, onSelect, params, onParamChange }) {
  const handleStrategyChange = (e) => {
    onSelect(e.target.value);
  };

  const handleParamChange = (paramName, e) => {
    // Convert numeric values
    let value = e.target.value;
    if (e.target.type === 'number') {
      value = parseFloat(value);

      // Handle NaN
      if (isNaN(value)) {
        value = 0;
      }
    }

    onParamChange(paramName, value);
  };

  // Get the current strategy's config for parameters display
  const currentStrategy = selected && strategies[selected] ? strategies[selected] : null;

  return (
    <div className="strategy-selector">
      <label className="form-label">
        Strategy:
        <select
          className="form-select"
          value={selected || ''}
          onChange={handleStrategyChange}
        >
          <option value="">Select a strategy</option>
          {Object.entries(strategies).map(([key, strategy]) => (
            <option key={key} value={key}>
              {strategy.name}
            </option>
          ))}
        </select>
      </label>

      {currentStrategy && (
        <div className="strategy-params">
          <h3>Parameters</h3>
          {Object.entries(currentStrategy.parameters).map(([paramName, paramConfig]) => (
            <div key={paramName} className="param-input">
              <label className="form-label">
                {paramConfig.label || paramName}:
                {paramConfig.type === 'number' ? (
                  <input
                    type="number"
                    className="form-input"
                    value={params[paramName] || ''}
                    onChange={(e) => handleParamChange(paramName, e)}
                    min={paramConfig.min}
                    max={paramConfig.max}
                    step={paramConfig.step || 1}
                  />
                ) : paramConfig.type === 'select' ? (
                  <select
                    className="form-select"
                    value={params[paramName] || ''}
                    onChange={(e) => handleParamChange(paramName, e)}
                  >
                    {paramConfig.options.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    className="form-input"
                    value={params[paramName] || ''}
                    onChange={(e) => handleParamChange(paramName, e)}
                  />
                )}
              </label>
              {paramConfig.description && (
                <div className="param-desc">{paramConfig.description}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default StrategySelector;
