/**
 * EMA (Exponential Moving Average) Indicator Implementation
 * Based on: https://www.investopedia.com/terms/e/ema.asp
 *
 * EMA = Price(t) * k + EMA(y) * (1 - k)
 * where:
 * - Price(t) = Price today
 * - EMA(y) = EMA yesterday
 * - k = 2/(n+1) where n is the number of periods
 */

/**
 * Calculate the EMA for a series of prices
 * @param {Array} prices - Array of price values (typically close prices)
 * @param {Number} period - The period for the EMA calculation (e.g., 9, 12, 26)
 * @param {Object} options - Additional options for calculation
 * @param {String} options.color - The color to use for the EMA line (e.g., '#FF0000' for red)
 * @param {String} options.smoothingType - Type of smoothing MA to apply: "None", "SMA", "SMA + Bollinger Bands", "EMA", "SMMA (RMA)", "WMA", "VWMA"
 * @param {Number} options.smoothingLength - Length of the smoothing MA
 * @param {Number} options.bbMultiplier - Bollinger Bands standard deviation multiplier (e.g., 2.0)
 * @param {Array} timestamps - Optional array of timestamps corresponding to the prices
 * @returns {Object} Object containing EMA values and any additional indicators like smoothing MA or Bollinger Bands
 */
export function calculateEMA(prices, period, options = {}, timestamps = null) {
    // Default options
    const defaultOptions = {
        color: '#1E88E5',
        smoothingType: 'None',
        smoothingLength: 14,
        bbMultiplier: 2.0
    };

    // Merge default options with provided options
    const config = { ...defaultOptions, ...options };

    if (!Array.isArray(prices) || prices.length === 0) {
        console.error('[EMA] Invalid price data provided');
        return { ema: [] };
    }

    if (period <= 0) {
        console.error('[EMA] Period must be positive');
        return { ema: [] };
    }

    // Ensure we have enough data points for the calculation
    if (prices.length < period) {
        console.warn(`[EMA] Not enough data points for ${period} period EMA. Need ${period}, got ${prices.length}`);
        // Return an array of the same length with null values to maintain data structure
        return { ema: prices.map(() => null) };
    }

    const k = 2 / (period + 1); // Smoothing factor
    const emaValues = [];
    const rawEmaValues = []; // Store raw EMA values for smoothing calculations

    // Initialize EMA with SMA for the first 'period' data points
    let sum = 0;
    for (let i = 0; i < period; i++) {
        sum += prices[i];
    }

    // First EMA value is just the SMA of the first 'period' prices
    let ema = sum / period;
    rawEmaValues.push(ema);

    // Store the first EMA value
    if (timestamps) {
        emaValues.push({
            value: ema,
            color: config.color,
            timestamp: timestamps[period - 1]
        });
    } else {
        emaValues.push({
            value: ema,
            color: config.color
        });
    }

    // Calculate EMA for the rest of the data points
    for (let i = period; i < prices.length; i++) {
        // EMA = Price(t) * k + EMA(y) * (1 - k)
        ema = (prices[i] * k) + (ema * (1 - k));
        rawEmaValues.push(ema);

        if (timestamps) {
            emaValues.push({
                value: ema,
                color: config.color,
                timestamp: timestamps[i]
            });
        } else {
            emaValues.push({
                value: ema,
                color: config.color
            });
        }
    }

    // Initialize result object with EMA values
    const result = { ema: emaValues };

    // Calculate smoothing MA if requested
    if (config.smoothingType !== 'None') {
        result.smoothingMA = calculateSmoothingMA(
            rawEmaValues,
            config.smoothingLength,
            config.smoothingType,
            timestamps ? timestamps.slice(period - 1) : null,
            '#FFD700' // Gold color for smoothing MA
        );

        // Calculate Bollinger Bands if requested
        if (config.smoothingType === 'SMA + Bollinger Bands') {
            const bbData = calculateBollingerBands(
                rawEmaValues,
                config.smoothingLength,
                config.bbMultiplier,
                timestamps ? timestamps.slice(period - 1) : null
            );
            result.upperBand = bbData.upperBand;
            result.lowerBand = bbData.lowerBand;
        }
    }

    return result;
}

/**
 * Calculate the smoothing Moving Average for EMA values
 * @param {Array} values - Array of EMA values
 * @param {Number} period - The period for the smoothing MA
 * @param {String} type - Type of MA: "SMA", "EMA", "SMMA (RMA)", "WMA", "VWMA"
 * @param {Array} timestamps - Optional array of timestamps
 * @param {String} color - Color for the smoothing MA
 * @returns {Array} Array of smoothing MA values
 */
