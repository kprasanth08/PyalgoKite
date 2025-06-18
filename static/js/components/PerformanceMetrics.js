import React from 'react';

/**
 * PerformanceMetrics component displays key performance metrics from backtesting results
 */
function PerformanceMetrics({ metrics }) {
  if (!metrics) return null;

  const formatNumber = (num, precision = 2) => {
    if (num === undefined || num === null) return 'N/A';
    return Number(num).toFixed(precision);
  };

  const formatPercent = (num) => {
    if (num === undefined || num === null) return 'N/A';
    return `${formatNumber(num)}%`;
  };

  const formatCurrency = (num) => {
    if (num === undefined || num === null) return 'N/A';
    return `₹${formatNumber(num)}`;
  };

  const metricsGroups = [
    {
      title: 'Overall Performance',
      metrics: [
        { label: 'Net Profit/Loss', value: formatCurrency(metrics.net_profit_loss) },
        { label: 'Return', value: formatPercent(metrics.return_percentage) },
        { label: 'Annualized Return', value: formatPercent(metrics.annualized_return) },
        { label: 'Total Trades', value: metrics.total_trades || 0 },
        { label: 'Win Rate', value: formatPercent(metrics.win_rate) }
      ]
    },
    {
      title: 'Risk Metrics',
      metrics: [
        { label: 'Max Drawdown', value: formatPercent(metrics.max_drawdown) },
        { label: 'Sharpe Ratio', value: formatNumber(metrics.sharpe_ratio, 3) },
        { label: 'Sortino Ratio', value: formatNumber(metrics.sortino_ratio, 3) },
        { label: 'Calmar Ratio', value: formatNumber(metrics.calmar_ratio, 3) },
        { label: 'Volatility', value: formatPercent(metrics.volatility) }
      ]
    },
    {
      title: 'Trade Statistics',
      metrics: [
        { label: 'Profitable Trades', value: `${metrics.winning_trades || 0} (${formatPercent(metrics.win_rate)})` },
        { label: 'Loss-Making Trades', value: `${metrics.losing_trades || 0} (${formatPercent(100 - metrics.win_rate)})` },
        { label: 'Avg Profit/Trade', value: formatCurrency(metrics.avg_profit_per_trade) },
        { label: 'Avg Loss/Trade', value: formatCurrency(metrics.avg_loss_per_trade) },
        { label: 'Profit Factor', value: formatNumber(metrics.profit_factor, 3) }
      ]
    },
    {
      title: 'Duration Metrics',
      metrics: [
        { label: 'Avg Trade Duration', value: metrics.avg_trade_duration || 'N/A' },
        { label: 'Avg Profitable Trade', value: metrics.avg_winning_trade_duration || 'N/A' },
        { label: 'Avg Losing Trade', value: metrics.avg_losing_trade_duration || 'N/A' },
        { label: 'Max Trade Duration', value: metrics.max_trade_duration || 'N/A' },
        { label: 'Min Trade Duration', value: metrics.min_trade_duration || 'N/A' }
      ]
    }
  ];

  return (
    <div className="performance-metrics">
      <h2>Performance Metrics</h2>

      <div className="metrics-grid">
        {metricsGroups.map((group, groupIndex) => (
          <div key={groupIndex} className="metrics-group">
            <h3>{group.title}</h3>
            <table className="metrics-table">
              <tbody>
                {group.metrics.map((metric, metricIndex) => (
                  <tr key={metricIndex}>
                    <td className="metric-label">{metric.label}</td>
                    <td className="metric-value">{metric.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}

export default PerformanceMetrics;