function calculateSmoothingMA(values, period, type, timestamps = null, color = '#FFD700') {
    if (values.length < period) {
        return [];
    }

    const result = [];

    switch (type) {
        case 'SMA':
        case 'SMA + Bollinger Bands':
            // Simple Moving Average
            for (let i = 0; i < values.length - period + 1; i++) {
                let sum = 0;
                for (let j = 0; j < period; j++) {
                    sum += values[i + j];
                }
                const sma = sum / period;

                if (timestamps && i + period - 1 < timestamps.length) {
                    result.push({
                        value: sma,
                        color: color,
                        timestamp: timestamps[i + period - 1]
                    });
                } else {
                    result.push({
                        value: sma,
                        color: color
                    });
                }
            }
            break;

        case 'EMA':
            // Exponential Moving Average
            const k = 2 / (period + 1);
            let ema = values.slice(0, period).reduce((sum, val) => sum + val, 0) / period;

            if (timestamps && period - 1 < timestamps.length) {
                result.push({
                    value: ema,
                    color: color,
                    timestamp: timestamps[period - 1]
                });
            } else {
                result.push({
                    value: ema,
                    color: color
                });
            }

            for (let i = period; i < values.length; i++) {
                ema = values[i] * k + ema * (1 - k);

                if (timestamps && i < timestamps.length) {
                    result.push({
                        value: ema,
                        color: color,
                        timestamp: timestamps[i]
                    });
                } else {
                    result.push({
                        value: ema,
                        color: color
                    });
                }
            }
            break;

        case 'SMMA (RMA)':
            // Smoothed Moving Average (also known as RMA)
            let smma = values.slice(0, period).reduce((sum, val) => sum + val, 0) / period;

            if (timestamps && period - 1 < timestamps.length) {
                result.push({
                    value: smma,
                    color: color,
                    timestamp: timestamps[period - 1]
                });
            } else {
                result.push({
                    value: smma,
                    color: color
                });
            }

            for (let i = period; i < values.length; i++) {
                smma = (smma * (period - 1) + values[i]) / period;

                if (timestamps && i < timestamps.length) {
                    result.push({
                        value: smma,
                        color: color,
                        timestamp: timestamps[i]
                    });
                } else {
                    result.push({
                        value: smma,
                        color: color
                    });
                }
            }
            break;

        case 'WMA':
            // Weighted Moving Average
            for (let i = 0; i <= values.length - period; i++) {
                let sum = 0;
                let weightSum = 0;

                for (let j = 0; j < period; j++) {
                    const weight = period - j;
                    sum += values[i + j] * weight;
                    weightSum += weight;
                }

                const wma = sum / weightSum;

                if (timestamps && i + period - 1 < timestamps.length) {
                    result.push({
                        value: wma,
                        color: color,
                        timestamp: timestamps[i + period - 1]
                    });
                } else {
                    result.push({
                        value: wma,
                        color: color
                    });
                }
            }
            break;

        case 'VWMA':
            // Volume Weighted Moving Average - since we don't have volume, fallback to SMA
            console.warn('[EMA] VWMA requested but volume data is not available. Using SMA instead.');
            for (let i = 0; i < values.length - period + 1; i++) {
                let sum = 0;
                for (let j = 0; j < period; j++) {
                    sum += values[i + j];
                }
                const sma = sum / period;

                if (timestamps && i + period - 1 < timestamps.length) {
                    result.push({
                        value: sma,
                        color: color,
                        timestamp: timestamps[i + period - 1]
                    });
                } else {
                    result.push({
                        value: sma,
                        color: color
                    });
                }
            }
            break;
    }

    return result;
}

/**
 * Calculate Bollinger Bands based on a Simple Moving Average of EMA values
 * @param {Array} values - Array of EMA values
 * @param {Number} period - The period for the SMA calculation
 * @param {Number} multiplier - Standard deviation multiplier
 * @param {Array} timestamps - Optional array of timestamps
 * @returns {Object} Object containing upperBand and lowerBand arrays
 */
function calculateBollingerBands(values, period, multiplier, timestamps = null) {
    if (values.length < period) {
        return { upperBand: [], lowerBand: [] };
    }

    const upperBand = [];
    const lowerBand = [];

    for (let i = 0; i <= values.length - period; i++) {
        const slice = values.slice(i, i + period);

        // Calculate SMA
        const sma = slice.reduce((sum, val) => sum + val, 0) / period;

        // Calculate standard deviation
        const sqrDiff = slice.map(val => {
            const diff = val - sma;
            return diff * diff;
        });
        const stdDev = Math.sqrt(sqrDiff.reduce((sum, val) => sum + val, 0) / period);

        // Calculate upper and lower bands
        const upper = sma + (stdDev * multiplier);
        const lower = sma - (stdDev * multiplier);

        if (timestamps && i + period - 1 < timestamps.length) {
            upperBand.push({
                value: upper,
                color: '#4CAF50', // Green
                timestamp: timestamps[i + period - 1]
            });

            lowerBand.push({
                value: lower,
                color: '#4CAF50', // Green
                timestamp: timestamps[i + period - 1]
            });
        } else {
            upperBand.push({
                value: upper,
                color: '#4CAF50' // Green
            });

            lowerBand.push({
                value: lower,
                color: '#4CAF50' // Green
            });
        }
    }

    return { upperBand, lowerBand };
}

/**
 * Calculate multiple EMAs with different periods for a given price series
 * @param {Array} prices - Array of price values
 * @param {Array} periods - Array of periods to calculate EMAs for (e.g., [9, 21, 50])
 * @param {Object} options - Additional options for EMA calculation
 * @param {Array} timestamps - Optional array of timestamps corresponding to the prices
 * @returns {Object} Object with keys corresponding to periods and values as arrays of EMA values
 */
export function calculateMultipleEMAs(prices, periods, options = {}, timestamps = null) {
    const result = {};

    // Default colors for different EMA periods if not provided
    const defaultColors = [
        '#1E88E5', // Blue
        '#FF5722', // Orange
        '#4CAF50', // Green
        '#9C27B0', // Purple
        '#E91E63', // Pink
        '#FFC107', // Amber
        '#795548', // Brown
        '#607D8B'  // Blue Grey
    ];

    periods.forEach((period, index) => {
        // Use provided color or select from default colors based on index
        const color = options.colors && options.colors[index]
            ? options.colors[index]
            : defaultColors[index % defaultColors.length];

        const emaOptions = { ...options, color };
        result[`ema${period}`] = calculateEMA(prices, period, emaOptions, timestamps);
    });

    return result;
}
